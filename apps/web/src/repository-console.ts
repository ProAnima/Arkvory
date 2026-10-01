import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { command, disclosure, helpText, node } from './management-dom.js';
import { ManagementTask } from './management-task.js';

export class RepositoryConsole {
  private readonly task: ManagementTask;
  private readonly list = node('div', undefined, 'management-stack');
  private readonly next = command('managementMore', () => {
    this.load(this.cursor ?? undefined);
  });
  private cursor: string | null = null;
  constructor(
    private readonly client: ArkvoryClient,
    controls: HTMLFieldSetElement,
    output: HTMLOutputElement,
    private readonly select: (id: string, storage: boolean) => void,
    access?: () => void,
  ) {
    this.task = new ManagementTask(controls, output);
    this.list.id = 'repository-list';
    this.next.disabled = true;
    const actions = node('div', undefined, 'management-actions');
    actions.append(
      command('managementReload', () => {
        this.load();
      }),
      this.next,
    );
    if (access) actions.append(command('repositoryAccess', access));
    actions.append(helpText('repositoryModel', 'repositoryModelHelpLabel'));
    controls.replaceChildren(actions, this.list);
  }
  clear() {
    this.task.clear();
    this.list.replaceChildren();
  }
  load(after?: string) {
    this.task.run(async (signal) => {
      const page = await this.client.repositories(
        { ...(after ? { after } : {}), limit: 50 },
        signal,
      );
      if (signal.aborted) return;
      this.cursor = page.next;
      this.next.disabled = !page.next;
      this.list.replaceChildren();
      for (const repository of page.items) {
        // One dense row per repository: name, collapsible rights as chips, actions.
        const card = node('article', undefined, 'repository-row');
        card.dataset['repositoryId'] = repository.id;
        const title = node('h3');
        title.textContent = repository.id;
        const rights = disclosure('repositoryRights');
        const chips = node('div', undefined, 'permission-chips');
        for (const permission of repository.permissions)
          chips.append(node('span', `permission.${permission}`, 'badge'));
        rights.append(chips);
        const actions = node('div', undefined, 'management-actions');
        if (repository.permissions.includes('artifact.list'))
          actions.append(
            command('repositoryOpen', () => {
              this.select(repository.id, false);
            }),
          );
        if (repository.permissions.some((p) => p === 'storage.read' || p === 'diagnostics.read'))
          actions.append(
            command('repositoryStorage', () => {
              this.select(repository.id, true);
            }),
          );
        card.append(title, rights, actions);
        this.list.append(card);
      }
      if (!page.items.length) this.list.append(node('p', 'repositoryEmpty', 'hint'));
    });
  }
}
