import {
  readModuleDocument,
  readSystemLicenses,
  readSystemModules,
} from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

/**
 * The installation itself (ADR 0078, 0079): the modules it runs and its licences. Global administrators only;
 * anyone else gets `forbidden`.
 */
export class SystemApi {
  constructor(private readonly http: HttpPort) {}
  /**
   * Every planned module with its health in the answering process, the refused installed signed
   * modules, and the plan fingerprints.
   */
  async modules(signal?: AbortSignal) {
    return readSystemModules(
      await this.http.call('/api/v1/system/modules', 'GET', undefined, signal),
    );
  }
  /**
   * The OpenAPI 3.1 document of the routes one module serves under `/api/ext/` in the answering
   * process (ADR 0083, N12); `not_found` when it serves none there.
   */
  async moduleOpenApi(id: string, signal?: AbortSignal) {
    return readModuleDocument(
      await this.http.call(
        `/api/v1/system/modules/${encodeURIComponent(id)}/openapi`,
        'GET',
        undefined,
        signal,
      ),
    );
  }
  /**
   * The licences of the installation as it verified them (ADR 0078, 8): state, type, features,
   * limits and terms; no key, secret or signature. The free core works without any licence.
   */
  async license(signal?: AbortSignal) {
    return readSystemLicenses(
      await this.http.call('/api/v1/system/license', 'GET', undefined, signal),
    );
  }
}
