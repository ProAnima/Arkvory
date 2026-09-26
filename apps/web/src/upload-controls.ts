import { element } from './dom.js';

/** Own the interaction lock, including navigation away while bytes are still in flight. */
export function installUploadControls(active: () => boolean) {
  window.addEventListener('beforeunload', (event) => {
    if (active()) event.preventDefault();
  });
  return (busy: boolean) => {
    element('connection-fields', HTMLFieldSetElement).disabled = busy;
    for (const formId of ['login', 'change-password'])
      for (const input of element(formId, HTMLFormElement).querySelectorAll<
        HTMLInputElement | HTMLButtonElement
      >('input, button'))
        input.disabled = busy;
    element('upload-submit', HTMLButtonElement).disabled = busy;
    element('cancel', HTMLButtonElement).disabled = !busy;
    for (const id of ['file', 'upload-id', 'idempotency'])
      element(id, HTMLInputElement).disabled = busy;
    element('new-upload', HTMLButtonElement).disabled = busy;
  };
}
