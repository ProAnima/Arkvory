import { stringMap } from '@proanima/arkvory-contracts';
import { element } from './dom.js';
import { message } from './i18n.js';
import { UiError } from './feedback.js';

// arkvory-exception ARCH-020 -- Existing UI controller contains event wiring and view state; freeze its size and extract cohesive controllers only with browser state/reset acceptance.
export function installAnnotationEditor() {
  const rows = element('metadata-fields', HTMLDivElement);
  const raw = element('metadata', HTMLTextAreaElement);
  const labels = element('labels', HTMLInputElement);
  const add = element('metadata-add', HTMLButtonElement);
  let editable = false;
  let source: 'rows' | 'json' = 'rows';
  const sync = () => {
    source = 'rows';
    raw.value = JSON.stringify(
      Object.fromEntries(
        [...rows.children]
          .map((row) => {
            const inputs = row.querySelectorAll('input');
            return [inputs[0]?.value ?? '', inputs[1]?.value ?? ''];
          })
          .filter(([key, value]) => key || value),
      ),
      null,
      2,
    );
  };
  function row(key = '', value = '') {
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
      input.disabled = !editable;
      input.addEventListener('input', sync);
      label.append(caption, input);
      container.append(label);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small';
    message(remove, 'metadataRemove');
    remove.disabled = !editable;
    remove.onclick = () => {
      const next = container.nextElementSibling ?? container.previousElementSibling;
      container.remove();
      sync();
      add.disabled = !editable || rows.children.length >= 32;
      (next?.querySelector('input') ?? add).focus();
    };
    container.append(remove);
    rows.append(container);
    add.disabled = !editable || rows.children.length >= 32;
  }
  const presets = element('label-presets', HTMLDivElement);
  const refreshLabels = () => {
    const current = labels.value.split(',').map((label) => label.trim());
    for (const button of presets.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(current.includes(button.textContent)));
  };
  for (const name of ['nightly', 'test', 'staging', 'release']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.className = 'secondary small';
    button.disabled = true;
    button.onclick = () => {
      const current = labels.value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      labels.value = (
        current.includes(name) ? current.filter((label) => label !== name) : [...current, name]
      ).join(', ');
      refreshLabels();
    };
    presets.append(button);
  }
  labels.addEventListener('input', refreshLabels);
  add.onclick = () => {
    if (rows.children.length < 32) {
      row();
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
      for (const [key, entry] of Object.entries(value)) row(key, entry);
    } catch {
      /* Keep invalid JSON visible for correction. */
    }
  });
  return {
    set(value: Readonly<Record<string, string>>, canWrite: boolean) {
      editable = canWrite;
      source = 'rows';
      rows.replaceChildren();
      for (const [key, entry] of Object.entries(value)) row(key, entry);
      raw.value = JSON.stringify(value, null, 2);
      raw.disabled = !editable;
      add.disabled = !editable || rows.children.length >= 32;
      for (const button of presets.querySelectorAll('button')) button.disabled = !editable;
      refreshLabels();
    },
    read(): Readonly<Record<string, string>> {
      try {
        if (source === 'rows') {
          const names = new Set<string>();
          for (const container of rows.children) {
            const inputs = container.querySelectorAll('input'),
              key = inputs[0]?.value ?? '',
              value = inputs[1]?.value ?? '';
            if (!key && !value) continue;
            if (!key || names.has(key)) throw new Error('Invalid key');
            names.add(key);
          }
          sync();
        }
        const value = stringMap(JSON.parse(raw.value));
        if (
          Object.keys(value).length > 32 ||
          Object.entries(value).some(
            ([key, entry]) =>
              !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) ||
              ['constructor', 'prototype', '__proto__'].includes(key) ||
              entry.length > 1024 ||
              entry.includes('\u0000'),
          )
        )
          throw new Error('Invalid metadata');
        return value;
      } catch {
        throw new UiError('metadataInvalid');
      }
    },
  };
}
