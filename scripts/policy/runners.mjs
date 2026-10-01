// Moving labels such as ubuntu-latest switch images on GitHub's schedule. That silently changes the
// kernel, Docker, shells and system packages under unchanged gates, so every job names a version.
const pinned = /^(?:ubuntu-\d{2}\.\d{2}|windows-\d{4}|macos-\d{2})$/;
const matrixOs = '${{ matrix.os }}';

export function inspectRunnerImages(jobs) {
  const errors = [];
  for (const [name, job] of Object.entries(jobs ?? {})) {
    const runsOn = job['runs-on'];
    const matrix = job.strategy?.matrix;
    const labels = runsOn === matrixOs ? matrix?.os : [runsOn];
    const include = matrix?.include ?? [];
    const valid =
      Array.isArray(labels) &&
      labels.length > 0 &&
      labels.every((label) => typeof label === 'string' && pinned.test(label)) &&
      Array.isArray(include) &&
      include.every(
        (entry) =>
          typeof entry !== 'object' ||
          entry === null ||
          !Object.hasOwn(entry, 'os') ||
          (typeof entry.os === 'string' && pinned.test(entry.os)),
      );
    if (!valid) errors.push(`${name}: runner image must be a pinned version, not a moving label`);
  }
  return errors;
}
