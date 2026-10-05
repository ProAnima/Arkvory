/**
 * Local CI lanes mirror the GitHub check/release jobs on one Windows workstation with Docker:
 * the Windows host itself, an unprivileged Linux container and a disposable systemd container.
 * Gates that install real services never run on the workstation; the plan names them explicitly
 * as not executed so evidence cannot read as complete.
 */
export const lanes = {
  windows: {
    environment: 'windows-host',
    platform: 'win32',
    verify: [
      'static',
      'unit',
      'security',
      'integration',
      'browser',
      'docs',
      'deployment',
      'deployment-containers',
      'native-package',
    ],
    release: ['large-full', 'large-multipart'],
  },
  linux: {
    environment: 'linux-container',
    platform: 'linux',
    verify: ['static', 'unit', 'integration', 'browser', 'deployment'],
    release: [],
  },
  'linux-system': {
    environment: 'linux-systemd-container',
    platform: 'linux',
    verify: ['native-package', 'deployment-services', 'native-install', 'deployment-stand'],
    release: [],
  },
};

/**
 * `gap`: nothing local covers the gate on that platform; evidence and release notes list it.
 * `covered`: the platform-independent result is produced by another lane.
 */
export const notExecuted = [
  {
    gate: 'deployment-services',
    platform: 'win32',
    kind: 'gap',
    reason: 'Installs Windows services; runs only on a disposable GitHub Actions runner',
  },
  {
    gate: 'native-install',
    platform: 'win32',
    kind: 'gap',
    reason: 'Installs the Windows package machine-wide; runs only on a disposable runner',
  },
  {
    // SMB and NFS mounts need the cifs, nfs and nfsd modules of the Docker host's kernel. A gate
    // never loads kernel modules on a workstation, so only a disposable runner runs this one.
    gate: 'deployment-nas',
    platform: 'win32',
    kind: 'gap',
    reason: 'Needs cifs/nfs/nfsd kernel modules on the Docker host; runs on a GitHub runner',
  },
  {
    gate: 'deployment-nas',
    platform: 'linux',
    kind: 'gap',
    reason: 'Needs cifs/nfs/nfsd kernel modules on the Docker host; runs on a GitHub runner',
  },
  {
    // Two hosts with systemd and the native .deb: Linux containers on the same engine.
    gate: 'deployment-stand',
    platform: 'win32',
    kind: 'covered',
    reason: 'The two-site stand of Linux systemd hosts runs in the linux-system lane',
  },
  {
    // Docker Desktop shares Windows files without POSIX owners, so uid 1000 bind mounts of a
    // Linux host (the Compose vault) behave differently there; only a Linux runner shows them.
    gate: 'deployment-containers',
    platform: 'linux',
    kind: 'gap',
    reason:
      'Linux-host Compose (bind-mount ownership) runs only on GitHub Actions; the Windows lane covers Docker Desktop',
  },
  {
    gate: 'docs',
    platform: 'linux',
    kind: 'covered',
    reason: 'The documentation site does not depend on the platform; the Windows lane builds it',
  },
  {
    gate: 'security',
    platform: 'linux',
    kind: 'covered',
    reason: 'npm audit of the same lockfile runs in the Windows lane',
  },
  {
    gate: 'large-full',
    platform: 'linux',
    kind: 'covered',
    reason: 'The 5 GiB transfer runs once, in the Windows lane',
  },
  {
    gate: 'large-multipart',
    platform: 'linux',
    kind: 'covered',
    reason: 'The 5 GiB multipart transfer runs once, in the Windows lane',
  },
];

export const profiles = ['verify', 'release'];

export function planLanes(profile, selected = Object.keys(lanes)) {
  if (!profiles.includes(profile)) throw new Error(`Unknown local CI profile: ${profile}`);
  for (const name of selected)
    if (!Object.hasOwn(lanes, name)) throw new Error(`Unknown local CI lane: ${name}`);
  return selected.map((name) => {
    const lane = lanes[name];
    const gates = profile === 'release' ? [...lane.verify, ...lane.release] : [...lane.verify];
    return { name, environment: lane.environment, platform: lane.platform, gates };
  });
}

/** Required gates per platform for a profile, taken from the gate registry. */
export function requiredGates(registry, profile) {
  const required = [...registry.mergeTasks];
  if (profile === 'release') required.push(...registry.releaseTasks);
  return required;
}

/**
 * Every required gate must be executed on each platform or be declared not executed with a
 * reason. A new gate in config/gates.json therefore fails this check until the plan names it.
 */
export function uncoveredGates(registry, profile) {
  const plan = planLanes(profile);
  const problems = [];
  for (const platform of ['win32', 'linux'])
    for (const gate of requiredGates(registry, profile)) {
      const executed = plan.some((lane) => lane.platform === platform && lane.gates.includes(gate));
      const declared = notExecuted.some(
        (entry) => entry.platform === platform && entry.gate === gate,
      );
      if (!executed && !declared) problems.push(`${gate} on ${platform}`);
    }
  return problems;
}
