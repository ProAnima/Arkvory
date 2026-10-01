import { fieldProblems } from './error-keys.js';
import { clearMessage, message } from './i18n.js';
import type { MessageKey } from './messages.js';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/** Request field (JSON Pointer or parameter name, ADR 0051) → id of the control that edits it. */
export type FieldMap = Readonly<Record<string, string>>;

const problemKeys: Readonly<Record<string, MessageKey>> = {
  required: 'fieldRequired',
  unknown_field: 'fieldUnknown',
  type: 'fieldType',
  format: 'fieldFormat',
  length: 'fieldLength',
  range: 'fieldRange',
  invalid: 'fieldInvalid',
};
const watched = new WeakSet<Control>();

function control(id: string): Control | undefined {
  const node = document.getElementById(id);
  return node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
    ? node
    : undefined;
}
const errorId = (input: Control) => `${input.id}-error`;

function describedBy(input: Control, id: string, present: boolean) {
  const tokens = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const next = present ? [...new Set([...tokens, id])] : tokens.filter((token) => token !== id);
  if (next.length) input.setAttribute('aria-describedby', next.join(' '));
  else input.removeAttribute('aria-describedby');
}

function clearField(input: Control) {
  input.removeAttribute('aria-invalid');
  describedBy(input, errorId(input), false);
  const note = document.getElementById(errorId(input));
  if (note) {
    clearMessage(note);
    note.hidden = true;
  }
}

function markField(input: Control, problem: string) {
  let note = document.getElementById(errorId(input));
  if (!note) {
    note = document.createElement('span');
    note.id = errorId(input);
    note.className = 'field-error';
    input.after(note);
  }
  note.hidden = false;
  message(note, problemKeys[problem] ?? 'fieldInvalid');
  // A collapsed advanced section must not hide the field that needs attention.
  const section = input.closest('details');
  if (section && !section.open) section.open = true;
  input.setAttribute('aria-invalid', 'true');
  describedBy(input, note.id, true);
  // Editing the value withdraws the server's verdict about the previous one.
  if (!watched.has(input)) {
    watched.add(input);
    input.addEventListener('input', () => {
      clearField(input);
    });
  }
}

export function clearFieldErrors(fields: FieldMap) {
  for (const id of Object.values(fields)) {
    const input = control(id);
    if (input) clearField(input);
  }
}

/** Marks the inputs named by the failure and focuses the first; returns whether any matched. */
export function showFieldErrors(fields: FieldMap, error: unknown): boolean {
  let first: Control | undefined;
  for (const { field, problem } of fieldProblems(error)) {
    const id = fields[field];
    const input = id === undefined ? undefined : control(id);
    if (!input) continue;
    markField(input, problem);
    first ??= input;
  }
  first?.focus();
  return first !== undefined;
}

/** Wraps a form action: clears old marks, marks failing inputs, still reports the failure. */
export function withFieldErrors(fields: FieldMap, action: () => Promise<void>) {
  return async () => {
    clearFieldErrors(fields);
    try {
      await action();
    } catch (error) {
      showFieldErrors(fields, error);
      throw error;
    }
  };
}
