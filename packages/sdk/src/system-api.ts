import { readSystemModules } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

/**
 * The installation itself (ADR 0078, 0079): the modules it runs. Global administrators only;
 * anyone else gets `forbidden`.
 */
export class SystemApi {
  constructor(private readonly http: HttpPort) {}
  /** Every planned module with its health in the answering process, and the plan fingerprints. */
  async modules(signal?: AbortSignal) {
    return readSystemModules(
      await this.http.call('/api/v1/system/modules', 'GET', undefined, signal),
    );
  }
}
