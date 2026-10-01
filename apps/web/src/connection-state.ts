import { element } from './dom.js';
import { describeCredential } from './feedback.js';
import type { Credential } from './feedback.js';
import { message } from './i18n.js';
import { showGuideConnection } from './guides.js';

interface RepositoryStorage {
  connect: (repository: string) => Promise<void>;
  clear: () => void;
}

/**
 * Separates the credential (badge, Disconnect, card) from the repository catalog state.
 * Changing the repository clears the catalog but keeps a valid sign-in.
 */
export function installConnectionState(storage: RepositoryStorage, repository: HTMLInputElement) {
  const badge = element('connection-state', HTMLSpanElement),
    card = element('connection-card', HTMLDetailsElement),
    connectedRepository = element('connection-repository', HTMLSpanElement),
    actions = element('session-actions', HTMLDivElement);
  let credential: Credential = 'none';
  return {
    session(next: Credential) {
      const active = next !== 'none';
      if (active && credential === 'none') card.open = false;
      if (!active) card.open = true;
      credential = next;
      describeCredential(next);
      badge.dataset['connected'] = String(active);
      message(badge, active ? 'connected' : 'disconnected');
      actions.hidden = !active;
      showGuideConnection(active);
    },
    repository(connected: boolean) {
      connectedRepository.hidden = !connected;
      connectedRepository.textContent = connected ? repository.value : '';
      if (connected) void storage.connect(repository.value);
      else storage.clear();
    },
    credential: () => credential,
  };
}
