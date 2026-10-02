/*
 * Daily backup schedule in an explicit IANA time zone (ADR 0056). Every instant is passed in by
 * the caller (milliseconds since the epoch); wall-clock fields come from the ECMAScript time zone
 * database through Intl, never from the host zone. A "wall" value encodes local date and time
 * fields as if they were UTC, so wall values of one zone compare like the local clock reads.
 */
const DAY = 86_400_000;
const zonePattern = /^[A-Za-z][A-Za-z0-9_+-]{0,31}(\/[A-Za-z0-9_+-]{1,31}){0,2}$/;

export interface BackupSchedule {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
  readonly timezone: string;
}

/** IANA names only (Europe/Moscow, UTC, Etc/GMT+3); numeric offsets and unknown zones fail. */
export function validTimeZone(value: string): boolean {
  if (value.length > 64 || !zonePattern.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar fields of one zone; one formatter is created per computation, not cached. */
export class ZoneClock {
  private readonly format: Intl.DateTimeFormat;
  constructor(timezone: string) {
    if (!validTimeZone(timezone)) throw new RangeError('Unknown time zone');
    this.format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  /** Wall clock at an instant, to the second. */
  wall(instant: number): number {
    const values = new Map<string, number>();
    for (const part of this.format.formatToParts(instant))
      if (part.type !== 'literal') values.set(part.type, Number(part.value));
    const field = (name: string) => values.get(name) ?? Number.NaN;
    return Date.UTC(
      field('year'),
      field('month') - 1,
      field('day'),
      field('hour'),
      field('minute'),
      field('second'),
    );
  }

  /** Local midnight of the calendar day containing the instant, as a wall value. */
  day(instant: number): number {
    return Math.floor(this.wall(instant) / DAY) * DAY;
  }

  private offset(instant: number): number {
    const whole = Math.floor(instant / 1000) * 1000;
    return this.wall(whole) - whole;
  }

  /**
   * The instant at which the wall clock first reads `target` (a wall value). An ambiguous time
   * (clocks set back) resolves to its first occurrence; a nonexistent time (clocks set forward)
   * resolves to the first valid instant after it, the transition itself.
   */
  instantOf(target: number): number {
    const offsets = [...new Set([target - DAY, target, target + DAY].map((t) => this.offset(t)))];
    const valid = offsets
      .map((offset) => target - offset)
      .filter((candidate) => this.wall(candidate) === target);
    if (valid.length) return Math.min(...valid);
    // A gap: the wall clock jumps across target between these instants exactly once.
    let low = target - Math.max(...offsets);
    let high = target - Math.min(...offsets);
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2000) * 1000;
      if (this.wall(middle) >= target) high = middle;
      else low = middle;
    }
    return high;
  }
}

function slotOn(clock: ZoneClock, day: number, schedule: BackupSchedule): number {
  return clock.instantOf(day + (schedule.hour * 60 + schedule.minute) * 60_000);
}

function requireInstant(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Invalid instant');
  return value;
}

/** First scheduled slot strictly after the instant. */
export function slotAfter(schedule: BackupSchedule, instant: number): number {
  const clock = new ZoneClock(schedule.timezone);
  const today = clock.day(requireInstant(instant));
  for (let day = today - DAY; ; day += DAY) {
    const slot = slotOn(clock, day, schedule);
    if (slot > instant) return slot;
  }
}

/** Latest scheduled slot at or before the instant. */
export function slotAtOrBefore(schedule: BackupSchedule, instant: number): number {
  const clock = new ZoneClock(schedule.timezone);
  const today = clock.day(requireInstant(instant));
  for (let day = today + DAY; ; day -= DAY) {
    const slot = slotOn(clock, day, schedule);
    if (slot <= instant) return slot;
  }
}

export interface ScheduleState {
  /** Slot most recently turned into a run; null before the first one. */
  readonly lastSlotAt: number | null;
  /** When the schedule fields last changed: earlier slots never count as missed. */
  readonly scheduleFrom: number;
}
export interface ScheduleDecision {
  /** Next slot counted from the last consumed one; in the past while a run is overdue. */
  readonly nextRunAt: number | null;
  /** Slot to run now, or null. After downtime it is the latest missed slot only. */
  readonly due: number | null;
}

/**
 * nextRunAt follows the last scheduled slot, not the end of the last job, so a long capture
 * never shifts the plan. Every missed slot collapses into one catch-up run: the due slot is the
 * latest one at or before now, and consuming it moves past all earlier ones.
 */
export function scheduleDecision(
  schedule: BackupSchedule,
  state: ScheduleState,
  now: number,
): ScheduleDecision {
  if (!schedule.enabled) return { nextRunAt: null, due: null };
  const base = Math.max(state.lastSlotAt ?? Number.NEGATIVE_INFINITY, state.scheduleFrom);
  const next = slotAfter(schedule, requireInstant(base));
  if (next > requireInstant(now)) return { nextRunAt: next, due: null };
  return { nextRunAt: next, due: slotAtOrBefore(schedule, now) };
}

/** Upcoming slots after an instant, for previews; bounded. */
export function upcomingSlots(schedule: BackupSchedule, after: number, count: number): number[] {
  const slots: number[] = [];
  let instant = after;
  for (let index = 0; index < Math.min(Math.max(count, 0), 31); index++) {
    instant = slotAfter(schedule, instant);
    slots.push(instant);
  }
  return slots;
}

/** Calendar buckets of an instant in a zone: local day, ISO 8601 week and month. */
export interface CalendarBuckets {
  readonly day: string;
  readonly week: string;
  readonly month: string;
}
export function calendarBuckets(clock: ZoneClock, instant: number): CalendarBuckets {
  const day = new Date(clock.day(instant));
  const weekday = (day.getUTCDay() + 6) % 7;
  // The ISO week belongs to the year of its Thursday; week 1 contains January 4th.
  const thursday = new Date(day.getTime() + (3 - weekday) * DAY);
  const isoYear = thursday.getUTCFullYear();
  const ordinal = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY);
  const week = Math.floor(ordinal / 7) + 1;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const year = pad(day.getUTCFullYear(), 4);
  return {
    day: `${year}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`,
    week: `${pad(isoYear, 4)}-W${pad(week)}`,
    month: `${year}-${pad(day.getUTCMonth() + 1)}`,
  };
}
