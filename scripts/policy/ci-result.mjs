export function ciVerdict(needs, releaseRequired) {
  const required = [
    'check',
    'integration',
    'browser',
    'security',
    ...(releaseRequired ? ['large'] : []),
  ];
  const errors = required
    .filter((name) => needs[name]?.result !== 'success')
    .map((name) => `${name}: ${needs[name]?.result ?? 'missing'}`);
  if (!releaseRequired && needs.large?.result !== 'skipped' && needs.large?.result !== 'success')
    errors.push(`large: ${needs.large?.result ?? 'missing'}`);
  return errors;
}
