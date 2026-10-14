import type { FleetOverview, FleetOverviewAlert, FleetSite } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message, relativeMessage, t } from './i18n.js';
import type { MessageKey } from './messages.js';
import { drawMap, layoutMap } from './fleet-map.js';

const kinds: Record<FleetOverviewAlert['kind'], MessageKey> = {
  unreachable: 'fleetAlertUnreachable',
  certificate: 'fleetAlertCertificate',
  revoked: 'fleetAlertRevoked',
  refused: 'fleetAlertRefused',
  invalid: 'fleetAlertInvalid',
  stale: 'fleetAlertStale',
  'not-writable': 'fleetAlertNotWritable',
  copies: 'fleetAlertCopies',
  'single-copy': 'fleetAlertSingleCopy',
  'mirror-failing': 'fleetAlertMirrorFailing',
  'mirror-lag': 'fleetAlertMirrorLag',
  'updates-failed': 'fleetAlertUpdatesFailed',
  'version-skew': 'fleetAlertVersionSkew',
};
const severities: Record<FleetOverviewAlert['severity'], MessageKey> = {
  critical: 'fleetSeverityCritical',
  warning: 'fleetSeverityWarning',
  info: 'fleetSeverityInfo',
};

/** The map's element: `element()` knows HTML elements only. */
function svg(id: string): SVGSVGElement {
  const found = document.getElementById(id);
  if (!(found instanceof SVGSVGElement)) throw new Error(`Missing #${id}`);
  return found;
}

const cell = (text: string) => {
  const td = document.createElement('td');
  // Names, origins and repositories come from sites: text, never markup.
  td.textContent = text;
  return td;
};

/**
 * The fleet at a glance on the Sites page (ADR 0077, stage F4): what needs attention, most severe
 * first, and who feeds whom as a map with the same facts in a table next to it.
 */
export class FleetOverviewPanel {
  private readonly card = element('fleet-overview', HTMLElement);
  private readonly alerts = element('fleet-alerts', HTMLUListElement);
  private readonly links = element('fleet-link-rows', HTMLTableSectionElement);
  private readonly map = svg('fleet-map');

  show(overview: FleetOverview, sites: readonly FleetSite[]) {
    this.card.hidden = false;
    const self = t('fleetThisSite');
    const names = new Map<string, string>([['self', self]]);
    for (const site of sites) names.set(site.id, site.name);
    const nameOf = (id: string) => names.get(id) ?? id.replace(/^external:/, '');
    this.alerts.replaceChildren(...overview.alerts.map((alert) => this.alert(alert, nameOf)));
    element('fleet-alerts-none', HTMLElement).hidden = overview.alerts.length > 0;
    this.links.replaceChildren(
      ...overview.links.map((link) => {
        const row = document.createElement('tr');
        const behind = document.createElement('td');
        if (link.failing) message(behind, 'fleetLinkFailing');
        else if (link.lagChanges === null) behind.textContent = '—';
        else message(behind, 'fleetLagValue', { lag: link.lagChanges });
        row.append(
          cell(nameOf(link.from)),
          cell(nameOf(link.to)),
          cell(link.repository),
          cell(link.sourceRepository),
          behind,
        );
        return row;
      }),
    );
    element('fleet-links-none', HTMLElement).hidden = overview.links.length > 0;
    // Mirrors of this installation's own repositories meet it only by its address.
    element('fleet-map-hint', HTMLElement).hidden =
      overview.self.url !== null || overview.external.length === 0;
    drawMap(this.map, layoutMap(overview, sites, self), (lag) => t('fleetLagValue', { lag }));
  }

  clear() {
    this.card.hidden = true;
    this.alerts.replaceChildren();
    this.links.replaceChildren();
    this.map.replaceChildren();
  }

  private alert(alert: FleetOverviewAlert, nameOf: (id: string) => string) {
    const item = document.createElement('li');
    item.dataset['severity'] = alert.severity;
    const badge = document.createElement('span');
    badge.className = 'badge';
    message(badge, severities[alert.severity]);
    const name = document.createElement('strong');
    name.textContent = alert.site === 'self' ? nameOf('self') : alert.name;
    const text = document.createElement('span');
    message(text, kinds[alert.kind], { subject: alert.subject ?? '' });
    item.append(badge, name, text);
    if (alert.since) {
      const since = document.createElement('span');
      since.className = 'hint';
      relativeMessage(since, alert.since);
      item.append(since);
    }
    return item;
  }
}
