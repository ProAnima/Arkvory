import { message } from './i18n.js';

/** Keep the real file input and native picker, but localize its in-page presentation. */
export function initializeFileInputs() {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    const control = document.createElement('span');
    control.className = 'file-control';
    const action = document.createElement('span');
    action.className = 'file-control-action';
    action.setAttribute('aria-hidden', 'true');
    message(action, 'fileBrowse');
    const selection = document.createElement('span');
    selection.className = 'file-control-selection';
    selection.setAttribute('aria-live', 'polite');
    const refresh = () => {
      const file = input.files?.[0];
      if (file) {
        delete selection.dataset['i18n'];
        selection.textContent = file.name;
      } else message(selection, 'fileNotSelected');
    };
    input.replaceWith(control);
    control.append(input, action, selection);
    input.addEventListener('change', refresh);
    input.form?.addEventListener('reset', (event) => {
      // The reset event precedes the browser's clearing of FileList.
      queueMicrotask(() => {
        if (!event.defaultPrevented) refresh();
      });
    });
    refresh();
  }
}
