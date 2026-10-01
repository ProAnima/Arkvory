import { stringMap } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';
import { UiError } from './feedback.js';

const maximumFields = 32;
const presetLabels = ['nightly', 'test', 'staging', 'release'] as const;

interface MetadataRows {
  rows: HTMLDivElement;
  add: HTMLButtonElement;
  editable: () => boolean;
  sync: () => void;
}

function rowValues(container: Element): [string, string] {
  const inputs = container.querySelectorAll('input');
  return [inputs[0]?.value ?? '', inputs[1]?.value ?? ''];
}

function appendRow(ctx: MetadataRows, key = '', value = '') {
  const { rows, add } = ctx;
  const container = document.createElement('div');
  container.className = 'metadata-row';
  for (const [labelKey, current, max] of [
    ['metadataKey', key, 64],
    ['metadataValue', value, 1024],
  ] as const) {
    const label = document.createElement('label'),
      caption = document.createElement('span'),
      input = document.createElement('input');
    message(caption, labelKey);
    input.value = current;
    input.maxLength = max;
    input.disabled = !ctx.editable();
    input.addEventListener('input', ctx.sync);
    label.append(caption, input);
    container.append(label);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost small';
  message(remove, 'metadataRemove');
  remove.disabled = !ctx.editable();
  remove.onclick = () => {
    const next = container.nextElementSibling ?? container.previousElementSibling;
    container.remove();
    ctx.sync();
    add.disabled = !ctx.editable() || rows.children.length >= maximumFields;
    (next?.querySelector('input') ?? add).focus();
  };
  container.append(remove);
  rows.append(container);
  add.disabled = !ctx.editable() || rows.children.length >= maximumFields;
}

/** Toggle buttons for common labels; returns the refresh used after typing or loading. */
function installLabelPresets(labels: HTMLInputElement, presets: HTMLDivElement) {
  const current = () =>
    labels.value
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
  const refresh = () => {
    const values = current();
    for (const button of presets.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(values.includes(button.textContent)));
  };
  for (const name of presetLabels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.className = 'secondary small';
    button.disabled = true;
    button.onclick = () => {
      const values = current();
      labels.value = (
        values.includes(name) ? values.filter((label) => label !== name) : [...values, name]
      ).join(', ');
      refresh();
    };
    presets.append(button);
  }
  labels.addEventListener('input', refresh);
  return refresh;
}

function validMetadata(value: Readonly<Record<string, string>>) {
  return (
    Object.keys(value).length <= maximumFields &&
    Object.entries(value).every(
      ([key, entry]) =>
        /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) &&
        !['constructor', 'prototype', '__proto__'].includes(key) &&
        entry.length <= 1024 &&
        !entry.includes('\u0000'),
    )
  );
}

export function installAnnotationEditor() {
  const rows = element('metadata-fields', HTMLDivElement);
  const raw = element('metadata', HTMLTextAreaElement);
  const add = element('metadata-add', HTMLButtonElement);
  const presets = element('label-presets', HTMLDivElement);
  let editable = false;
  // The source of truth is whichever editor the person touched last.
  let source: 'rows' | 'json' = 'rows';
  const sync = () => {
    source = 'rows';
    raw.value = JSON.stringify(
      Object.fromEntries([...rows.children].map(rowValues).filter(([key, value]) => key || value)),
      null,
      2,
    );
  };
  const ctx: MetadataRows = { rows, add, editable: () => editable, sync };
  const refreshLabels = installLabelPresets(element('labels', HTMLInputElement), presets);
  add.onclick = () => {
    if (rows.children.length < maximumFields) {
      appendRow(ctx);
      rows.lastElementChild?.querySelector('input')?.focus();
    }
  };
  raw.addEventListener('input', () => {
    source = 'json';
  });
  raw.addEventListener('change', () => {
    try {
      const value = stringMap(JSON.parse(raw.value));
      rows.replaceChildren();
      for (const [key, entry] of Object.entries(value)) appendRow(ctx, key, entry);
    } catch {
      /* Keep invalid JSON visible for correction. */
    }
  });
  return {
    set(value: Readonly<Record<string, string>>, canWrite: boolean) {
      editable = canWrite;
      source = 'rows';
      rows.replaceChildren();
      for (const [key, entry] of Object.entries(value)) appendRow(ctx, key, entry);
      raw.value = JSON.stringify(value, null, 2);
      raw.disabled = !editable;
      add.disabled = !editable || rows.children.length >= maximumFields;
      for (const button of presets.querySelectorAll('button')) button.disabled = !editable;
      refreshLabels();
    },
    read(): Readonly<Record<string, string>> {
      try {
        if (source === 'rows') {
          const names = new Set<string>();
          for (const [key, value] of [...rows.children].map(rowValues)) {
            if (!key && !value) continue;
            if (!key || names.has(key)) throw new Error('Invalid key');
            names.add(key);
          }
          sync();
        }
        const value = stringMap(JSON.parse(raw.value));
        if (!validMetadata(value)) throw new Error('Invalid metadata');
        return value;
      } catch {
        throw new UiError('metadataInvalid');
      }
    },
  };
}
