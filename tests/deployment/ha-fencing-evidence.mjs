/** Pacemaker may fail the fence resource's start before it can execute a fence action. */
export function fencingFailureEvidence(status, lost, survivor) {
  if (!/^node-[abc]$/.test(lost) || !/^node-[abc]$/.test(survivor) || lost === survivor)
    throw new Error('Invalid HA evidence nodes');
  if (/Failed Fencing Actions|fencing.*failed/i.test(status)) return true;
  return (
    new RegExp(`Node ${lost} \\(\\d+\\): UNCLEAN`).test(status) &&
    new RegExp(
      `fence-${lost}_start_0 on ${survivor} 'error' \\(1\\):[^\\n]*status='Timed Out'`,
    ).test(status) &&
    new RegExp(`reboot of ${lost} pending:[^\\n]*origin=${survivor}\\b`).test(status) &&
    new RegExp(`Unpromoted ${survivor}\\b`).test(status)
  );
}
