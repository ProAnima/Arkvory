export interface Release {
  format: 1;
  version: string;
  commit: string;
  schema: number;
  archiveSha256: string;
  setupSha256: string;
}
export interface Installation {
  format: 1;
  mode: 'systemd' | 'windows' | 'compose';
  engine: 'docker' | 'podman';
  automatic: boolean;
  pin: string | null;
  current: Release;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
export function version(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(value)
  )
    throw new Error('Only stable semantic versions are supported');
  return value;
}
export function parseRelease(value: unknown): Release {
  const data = record(value);
  const digest = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      throw new Error('Invalid release digest');
    return value;
  };
  if (
    data['format'] !== 1 ||
    typeof data['schema'] !== 'number' ||
    !Number.isSafeInteger(data['schema']) ||
    data['schema'] < 1
  )
    throw new Error('Unsupported release format or database schema');
  if (typeof data['commit'] !== 'string' || !/^[a-f0-9]{40}$/.test(data['commit']))
    throw new Error('Invalid commit');
  return {
    format: 1,
    version: version(data['version']),
    commit: data['commit'],
    schema: data['schema'],
    archiveSha256: digest(data['archiveSha256']),
    setupSha256: digest(data['setupSha256']),
  };
}
export function parseInstallation(value: unknown): Installation {
  const data = record(value);
  if (
    data['format'] !== 1 ||
    !['systemd', 'windows', 'compose'].includes(String(data['mode'])) ||
    !['docker', 'podman'].includes(String(data['engine'])) ||
    typeof data['automatic'] !== 'boolean'
  )
    throw new Error('Invalid installation state');
  return {
    format: 1,
    mode: data['mode'] as Installation['mode'],
    engine: data['engine'] as Installation['engine'],
    automatic: data['automatic'],
    pin: data['pin'] === null ? null : version(data['pin']),
    current: parseRelease(data['current']),
  };
}
export function newer(candidate: string, current: string): boolean {
  const left = version(candidate).split('.').map(Number);
  const right = version(current).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return Number(left[i]) > Number(right[i]);
  }
  return false;
}
export function updateDecision(
  state: Installation,
  next: Release,
  scheduled: boolean,
): 'update' | 'migrate' | 'unchanged' {
  if (scheduled && (!state.automatic || state.pin !== null)) return 'unchanged';
  if (next.version === state.current.version) {
    if (next.archiveSha256 !== state.current.archiveSha256)
      throw new Error('Published version was replaced');
    return 'unchanged';
  }
  if (!newer(next.version, state.current.version)) throw new Error('Downgrades are forbidden');
  if (state.pin !== null && next.version !== state.pin) throw new Error('Version is pinned');
  if (next.schema < state.current.schema) throw new Error('Release lowers the database schema');
  // A newer schema migrates only behind a verified backup (ADR 0059).
  return next.schema === state.current.schema ? 'update' : 'migrate';
}
