import { DepotTransport } from './transport.js';
import { managementClients } from './management-client.js';
import type { IdentityClient, AdministrationClient } from './management-client.js';
import { repositoryClient } from './repository-client.js';
import type { RepositoryClient } from './repository-client.js';

/** Public compatible client. All HTTP behavior belongs to the shared concrete transport. */
export class DepotClient extends DepotTransport {
  private readonly namespaces = managementClients(this);
  readonly identity: IdentityClient = this.namespaces.identity;
  readonly administration: AdministrationClient = this.namespaces.administration;

  inRepository(repository: string): RepositoryClient {
    return repositoryClient(this, repository);
  }
}
