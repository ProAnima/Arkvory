import { ciVerdict } from './policy/ci-result.mjs';
try {
  const required = process.env.DEPOT_RELEASE_REQUIRED;
  if (required !== 'true' && required !== 'false')
    throw new Error('Missing release gate requirement');
  const errors = ciVerdict(JSON.parse(process.env.DEPOT_CI_NEEDS ?? '{}'), required === 'true');
  if (errors.length) throw new Error(errors.join('; '));
  process.stdout.write('All required Depot gates passed.\n');
} catch (error) {
  process.stderr.write(`Depot gate failed: ${error.message}\n`);
  process.exitCode = 1;
}
