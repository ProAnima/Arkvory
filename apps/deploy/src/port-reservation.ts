import { command, commandOutput, DeploymentCommandFailed } from './process.js';

/** One row of `netsh int ipv4 show excludedportrange protocol=tcp`. */
export interface ExcludedRange {
  readonly start: number;
  readonly end: number;
  /** Marked `*`: added by an administrator, not by Hyper-V, WinNAT or another system owner. */
  readonly administered: boolean;
}

/** Headers of the listing are localized; the numeric rows are not, so only they are read. */
export function excludedRanges(output: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d{1,5})\s+(\d{1,5})(\s+\*)?\s*$/.exec(line);
    if (!match) continue;
    const [, start = '', end = '', mark] = match;
    ranges.push({ start: Number(start), end: Number(end), administered: mark !== undefined });
  }
  return ranges;
}

export interface PortExclusions {
  readonly show: () => Promise<string>;
  readonly add: (port: number) => Promise<void>;
}

const netsh = (args: string[]) => ['int', 'ipv4', ...args, 'protocol=tcp'];

/** The Windows TCP stack's port exclusions; adding one needs an elevated process. */
export const netshExclusions: PortExclusions = {
  show: () => commandOutput('netsh.exe', netsh(['show', 'excludedportrange'])),
  add: (port) =>
    command('netsh.exe', [
      ...netsh(['add', 'excludedportrange']),
      `startport=${String(port)}`,
      'numberofports=1',
      'store=persistent',
    ]),
};

/**
 * `added`: this call excluded the port (Arkvory owns the exclusion and removes it at uninstall).
 * `present`: an administered exclusion already covers it, owned by whoever added it.
 * `system`: a range Windows reserved itself covers it; binding there is refused.
 * `refused`: netsh refused to add the exclusion (the port is in use, say).
 */
export type Reservation = 'added' | 'present' | 'system' | 'refused';

/**
 * Keeps `port` out of the ranges Hyper-V and WinNAT reserve at every boot. An administered
 * exclusion is persistent and only stops dynamic allocation: the database still binds the port.
 */
export async function reservePort(
  port: number,
  exclusions: PortExclusions = netshExclusions,
): Promise<Reservation> {
  const covering = excludedRanges(await exclusions.show()).filter(
    (range) => range.start <= port && port <= range.end,
  );
  if (covering.some((range) => !range.administered)) return 'system';
  if (covering.length) return 'present';
  try {
    await exclusions.add(port);
  } catch (error) {
    if (error instanceof DeploymentCommandFailed) return 'refused';
    throw error;
  }
  return 'added';
}
