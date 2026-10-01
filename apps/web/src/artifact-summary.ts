import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { bytesMessage, clearMessage, dateMessage } from './i18n.js';
import { feedback } from './feedback.js';

/** Size, upload time and SHA-256 of the selected artifact, read from its immutable descriptor. */
export function installArtifactSummary(client: ArkvoryClient, status: HTMLElement) {
  const summary = element('artifact-summary', HTMLDListElement);
  const size = element('summary-size', HTMLElement);
  const created = element('summary-created', HTMLElement);
  const hash = element('summary-sha', HTMLElement);
  const copy = element('summary-copy', HTMLButtonElement);
  let generation = 0;
  copy.onclick = () => {
    void navigator.clipboard.writeText(hash.textContent).then(
      () => {
        feedback(status, 'hashCopied', {}, 'success');
      },
      () => {
        feedback(status, 'copyFailed', {}, 'error');
      },
    );
  };
  return {
    async open(repository: string, id: string) {
      const own = ++generation;
      const artifact = await client.artifact(repository, id);
      if (own !== generation) return;
      bytesMessage(size, artifact.descriptor.size);
      dateMessage(created, artifact.createdAt);
      hash.textContent = artifact.descriptor.sha256;
      summary.hidden = false;
    },
    clear() {
      generation++;
      summary.hidden = true;
      clearMessage(size);
      clearMessage(created);
      hash.textContent = '';
    },
  };
}
