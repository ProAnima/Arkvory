import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { message } from './i18n.js';
import { showFailure } from './feedback.js';

/**
 * "Download link" on the artifact page (ADR 0062): a link for an hour, copied to the clipboard
 * when the browser allows it and shown for manual copying otherwise. The link is a secret: it
 * stays in this page until another artifact is opened.
 */
export function installDownloadLink(
  client: ArkvoryClient,
  selected: () => { readonly repository: string; readonly id: string } | undefined,
) {
  const button = element('download-link', HTMLButtonElement);
  const result = element('download-link-result', HTMLElement);
  const note = element('download-link-note', HTMLElement);
  const url = element('download-link-url', HTMLInputElement);
  const clear = () => {
    result.hidden = true;
    url.value = '';
  };
  button.onclick = async () => {
    const artifact = selected();
    if (!artifact) return;
    button.disabled = true;
    try {
      const link = await client.createDownloadLink(artifact.repository, artifact.id);
      url.value = link.url;
      const copied = await navigator.clipboard
        .writeText(link.url)
        .then(() => true)
        .catch(() => false);
      message(
        note,
        copied ? 'downloadLinkCopied' : 'downloadLinkCopy',
        { expires: link.expiresAt },
        [],
        ['expires'],
      );
      result.hidden = false;
      if (!copied) url.select();
    } catch (error) {
      result.hidden = false;
      url.value = '';
      showFailure(note, error);
    } finally {
      button.disabled = false;
    }
  };
  return {
    /** Another artifact: the previous link leaves the page; the action follows the operations. */
    open(allowed: boolean) {
      clear();
      button.hidden = !allowed;
    },
  };
}
