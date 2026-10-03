import type { HubSettings } from './hub-settings.js';
import { parseRelease, record, version } from './model.js';
import type { Release } from './model.js';
import type { ReleaseAssets, ReleaseSource } from './github.js';
import { ReleaseHttp } from './release-http.js';
import { releaseKeys } from './release-keys.js';
import { verifyReleaseSignature } from './release-signature.js';
import type { ReleaseKey } from './release-signature.js';

export interface HubClient {
  readonly settings: HubSettings & { readonly url: string };
  /** Sent only with statistics on: without it the hub offers a version only at a full rollout. */
  readonly installId: string | null;
}
/** The platform names of the hub's update endpoint, as Tauri's updater sends them. */
export function hubPlatform(): { target: string; arch: string } {
  return {
    target: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch,
  };
}
const segment = (value: string) => encodeURIComponent(value);

/**
 * Releases through the ProAnimaStudio hub (ADR 0060): the hub decides which version this
 * installation may take (channel, staged rollout, pause) and redirects downloads to GitHub. The
 * hub is not trusted with integrity: the manifest must carry a signature of a built-in key, and
 * the archive must match the manifest's SHA-256. No credential is ever sent.
 */
export class HubReleases implements ReleaseSource {
  private readonly http: ReleaseHttp;
  constructor(
    private readonly hub: HubClient,
    signal?: AbortSignal,
    private readonly keys: readonly ReleaseKey[] = releaseKeys,
  ) {
    this.http = new ReleaseHttp(() => ({}), signal);
  }
  private file(release: string, name: string): string {
    const { url, project } = this.hub.settings;
    return `${url}/v1/${segment(project)}/download/${segment(release)}/${segment(name)}`;
  }
  /** The version the hub offers to this installation, or null when nothing newer is. */
  async approved(current: Release | null): Promise<string | null> {
    const { url, project, channel } = this.hub.settings;
    const { target, arch } = hubPlatform();
    const address = `${url}/v1/${segment(project)}/update/${segment(target)}/${segment(arch)}/${
      current?.version ?? '0.0.0'
    }?channel=${channel}`;
    const headers: Record<string, string> = this.hub.installId
      ? { 'X-Install-Id': this.hub.installId }
      : {};
    const response = await this.http.response(address, 'application/json', headers, 30000);
    if (response.status === 204) return null;
    return version(
      String(record(JSON.parse((await this.http.bytes(response)).toString()))['version']),
    );
  }
  async resolve(pin: string | null, current: Release | null): Promise<ReleaseAssets | null> {
    const selected = pin ?? (await this.approved(current));
    if (selected === null) return null;
    const read = async (name: string) =>
      this.http.bytes(
        await this.http.response(this.file(selected, name), 'application/octet-stream'),
      );
    const manifest = await read('arkvory-release.json');
    verifyReleaseSignature(
      manifest,
      (await read('arkvory-release.json.sig')).toString(),
      this.keys,
    );
    const release = parseRelease(JSON.parse(manifest.toString('utf8')));
    if (release.version !== selected) throw new Error('Release manifest does not match the hub');
    return { release, archiveUrl: this.file(selected, 'arkvory-runtime.zip') };
  }
  download(url: string, destination: string, sha256: string): Promise<void> {
    return this.http.download(url, destination, sha256);
  }
}

/**
 * Anonymous statistics: one `updated` event after an installed update. Best effort and bounded;
 * nothing is sent with statistics off, and a failure never affects the installation.
 */
export async function reportUpdated(hub: HubClient, release: Release): Promise<void> {
  if (!hub.settings.statistics || !hub.installId) return;
  const { target, arch } = hubPlatform();
  const { url, project, channel } = hub.settings;
  try {
    const response = await fetch(`${url}/v1/${segment(project)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ProAnima-Arkvory-Installer' },
      body: JSON.stringify({
        install_id: hub.installId,
        version: release.version,
        os: target,
        arch,
        channel,
        events: [{ kind: 'updated' }],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
  } catch {
    // Statistics are optional by design.
  }
}
