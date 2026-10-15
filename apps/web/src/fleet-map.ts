import type { FleetOverview, FleetOverviewLink, FleetSite } from '@proanima/arkvory-contracts';

/** One box of the map: a managed site, this installation or a source nobody here manages. */
export interface MapNode {
  readonly id: string;
  readonly name: string;
  /** `ok`, a site state, `external`, or `unknown` for an id a link names but the list does not. */
  readonly state: string;
  /** The worst alert of the node, for its color; null when none. */
  readonly severity: 'critical' | 'warning' | 'info' | null;
  readonly column: number;
  readonly row: number;
}
export interface MapLayout {
  readonly nodes: readonly MapNode[];
  readonly links: readonly FleetOverviewLink[];
  readonly columns: number;
  readonly rows: number;
}

/** Wide fleets stay readable: deeper chains share the last column. */
const MAX_COLUMNS = 6;
const rank = { critical: 0, warning: 1, info: 2 } as const;

/**
 * Sources left, what they feed to the right. A node's column is the longest chain of sources
 * before it, capped: cycles (two sites mirroring each other) and self-links settle at the cap
 * instead of looping. Rows keep the order of the site list, so a refresh does not reshuffle.
 * A link to an id the list does not have (a site removed or unreadable since the overview was
 * built) gets a node of its own: the map shows every link the table shows.
 */
export function layoutMap(
  overview: FleetOverview,
  sites: readonly FleetSite[],
  selfName: string,
): MapLayout {
  const worst = new Map<string, MapNode['severity']>();
  for (const alert of overview.alerts) {
    const known = worst.get(alert.site) ?? null;
    if (known === null || rank[alert.severity] < rank[known]) worst.set(alert.site, alert.severity);
  }
  const base = [
    { id: 'self', name: selfName, state: 'ok' },
    ...sites.map((site) => ({ id: site.id, name: site.name, state: site.state })),
    ...overview.external.map((origin) => ({
      id: `external:${origin}`,
      name: origin,
      state: 'external',
    })),
  ];
  const ids = new Set(base.map((node) => node.id));
  for (const link of overview.links)
    for (const id of [link.from, link.to])
      if (!ids.has(id)) {
        ids.add(id);
        const external = id.startsWith('external:');
        base.push({
          id,
          name: external ? id.slice('external:'.length) : id,
          state: external ? 'external' : 'unknown',
        });
      }
  const links = overview.links;
  const depth = new Map(base.map((node) => [node.id, 0]));
  // Longest path by relaxation; at most MAX_COLUMNS rounds can move anything below the cap.
  for (let round = 0; round < MAX_COLUMNS; round++)
    for (const link of links) {
      if (link.from === link.to) continue;
      const next = Math.min((depth.get(link.from) ?? 0) + 1, MAX_COLUMNS - 1);
      if (next > (depth.get(link.to) ?? 0)) depth.set(link.to, next);
    }
  const filled = new Map<number, number>();
  const nodes = base.map((node) => {
    const column = depth.get(node.id) ?? 0;
    const row = filled.get(column) ?? 0;
    filled.set(column, row + 1);
    return { ...node, severity: worst.get(node.id) ?? null, column, row };
  });
  return {
    nodes,
    links,
    columns: Math.max(1, ...nodes.map((node) => node.column + 1)),
    rows: Math.max(1, ...filled.values()),
  };
}

const SVG = 'http://www.w3.org/2000/svg';
/** The arrowhead's own drawing space: a triangle pointing right, tip at (10, 5). */
const ARROW_SHAPE = { viewBox: '0 0 10 10', d: 'M 0 0 L 10 5 L 0 10 z', tipX: '10', tipY: '5' };

/** The map's geometry in pixels, from the `--fleet-map-*` tokens of tokens.css. */
interface Geometry {
  readonly width: number;
  readonly height: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly curve: number;
  readonly loop: number;
  readonly reach: number;
  readonly padding: number;
  readonly inset: number;
  readonly lagOffset: number;
  readonly arrow: number;
}

/**
 * SVG paths need numbers: the tokens are read as the page resolved them (px or rem). A missing
 * token is a broken stylesheet, reported as such rather than drawn with made-up sizes.
 */
function geometry(svg: SVGSVGElement): Geometry {
  const style = getComputedStyle(svg);
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const read = (name: string) => {
    const match = /^(\d*\.?\d+)(px|rem)$/.exec(style.getPropertyValue(name).trim());
    if (!match) throw new Error(`Missing design token ${name}`);
    return Number(match[1]) * (match[2] === 'rem' ? root : 1);
  };
  return {
    width: read('--fleet-map-node-width'),
    height: read('--fleet-map-node-height'),
    gapX: read('--fleet-map-gap-x'),
    gapY: read('--fleet-map-gap-y'),
    curve: read('--fleet-map-curve'),
    loop: read('--fleet-map-loop'),
    reach: read('--fleet-map-loop-reach'),
    padding: read('--fleet-map-padding'),
    inset: read('--fleet-map-label-inset'),
    lagOffset: read('--fleet-map-lag-offset'),
    arrow: read('--fleet-map-arrow'),
  };
}

