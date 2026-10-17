/*
 * Where a failover of the active node spends its time (ADR 0072): the survivor's journal from
 * the power loss on, as an excerpt and as phases in seconds since the power-off. The guests keep
 * the host's time (kvm-clock), so the phases and the stand's own clock agree to a fraction of a
 * second.
 */

/** Membership, fencing, the DRBD view of the peer, promotion scores and the group start. */
const EXCERPT = [
  'state is now lost',
  'votequorum|qdevice|Quorate',
  'stonith|fenced',
  'fence-peer|crm-fence',
  'drbd .*(conn|disk)\\(',
  'master-',
  'promot',
  'Result of start',
].join('|');

/** The first journal line of each phase after the power-off, in the order a failover runs. */
const PHASES = [
  ['membershipLost', /Node \S+ state is now lost/],
  ['drbdLostPeer', /drbd \S+ \S+: conn\( Connected -> /],
  ['fenced', /Operation '(reboot|off)' targeting \S+ by \S+ for .*: OK/],
  ['promotionStarted', /Initiating promote operation/],
  ['promoted', /Result of promote operation for \S+ on \S+: ok/],
  ['apiStarted', /Result of start operation for \S+-api on \S+: ok/],
  ['addressUp', /Result of start operation for \S+-ip on \S+: ok/],
];

/** `journalctl -o short-unix` lines: seconds since the epoch, then the message. */
export function journalLines(output) {
  const lines = [];
  for (const line of output.split('\n')) {
    const match = /^(\d+\.\d+) (.*)$/.exec(line);
    if (match) lines.push({ at: Number(match[1]) * 1000, text: match[2] });
  }
  return lines;
}

/** Seconds (one decimal) from `since` to the first line of each phase; a missing phase is left out. */
export function failoverPhases(lines, since) {
  const phases = {};
  for (const [name, pattern] of PHASES) {
    const hit = lines.find((line) => line.at >= since && pattern.test(line.text));
    if (hit) phases[name] = Math.round((hit.at - since) / 100) / 10;
  }
  return phases;
}

/** The excerpt and the phases from `node`, the survivor, for a power-off at `since` (ms). */
export async function failoverReport(node, since) {
  const minutes = Math.ceil((Date.now() - since) / 60000) + 2;
  const read = await node.shell.tryExec(
    `journalctl --since '-${String(minutes)}min' -o short-unix | grep -Ei '${EXCERPT}' | grep -v 'monitor' | tail -n 200`,
  );
  const lines = journalLines(read.output);
  return {
    phases: failoverPhases(lines, since),
    excerpt: lines.map((line) => `${new Date(line.at).toISOString()} ${line.text}`).join('\n'),
  };
}
