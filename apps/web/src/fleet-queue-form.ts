import type {
  DownloadSettingOverrides,
  DownloadSettings,
  DownloadSettingsChange,
  DownloadSettingValues,
} from '@proanima/arkvory-contracts';
import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { clearMessage, message, relativeMessage } from './i18n.js';
import { feedback, showFailure } from './feedback.js';
import type { MessageKey } from './messages.js';

/** Where the form reads and saves: this installation or a managed site through it. */
export interface QueueSettingsPort {
  get(): Promise<DownloadSettings>;
  change(change: DownloadSettingsChange): Promise<DownloadSettings>;
}

const MIB = 1024 * 1024;
type Count =
  'sessions' | 'reserve' | 'perPrincipal' | 'idleSeconds' | 'agingMinutes' | 'rangesPerSession';
type Weight = keyof DownloadSettingValues['weights'];
const counts: readonly (readonly [Count, MessageKey])[] = [
  ['sessions', 'fleetSessions'],
  ['reserve', 'fleetReserve'],
  ['perPrincipal', 'fleetPerPrincipal'],
  ['idleSeconds', 'fleetIdle'],
  ['agingMinutes', 'fleetAging'],
  ['rangesPerSession', 'fleetRanges'],
];
const classes: readonly (readonly [Weight, MessageKey])[] = [
  ['interactive', 'fleetWeightInteractive'],
  ['release', 'fleetWeightRelease'],
  ['bulk', 'fleetWeightBulk'],
  ['background', 'fleetWeightBackground'],
];
const strategies = [
  ['ordered', 'fleetStrategyOrdered'],
  ['smallest-first', 'fleetStrategySmallest'],
  ['shared', 'fleetStrategyShared'],
] as const;

function field<T extends HTMLInputElement | HTMLSelectElement>(
  form: HTMLElement,
  key: MessageKey,
  control: T,
): T {
  const label = document.createElement('label');
  const name = document.createElement('span');
  message(name, key);
  label.append(name, control);
  form.append(label);
  return control;
}

function number(minimum: number, maximum: number) {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = '1';
  return input;
}

/** A choice whose empty option means "as the server's environment sets it". */
function choice(options: readonly (readonly [string, MessageKey])[]) {
  const select = document.createElement('select');
  select.append(new Option('', ''));
  for (const [value, key] of options) {
    const option = new Option('', value);
    message(option, key);
    select.append(option);
  }
  return select;
}

/**
 * Download queue settings (ADR 0076, stage 3). An empty field keeps the server's environment
 * value, shown as its placeholder; saving sends only the filled fields, which replace every
 * earlier change.
 */
export class QueueSettingsForm {
  private readonly form = element('fleet-queue-form', HTMLFormElement);
  private readonly fields = element('fleet-queue-fields', HTMLElement);
  private readonly status = element('fleet-queue-status', HTMLOutputElement);
  private readonly changed = element('fleet-queue-changed', HTMLElement);
  private readonly strategy = choice(strategies);
  private readonly preempt = choice([
    ['true', 'fleetPreemptOn'],
    ['false', 'fleetPreemptOff'],
  ]);
  private readonly numbers = new Map<Count, HTMLInputElement>();
  private readonly weights = new Map<Weight, HTMLInputElement>();
  private readonly minimum = number(0, 1_000_000);
  private port: QueueSettingsPort | null = null;
  /** Null until the site's settings are shown: nothing can be saved over unknown settings. */
  private revision: number | null = null;
  private generation = 0;

  constructor() {
    field(this.fields, 'fleetStrategy', this.strategy);
    for (const [name, key] of counts)
      this.numbers.set(name, field(this.fields, key, number(0, 10080)));
    field(this.fields, 'fleetSessionMin', this.minimum);
    field(this.fields, 'fleetPreempt', this.preempt);
    const weights = element('fleet-queue-weights', HTMLElement);
    for (const [name, key] of classes) this.weights.set(name, field(weights, key, number(1, 1000)));
    this.form.onsubmit = (event) => {
      event.preventDefault();
      const overrides = this.overrides();
      if (overrides) void this.save(overrides);
      else {
        this.status.hidden = false;
        feedback(this.status, 'fleetQueueInvalid', {}, 'error');
      }
    };
    this.ready(false);
    element('fleet-queue-reset', HTMLButtonElement).onclick = () => {
      void this.save({});
    };
  }

