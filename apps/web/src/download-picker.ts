import { UiError } from './feedback.js';
declare global {
  interface Window {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  }
}
export async function chooseDestination(name: string) {
  const browser: { storage?: { getDirectory?: unknown }; locks?: unknown } = navigator;
  if (
    !window.showSaveFilePicker ||
    typeof browser.storage?.getDirectory !== 'function' ||
    !browser.locks
  )
    throw new UiError('saveUnsupported');
  try {
    // Keep the picker in the user's gesture; cancellation is not a failed download.
    return await window.showSaveFilePicker({ suggestedName: name });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    throw error;
  }
}
