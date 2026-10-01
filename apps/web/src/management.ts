import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { RepositoryConsole } from './repository-console.js';
import { ServiceConsole } from './service-console.js';
import { ServiceAuthority } from './service-authority.js';
import { ManagementDialogs } from './management-dialogs.js';
import { onViewOpen, showView } from './shell.js';
import { feedback, errorKey } from './feedback.js';

export class ManagementConsole {
  private controller = new AbortController();
  private repositories: RepositoryConsole | undefined;
  private services: ServiceConsole | undefined;
  private readonly dialogs: ManagementDialogs;
  constructor(
    private readonly base: string,
    private readonly token: HTMLInputElement,
    private readonly select: (id: string, storage: boolean) => void,
  ) {
    this.dialogs = new ManagementDialogs(base);
    onViewOpen('repositories', () => this.repositories?.load());
    onViewOpen('services', () => this.services?.reload());
  }
  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    this.repositories?.clear();
    this.services?.clear();
    this.dialogs.clear();
    this.repositories = undefined;
    this.services = undefined;
    for (const view of ['repositories', 'services']) {
      element(`${view}-nav`, HTMLButtonElement).hidden = true;
      element(`${view}-controls`, HTMLFieldSetElement).replaceChildren();
      if (!element(`${view}-panel`, HTMLElement).hidden) showView('catalog');
    }
  }
  async connect() {
    this.clear();
    const secret = this.token.value,
      signal = this.controller.signal;
    const client = new ArkvoryClient(this.base, () => secret, { signal });
    const request = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    try {
      const [permissions, capabilities] = await Promise.all([
        client.permissions(request),
        client.capabilities(request),
      ]);
      const grants = permissions.credentialId
        ? await client.serviceDelegations(permissions.credentialId, request)
        : [];
      if (signal.aborted) return;
      this.repositories = new RepositoryConsole(
        client,
        element('repositories-controls', HTMLFieldSetElement),
        element('repositories-status', HTMLOutputElement),
        this.select,
        permissions.serviceAdministration ||
          grants.some((d) => d.enabled) ||
          !element('admin-nav', HTMLButtonElement).hidden
          ? () => {
              showView(
                permissions.serviceAdministration || grants.some((d) => d.enabled)
                  ? 'services'
                  : 'administration',
              );
              if (this.services) this.services.reload();
              else if (!element('admin-nav', HTMLButtonElement).hidden)
                element('admin-nav', HTMLButtonElement).click();
            }
          : undefined,
      );
      element('repositories-nav', HTMLButtonElement).hidden = false;
      if (permissions.serviceAdministration || grants.some((d) => d.enabled)) {
        this.services = new ServiceConsole(
          client,
          element('services-controls', HTMLFieldSetElement),
          element('services-status', HTMLOutputElement),
          new ServiceAuthority(
            permissions.serviceAdministration,
            capabilities.gatewayRole !== 'reader',
            grants,
          ),
          this.dialogs,
        );
        element('services-nav', HTMLButtonElement).hidden = false;
      }
    } catch (error) {
      if (!signal.aborted)
        feedback(element('status', HTMLOutputElement), errorKey(error), {}, 'error');
    }
  }
}
