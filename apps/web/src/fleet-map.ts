import type { FleetOverview, FleetOverviewLink, FleetSite } from '@proanima/arkvory-contracts';

/** One box of the map: a managed site, this installation or a source nobody here manages. */
export interface MapNode {
  readonly id: string;
  readonly name: string;
  /** `ok`, a site state, or `external`. */
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
  const links = overview.links.filter((link) => ids.has(link.from) && ids.has(link.to));
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
const BOX = { width: 184, height: 44, gapX: 72, gapY: 20 };
const element = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
) => {
  const created = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) created.setAttribute(key, value);
  return created;
};
const position = (node: MapNode) => ({
  x: node.column * (BOX.width + BOX.gapX),
  y: node.row * (BOX.height + BOX.gapY),
});
/** Long names end in an ellipsis inside the box; the full name is the node's tooltip. */
const fit = (text: string) =>
  Array.from(text).length > 24 ? `${Array.from(text).slice(0, 23).join('')}…` : text;

/**
 * Draws the layout into `svg`. Every text from a site is a text node, never markup; the map has
 * a table next to it with the same facts for keyboards and screen readers.
 */
export function drawMap(svg: SVGSVGElement, layout: MapLayout, lagLabel: (lag: string) => string) {
  const width = layout.columns * (BOX.width + BOX.gapX) - BOX.gapX;
  const height = layout.rows * (BOX.height + BOX.gapY) - BOX.gapY;
  svg.setAttribute('viewBox', `-8 -8 ${String(width + 16)} ${String(height + 16)}`);
  svg.setAttribute('width', String(width + 16));
  svg.setAttribute('height', String(height + 16));
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const defs = element('defs', {});
  const marker = element('marker', {
    id: 'fleet-arrow',
    viewBox: '0 0 10 10',
    refX: '10',
    refY: '5',
    markerWidth: '8',
    markerHeight: '8',
    orient: 'auto-start-reverse',
  });
  marker.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'fleet-map-arrowhead' }));
  defs.append(marker);
  const edges = layout.links.flatMap((link) => {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) return [];
    const a = position(from);
    const b = position(to);
    const start = { x: a.x + BOX.width, y: a.y + BOX.height / 2 };
    const end = { x: b.x, y: b.y + BOX.height / 2 };
    // A site feeding itself or a node to its left loops around instead of crossing boxes.
    const back = end.x <= start.x;
    const d = back
      ? `M ${String(start.x)} ${String(start.y)} C ${String(start.x + 48)} ${String(start.y - 60)}, ${String(end.x - 48)} ${String(end.y - 60)}, ${String(end.x)} ${String(end.y)}`
      : `M ${String(start.x)} ${String(start.y)} C ${String(start.x + 36)} ${String(start.y)}, ${String(end.x - 36)} ${String(end.y)}, ${String(end.x)} ${String(end.y)}`;
    const group = element('g', {
      class: link.failing ? 'fleet-map-link failing' : 'fleet-map-link',
    });
    const path = element('path', { d, 'marker-end': 'url(#fleet-arrow)' });
    const title = element('title', {});
    title.textContent = link.repository;
    group.append(path, title);
    if (link.lagChanges !== null && link.lagChanges !== '0') {
      const label = element('text', {
        x: String((start.x + end.x) / 2),
        y: String((start.y + end.y) / 2 - 6),
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
      transform: `translate(${String(at.x)} ${String(at.y)})`,
    });
    const title = element('title', {});
    title.textContent = node.name;
    const label = element('text', { x: '12', y: String(BOX.height / 2 + 5) });
    label.textContent = fit(node.name);
    group.append(
      element('rect', { width: String(BOX.width), height: String(BOX.height), rx: '6' }),
      title,
      label,
    );
    return group;
  });
  svg.replaceChildren(defs, ...edges, ...boxes);
}
