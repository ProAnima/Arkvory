import { icon } from './icons.js';
import type { IconName } from './icons.js';
import type { MessageKey } from './messages.js';

const compact: Partial<Record<MessageKey, IconName>> = {
  search: 'search',
  clearFilters: 'reset',
  open: 'open',
  download: 'download',
  pause: 'pause',
  downloadResume: 'play',
  downloadCancel: 'close',
  downloadsPause: 'pause',
  downloadsResume: 'play',
  downloadsClearFinished: 'check',
  previousPage: 'back',
  nextPage: 'next',
  more: 'next',
  historyMore: 'back',
  managementReload: 'refresh',
  managementMore: 'next',
  serviceRefresh: 'refresh',
  storageRefresh: 'refresh',
  cleanupRefresh: 'refresh',
  backupRefresh: 'refresh',
  attachmentReload: 'refresh',
  metadataRemove: 'close',
  managementClose: 'close',
  keyCopy: 'copy',
  keyCopied: 'check',
  navigationExpand: 'expand',
  navigationCollapse: 'collapse',
};
const labeled: Partial<Record<MessageKey, IconName>> = {
  uploadFile: 'upload',
  startUpload: 'upload',
  newUpload: 'plus',
  save: 'save',
  connect: 'login',
  signIn: 'login',
  disconnect: 'logout',
  backCatalog: 'back',
  apply: 'check',
  downloadApply: 'settings',
  updateSave: 'save',
  updateCheck: 'refresh',
  updateInstall: 'download',
  updateConfirmButton: 'download',
  updateCancel: 'close',
  downloadRestore: 'history',
  downloadsClearWaiting: 'close',
  downloadsCancel: 'stop',
  storageSave: 'save',
  cleanupSave: 'save',
  cleanupRun: 'play',
  backupRun: 'plus',
  backupPlanSave: 'save',
  backupRetentionApply: 'trash',
  attachmentAdd: 'plus',
  attachmentUnlink: 'link',
  attachmentRestore: 'history',
  attachmentNew: 'reset',
  historyLoad: 'history',
  restore: 'history',
  assign: 'link',
  keyIssue: 'key',
  keyRotate: 'refresh',
  keyRevoke: 'trash',
  keyActivate: 'check',
  keyNew: 'plus',
  serviceCreate: 'plus',
  createUser: 'plus',
  createGroup: 'plus',
  bindingAdd: 'plus',
  bindingRemove: 'close',
  servicePolicySave: 'save',
  delegationSave: 'save',
  delegationRemove: 'trash',
  delegationNew: 'plus',
  saveGrant: 'save',
  removeGrant: 'trash',
  addMember: 'plus',
  removeMember: 'close',
  repositoryOpen: 'open',
  repositoryStorage: 'settings',
  helpLoad: 'refresh',
};

/** Preserve the button and label nodes: localization must not disturb focus or handlers. */
export function presentAction(node: HTMLElement, key: MessageKey, value: string): boolean {
  if (!(node instanceof HTMLButtonElement)) return false;
  const name = compact[key] ?? labeled[key];
  if (!name) {
    if (node.dataset['actionIcon']) {
      delete node.dataset['actionIcon'];
      node.removeAttribute('data-icon-only');
      node.removeAttribute('aria-label');
      node.removeAttribute('title');
      node.querySelector(':scope > .action-icon')?.remove();
    }
    return false;
  }
  let label = node.querySelector<HTMLElement>(':scope > .action-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'action-label';
    node.replaceChildren(label);
  }
  if (node.dataset['actionIcon'] !== name) {
    node.querySelector(':scope > .action-icon')?.remove();
    node.prepend(icon(name));
    node.dataset['actionIcon'] = name;
  }
  node.toggleAttribute('data-icon-only', compact[key] !== undefined);
  if (label.textContent !== value) label.textContent = value;
  if (node.getAttribute('aria-label') !== value) node.setAttribute('aria-label', value);
  const title = typeof HTMLElement.prototype.showPopover === 'function' ? '' : value;
  if (node.title !== title) node.title = title;
  return true;
}
