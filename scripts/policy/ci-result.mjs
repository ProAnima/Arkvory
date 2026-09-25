export function ciVerdict(needs, releaseRequired) {
  const required = [
    ...new Set([
      'check',
      'integration',
      'browser',
      'security',
      'deployment-containers',
      ...(releaseRequired ? ['large'] : []),
      ...Object.keys(needs).filter((name) => name !== 'large'),
    ]),
  ];
  const errors = required
    .filter((name) => needs[name]?.result !== 'success')
    .map((name) => `${name}: ${needs[name]?.result ?? 'missing'}`);
  if (!releaseRequired && needs.large?.result !== 'skipped' && needs.large?.result !== 'success')
    errors.push(`large: ${needs.large?.result ?? 'missing'}`);
  return errors;
}
