import type {
  BackupJobResponse,
  BackupPointResponse,
  BackupReceiptResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';
import { validateCommand, word } from './arguments.js';
import type { Arguments } from './arguments.js';
import type { connection } from './profiles.js';
import { CliError, sanitize } from './errors.js';

type Connected = Awaited<ReturnType<typeof connection>>;
type Language = 'en' | 'ru';

/** A result with a human form; --json prints `json`, a terminal gets `text`. */
export class Rendered {
  constructor(
    readonly json: unknown,
    readonly text: (language: Language) => string,
    /** Exit code of a successful call (9: backup status reports a critical warning). */
    readonly exitCode = 0,
  ) {}
}

const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
/** Binary units with one decimal; decimal strings stay exact up to 64-bit counts. */
export function formatBytes(value: string): string {
  let unit = 0;
  let scaled = BigInt(value) * 10n;
  while (scaled >= 10240n && unit < units.length - 1) {
    scaled /= 1024n;
    unit++;
  }
  const whole = scaled / 10n;
  const tenth = scaled % 10n;
  return unit === 0 ? `${value} B` : `${String(whole)}.${String(tenth)} ${units[unit] ?? 'B'}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

function statusText(status: BackupStatusResponse, language: Language): string {
  const t = (en: string, ru: string) => (language === 'ru' ? ru : en);
  const { vault, agent, plan, lastCompleted } = status;
  const space =
    vault.freeBytes !== null && vault.totalBytes !== null
      ? t(
          `, ${formatBytes(vault.freeBytes)} free of ${formatBytes(vault.totalBytes)}`,
          `, свободно ${formatBytes(vault.freeBytes)} из ${formatBytes(vault.totalBytes)}`,
        )
      : '';
  const vaultState = !vault.configured
    ? t('not configured', 'не настроено')
    : (vault.available ? t('available', 'доступно') : t('unavailable', 'недоступно')) + space;
  const seen = agent.lastSeenAt
    ? ` (${t('last seen', 'последний сигнал')} ${agent.lastSeenAt})`
    : '';
  const { daily, weekly, monthly } = plan.retention;
  const lines = [
    `${t('Vault', 'Хранилище копий')}: ${vaultState}`,
    `${t('Agent', 'Агент')}: ${agent.online ? t('online', 'работает') : t('offline', 'не отвечает')}${seen}`,
    `${t('Plan', 'План')}: ${plan.enabled ? t('enabled', 'включён') : t('disabled', 'выключен')}, ` +
      `${t('daily', 'ежедневно')} ${pad(plan.hour)}:${pad(plan.minute)} ` +
      `${sanitize(plan.timezone, 64)}, ${t('keep', 'хранить')} ` +
      `${String(daily)}/${String(weekly)}/${String(monthly)}`,
    `${t('Last point', 'Последняя точка')}: ${
      lastCompleted
        ? `${lastCompleted.id} T=${lastCompleted.snapshotAt} ${formatBytes(lastCompleted.contentBytes)}`
        : t('none', 'нет')
    }`,
    `${t('Next run', 'Следующий запуск')}: ${status.nextRunAt ?? '-'}`,
  ];
  if (status.running) lines.push(`${t('Running', 'Выполняется')}: ${jobLine(status.running)}`);
  const warnings = status.warnings.map((warning) => `${warning.severity} ${warning.code}`);
  lines.push(`${t('Warnings', 'Предупреждения')}: ${warnings.join(', ') || t('none', 'нет')}`);
  return lines.join('\n');
}

function jobLine(job: BackupJobResponse): string {
  const { bytesCopied, bytesTotal } = job.progress;
  const progress =
    bytesTotal === '0' ? '' : ` ${formatBytes(bytesCopied)}/${formatBytes(bytesTotal)}`;
  const phase = job.phase ? ` ${job.phase}` : '';
  const error = job.errorCode ? ` ${job.errorCode}` : '';
  return `${job.startedAt} ${job.kind} ${job.state}${phase}${progress}${error} ${job.id}`;
}

function pointLine(point: BackupPointResponse, language: Language): string {
  const t = (en: string, ru: string) => (language === 'ru' ? ru : en);
  const verified = point.verifyError
    ? `${t('verify failed', 'ошибка проверки')} ${point.verifyError}`
    : point.verifyDepth
      ? `${t('verified', 'проверено')} ${point.verifyDepth}`
      : t('not verified', 'не проверено');
  const pinned = point.pinned ? t(', pinned', ', закреплено') : '';
  return `${point.snapshotAt} ${point.id} ${formatBytes(point.contentBytes)} ${verified}${pinned}`;
}

function page<T>(items: readonly T[], next: string | null, line: (item: T) => string): string {
  return [...items.map(line), ...(next ? [`next: ${next}`] : [])].join('\n') || '-';
}

function receipt(value: BackupReceiptResponse): Rendered {
  return new Rendered(value, (language) =>
    language === 'ru'
      ? `Задание ${value.kind} ${value.id}: ${value.state}`
      : `Job ${value.kind} ${value.id}: ${value.state}`,
  );
}

/**
 * arkvoryctl backup status|run|jobs|points|verify ID|pin ID [--off] (ADR 0056). Commands queue
 * jobs for the server's backup agent; status exits 9 while a critical warning is active.
 */
export async function backupCommand(
  args: Arguments,
  connected: Connected,
  signal: AbortSignal,
): Promise<Rendered> {
  const backup = connected.client.backup;
  const sub = word(args, 1);
  const after = args.options.get('after');
  const query = after === undefined ? {} : { after };
  switch (sub) {
    case 'status': {
      validateCommand(args, 2);
      const status = await backup.status(signal);
      const critical = status.warnings.some((warning) => warning.severity === 'critical');
      return new Rendered(status, (language) => statusText(status, language), critical ? 9 : 0);
    }
    case 'run':
      validateCommand(args, 2);
      return receipt(await backup.run(undefined, signal));
    case 'jobs': {
      validateCommand(args, 2, ['after']);
      const jobs = await backup.jobs(query, signal);
      return new Rendered(jobs, () => page(jobs.items, jobs.next, jobLine));
    }
    case 'points': {
      validateCommand(args, 2, ['after']);
      const points = await backup.points(query, signal);
      return new Rendered(points, (language) =>
        page(points.items, points.next, (point) => pointLine(point, language)),
      );
    }
    case 'verify':
      validateCommand(args, 3);
      return receipt(await backup.verify(word(args, 2), undefined, signal));
    case 'pin': {
      validateCommand(args, 3, ['off']);
      const point = await backup.pin(word(args, 2), !args.options.has('off'), signal);
      return new Rendered(point, (language) => pointLine(point, language));
    }
    default:
      throw new CliError('unknown_command');
  }
}
