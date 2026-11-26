import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import type { SystemLicense, SystemModule } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { clearMessage, dateMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';
import { showFailure } from './feedback.js';
import { onViewOpen, showView } from './shell.js';

type Tone = 'success' | 'warning' | 'error' | 'neutral';

// Later servers may add states; an unknown one is shown as not ok, as the contract says.
const health: Readonly<Record<string, readonly [MessageKey, Tone]>> = {
  ok: ['moduleOk', 'success'],
  degraded: ['moduleDegraded', 'warning'],
  failed: ['moduleFailed', 'error'],
  revoked: ['moduleRevoked', 'error'],
  unavailable: ['moduleUnavailable', 'error'],
};
const licenceStates: Readonly<Record<string, readonly [MessageKey, Tone]>> = {
  valid: ['licenseValid', 'success'],
  'offline-grace': ['licenseOfflineGrace', 'warning'],
  grace: ['licenseGrace', 'warning'],
  mismatch: ['licenseMismatch', 'warning'],
  expired: ['licenseExpired', 'error'],
  revoked: ['licenseRevoked', 'error'],
  invalid: ['licenseInvalid', 'error'],
};

function moduleState(module: SystemModule): readonly [MessageKey, Tone] {
  if (!module.enabled) return ['moduleOff', 'neutral'];
  if (module.health === null) return ['moduleIdle', 'neutral'];
  return health[module.health.status] ?? ['moduleNotOk', 'error'];
}

function badge(key: MessageKey, tone: Tone, params: Readonly<Record<string, string>> = {}) {
  const node = document.createElement('span');
  node.className = 'badge';
  if (tone !== 'neutral') node.dataset['tone'] = tone;
  message(node, key, params);
  return node;
}

function cell(...children: Node[]) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}

/** A word the server sends (a module id, an extension point): data, shown as it is. */
function data(text: string, className = '') {
  const node = document.createElement('span');
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/** `builtin` and `signed` in words; a source a later server adds is shown as it is sent. */
function source(value: string) {
  if (value === 'builtin') return badge('modulesSourceBuiltin', 'neutral');
  if (value === 'signed') return badge('modulesSourceSigned', 'neutral');
  return data(value);
}

function moduleRow(module: SystemModule) {
  const row = document.createElement('tr');
  const name = cell(data(module.id, 'module-name'));
  if (module.core) name.append(badge('modulesCore', 'neutral'));
  const [key, tone] = moduleState(module);
  const params = key === 'moduleNotOk' ? { status: module.health?.status ?? '' } : {};
  const state = cell(badge(key, tone, params));
  if (module.health?.code) state.append(data(module.health.code, 'hint mono'));
  row.append(
    name,
    cell(data(module.version, 'mono')),
    cell(data(module.kind)),
    cell(source(module.source)),
    state,
  );
  return row;
}

function licenceRow(licence: SystemLicense) {
  const row = document.createElement('tr');
  const [key, tone] = licenceStates[licence.state] ?? ['licenseUnknown', 'error'];
  const state = cell(badge(key, tone, key === 'licenseUnknown' ? { state: licence.state } : {}));
  if (licence.refreshFailing) {
    const note = document.createElement('span');
    note.className = 'hint';
    message(note, 'licenseRefreshFailing');
    state.append(note);
  }
  const until = document.createElement('span');
  if (licence.notAfter) dateMessage(until, licence.notAfter);
  else message(until, 'licensePerpetual');
  const term = cell(until);
  // In a grace state paid writes stop earlier than the term: show when, below the term.
  const graceEnd =
    licence.state === 'offline-grace' ? licence.offlineGraceUntil : licence.graceUntil;
  if (['grace', 'offline-grace', 'mismatch'].includes(licence.state) && graceEnd) {
    const grace = document.createElement('span');
    grace.className = 'hint';
    message(grace, 'licenseGraceUntil', { date: graceEnd }, [], ['date']);
    term.append(grace);
  }
  row.append(
    cell(data(licence.licenseType ?? '—')),
    cell(data(licence.licensee ?? '—')),
    state,
    term,
    cell(data(licence.features.join(', ') || '—')),
  );
  return row;
}

/**
 * Modules & licence (ADR 0078, 0079): what the installation runs and the licences it verified,
 * for global administrators. It only reads: modules are installed on the host, never from here.
 */
export class ModulesPage {
  private readonly nav = element('modules-nav', HTMLButtonElement);
  private readonly status = element('modules-status', HTMLOutputElement);
  private generation = 0;
  constructor(private readonly client: ArkvoryClient) {
    onViewOpen('modules', () => {
      void this.load();
    });
  }
  connect(administrator: boolean) {
    this.clear();
    this.nav.hidden = !administrator;
  }
  clear() {
    this.generation++;
    this.nav.hidden = true;
    clearMessage(this.status);
    this.status.hidden = true;
    this.forget();
    if (!element('modules-panel', HTMLElement).hidden) showView('catalog');
  }
  /** Nothing of an earlier account or load stays on screen, and no licence state is guessed. */
  private forget() {
    clearMessage(element('modules-api', HTMLElement));
    element('modules-rows', HTMLTableSectionElement).replaceChildren();
    element('licence-rows', HTMLTableSectionElement).replaceChildren();
    element('licence-table', HTMLElement).hidden = true;
    element('licence-none', HTMLElement).hidden = true;
  }
  private async load() {
    const generation = ++this.generation;
    this.status.hidden = true;
    this.forget();
    try {
      const [modules, licences] = await Promise.all([
        this.client.system.modules(),
        this.client.system.license(),
      ]);
      if (generation !== this.generation) return;
      message(element('modules-api', HTMLElement), 'modulesApi', {
        version: modules.extensionApi,
      });
      element('modules-rows', HTMLTableSectionElement).replaceChildren(
        ...modules.modules.map(moduleRow),
      );
      element('licence-rows', HTMLTableSectionElement).replaceChildren(
        ...licences.licenses.map(licenceRow),
      );
      element('licence-table', HTMLElement).hidden = licences.licenses.length === 0;
      element('licence-none', HTMLElement).hidden = licences.licenses.length > 0;
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.hidden = false;
      showFailure(this.status, error);
    }
  }
}
