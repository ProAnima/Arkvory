import { readDownloadSettings } from '@proanima/arkvory-contracts';
import type { DownloadSettingsChange } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

/**
 * Download queue settings of the installation (ADR 0076, stage 3): global administrators. A
 * change replaces every earlier change and is refused with `conflict` when `expectedRevision`
 * is not the current revision; read again and decide.
 */
export class DownloadSettingsApi {
  constructor(private readonly http: HttpPort) {}
  async get(signal?: AbortSignal) {
    return readDownloadSettings(
      await this.http.call('/api/v1/system/downloads/settings', 'GET', undefined, signal),
    );
  }
  async change(change: DownloadSettingsChange, signal?: AbortSignal) {
    return readDownloadSettings(
      await this.http.call(
        '/api/v1/system/downloads/settings',
        'PUT',
        { expectedRevision: change.expectedRevision, overrides: change.overrides },
        signal,
      ),
    );
  }
}
