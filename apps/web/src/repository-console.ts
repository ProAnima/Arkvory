import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { command, disclosure, node } from './management-dom.js';
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
    const help = disclosure('repositoryChoose');
    help.append(node('p', 'repositoryModel', 'hint'));
    controls.replaceChildren(actions, this.list, help);
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
        const card = node('article', undefined, 'binding-row');
        card.dataset['repositoryId'] = repository.id;
        const title = node('h3');
        title.textContent = repository.id;
        const rights = disclosure('repositoryRights');
        for (const permission of repository.permissions)
          rights.append(node('p', `permission.${permission}`));
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
