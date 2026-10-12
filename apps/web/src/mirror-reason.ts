import type { RepositoryMirrorResponse } from '@proanima/arkvory-contracts';
import { message } from './i18n.js';
import { mirrorReason, mirrorState } from './mirror-presentation.js';

/**
 * Why a mirror stopped, in words, with the command that fixes it and a link to the error table.
 * Visible next to the state rather than in a tooltip: the next step must not be hidden.
 */
export function mirrorReasonView(status: RepositoryMirrorResponse): HTMLElement | null {
  const reason = mirrorReason(status);
  if (!reason) return null;
  const box = document.createElement('div');
  box.className = 'mirror-problem';
  // A restored source being read again is no stop: only its reason shows.
  if (mirrorState(status) === 'failing') {
    const stopped = document.createElement('strong');
    message(stopped, 'mirrorProblem');
    box.append(stopped);
  }
  const text = document.createElement('p');
  message(text, reason.key, reason.params);
  box.append(text);
  if (reason.command) {
    const command = document.createElement('code');
    command.className = 'mirror-command';
    command.textContent = reason.command;
    box.append(command);
  }
  const link = document.createElement('a');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset['docs'] = 'operate/mirrors#error-codes';
  message(link, 'mirrorFixLink');
  box.append(link);
  return box;
}