const element = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
) => {
  const created = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) created.setAttribute(key, value);
  return created;
};
/** Long names end in an ellipsis inside the box; the full name is the node's tooltip. */
const fit = (text: string) =>
  Array.from(text).length > 24 ? `${Array.from(text).slice(0, 23).join('')}…` : text;
const point = (x: number, y: number) => `${String(x)} ${String(y)}`;

function arrowMarker(size: number) {
  const marker = element('marker', {
    id: 'fleet-arrow',
    viewBox: ARROW_SHAPE.viewBox,
    refX: ARROW_SHAPE.tipX,
    refY: ARROW_SHAPE.tipY,
    markerUnits: 'userSpaceOnUse',
    markerWidth: String(size),
    markerHeight: String(size),
    orient: 'auto-start-reverse',
  });
  marker.append(element('path', { d: ARROW_SHAPE.d, class: 'fleet-map-arrowhead' }));
  const defs = element('defs', {});
  defs.append(marker);
  return defs;
}

/**
 * Draws the layout into `svg`. Every text from a site is a text node, never markup; the map has
 * a table next to it with the same facts for keyboards and screen readers. Colors, dashes and
 * corner radius are classes and tokens (operations.css); sizes come from the same tokens.
 */
export function drawMap(svg: SVGSVGElement, layout: MapLayout, lagLabel: (lag: string) => string) {
  const g = geometry(svg);
  const position = (node: MapNode) => ({
    x: node.column * (g.width + g.gapX),
    y: node.row * (g.height + g.gapY),
  });
  const width = layout.columns * (g.width + g.gapX) - g.gapX;
  const height = layout.rows * (g.height + g.gapY) - g.gapY;
  // Loops (back and self links) rise above the first row and reach past the outer columns.
  const left = g.padding + g.reach;
  const top = g.padding + g.loop;
  const outerWidth = width + 2 * left;
  const outerHeight = height + top + g.padding;
  svg.setAttribute('viewBox', `${point(-left, -top)} ${point(outerWidth, outerHeight)}`);
  svg.setAttribute('width', String(outerWidth));
  svg.setAttribute('height', String(outerHeight));
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edges = layout.links.flatMap((link) => {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) return [];
    const a = position(from);
    const b = position(to);
    const start = { x: a.x + g.width, y: a.y + g.height / 2 };
    const end = { x: b.x, y: b.y + g.height / 2 };
    // A site feeding itself or a node to its left loops around instead of crossing boxes.
    const back = end.x <= start.x;
    const d = back
      ? `M ${point(start.x, start.y)} C ${point(start.x + g.reach, start.y - g.loop)}, ${point(end.x - g.reach, end.y - g.loop)}, ${point(end.x, end.y)}`
      : `M ${point(start.x, start.y)} C ${point(start.x + g.curve, start.y)}, ${point(end.x - g.curve, end.y)}, ${point(end.x, end.y)}`;
    const classes = ['fleet-map-link', link.failing ? 'failing' : '', link.stale ? 'stale' : ''];
    const group = element('g', { class: classes.filter(Boolean).join(' ') });
    const path = element('path', { d, 'marker-end': 'url(#fleet-arrow)' });
    const title = element('title', {});
    title.textContent = link.repository;
    group.append(path, title);
    if (link.lagChanges !== null && link.lagChanges !== '0') {
      const label = element('text', {
        x: String((start.x + end.x) / 2),
        y: String((start.y + end.y) / 2 - g.lagOffset),
        'text-anchor': 'middle',
      });
      label.textContent = lagLabel(link.lagChanges);
      group.append(label);
    }
    return [group];
  });
  const boxes = layout.nodes.map((node) => {
    const at = position(node);
    const group = element('g', {
      class: 'fleet-map-node',
      'data-state': node.state,
      'data-severity': node.severity ?? 'none',
      transform: `translate(${point(at.x, at.y)})`,
    });
    const title = element('title', {});
    title.textContent = node.name;
    // Vertically centred by `dominant-baseline` in operations.css.
    const label = element('text', { x: String(g.inset), y: String(g.height / 2) });
    label.textContent = fit(node.name);
    group.append(
      element('rect', { width: String(g.width), height: String(g.height) }),
      title,
      label,
    );
    return group;
  });
  svg.replaceChildren(arrowMarker(g.arrow), ...edges, ...boxes);
}