  async open(port: QueueSettingsPort) {
    this.port = port;
    this.revision = null;
    this.ready(false);
    this.status.hidden = true;
    const generation = ++this.generation;
    try {
      const settings = await port.get();
      if (generation === this.generation) this.show(settings);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }

  clear() {
    this.generation++;
    this.port = null;
    this.revision = null;
    this.ready(false);
    this.form.reset();
    this.status.hidden = true;
    clearMessage(this.changed);
  }

  private ready(on: boolean) {
    element('fleet-queue-save', HTMLButtonElement).disabled = !on;
    element('fleet-queue-reset', HTMLButtonElement).disabled = !on;
  }

  private show(settings: DownloadSettings) {
    this.revision = settings.revision;
    this.ready(true);
    // Under `shared` the session settings wait unused: say so rather than let them look live.
    element('fleet-queue-admission', HTMLElement).hidden = settings.admission !== 'per-request';
    const { overrides, defaults } = settings;
    this.strategy.value = overrides.strategy ?? '';
    this.label(this.strategy, defaults.strategy);
    this.preempt.value = overrides.preempt === undefined ? '' : String(overrides.preempt);
    this.label(this.preempt, String(defaults.preempt));
    for (const [name, input] of this.numbers) {
      const value = overrides[name];
      input.value = value === undefined ? '' : String(value);
      input.placeholder = String(defaults[name]);
    }
    this.minimum.value =
      overrides.sessionMinBytes === undefined ? '' : String(overrides.sessionMinBytes / MIB);
    this.minimum.placeholder = String(Math.round(defaults.sessionMinBytes / MIB));
    for (const [name, input] of this.weights) {
      input.value = overrides.weights ? String(overrides.weights[name]) : '';
      input.placeholder = String(defaults.weights[name]);
    }
    if (settings.problem) {
      this.status.hidden = false;
      feedback(this.status, 'fleetQueueProblem', { problem: settings.problem }, 'error');
    }
    if (settings.updatedAt) {
      const who = settings.actor
        ? `${settings.actor} (${settings.updatedBy ?? ''})`
        : settings.updatedBy;
      message(this.changed, 'fleetQueueChanged', { who: who ?? '—' });
      const when = document.createElement('span');
      relativeMessage(when, settings.updatedAt);
      this.changed.append(' ', when);
    } else clearMessage(this.changed);
  }

  /** The empty option names the default it stands for. */
  private label(select: HTMLSelectElement, value: string) {
    const option = select.options[0];
    const known = [...select.options].find((item) => item.value === value);
    if (option) message(option, 'fleetDefault', { value: known?.text ?? value });
  }

  /** Null when a field holds something that is not a whole number: never sent as "default". */
  private overrides(): DownloadSettingOverrides | null {
    const inputs = [...this.numbers.values(), this.minimum, ...this.weights.values()];
    if (
      inputs.some(
        (input) =>
          input.validity.badInput || (input.value !== '' && !Number.isInteger(Number(input.value))),
      )
    )
      return null;
    const result: { -readonly [K in keyof DownloadSettingValues]?: DownloadSettingValues[K] } = {};
    const strategy = strategies.find(([value]) => value === this.strategy.value);
    if (strategy) result.strategy = strategy[0];
    if (this.preempt.value) result.preempt = this.preempt.value === 'true';
    for (const [name, input] of this.numbers)
      if (input.value !== '') result[name] = Number(input.value);
    if (this.minimum.value !== '') result.sessionMinBytes = Number(this.minimum.value) * MIB;
    const filled = [...this.weights.values()].filter((input) => input.value !== '');
    // Weights go together: a partial set would keep defaults for the rest without saying so.
    if (filled.length) {
      const weight = (name: Weight) => {
        const input = this.weights.get(name);
        return Number(input?.value || input?.placeholder || '1');
      };
      result.weights = {
        interactive: weight('interactive'),
        release: weight('release'),
        bulk: weight('bulk'),
        background: weight('background'),
      };
    }
    return result;
  }

  private async save(overrides: DownloadSettingOverrides) {
    const port = this.port;
    const revision = this.revision;
    if (!port || revision === null) return;
    const generation = this.generation;
    this.ready(false);
    try {
      const saved = await port.change({ expectedRevision: revision, overrides });
      if (generation !== this.generation) return;
      this.show(saved);
      this.status.hidden = false;
      feedback(this.status, 'fleetQueueSaved', {}, 'success');
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ArkvoryHttpError && error.code === 'conflict') {
        // Someone saved meanwhile: show what is stored now rather than overwrite it.
        await this.open(port);
        this.status.hidden = false;
        feedback(this.status, 'fleetQueueConflict', {}, 'error');
      } else this.fail(error);
    } finally {
      if (generation === this.generation && this.revision !== null) this.ready(true);
    }
  }

  private fail(error: unknown) {
    this.status.hidden = false;
    showFailure(this.status, error);
  }
}
