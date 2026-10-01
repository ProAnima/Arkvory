import { existsSync } from 'node:fs';

/**
 * Service and package-install gates create real system services, users and machine-wide files.
 * They run only on throwaway hosts: a GitHub Actions runner, or the systemd container that
 * `npm run ci:local` creates for the linux-system lane (scripts/ci/linux-lane.mjs). A developer
 * workstation never qualifies, even when the variable is set by hand outside a container.
 */
export function disposableHost(
  environment = process.env,
  platform = process.platform,
  exists = existsSync,
) {
  if (environment.GITHUB_ACTIONS === 'true') return 'github-actions';
  if (
    platform === 'linux' &&
    environment.ARKVORY_DISPOSABLE_HOST === 'container' &&
    (exists('/.dockerenv') || exists('/run/.containerenv'))
  )
    return 'local-ci-container';
  return null;
}

export function requireDisposableHost(purpose) {
  if (!disposableHost())
    throw new Error(
      `${purpose} requires a disposable host: a GitHub Actions runner or the local CI systemd container (npm run ci:local)`,
    );
}
