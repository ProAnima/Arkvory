import {
  ArkvoryHttpError,
  ArkvoryIntegrityError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';

export class CliError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode = 2,
  ) {
    super(code);
  }
}

export class PublicationError extends Error {
  constructor(
    readonly artifactId: string,
    readonly reason: unknown,
  ) {
    super('publication_registration_failed');
  }
}

/** Never reflect server responses, local paths, argv or credentials in diagnostics. */
export function failure(
  error: unknown,
  cancelled: boolean,
): { code: string; exitCode: number; status?: number; stage?: string; artifactId?: string } {
  if (error instanceof PublicationError)
    return { ...failure(error.reason, cancelled), stage: 'register', artifactId: error.artifactId };
  if (cancelled) return { code: 'interrupted', exitCode: 130 };
  if (error instanceof CliError) return { code: error.code, exitCode: error.exitCode };
  if (error instanceof ArkvoryIntegrityError) return { code: 'integrity_failed', exitCode: 5 };
  if (error instanceof ArkvoryNetworkError) return { code: 'network_failed', exitCode: 4 };
  if (error instanceof Error && error.name === 'TimeoutError')
    return { code: 'request_timeout', exitCode: 4 };
  if (error instanceof ArkvoryHttpError) {
    return {
      code: 'http_error',
      status: error.status,
      exitCode: error.status === 401 || error.status === 403 ? 3 : error.status === 409 ? 6 : 4,
    };
  }
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') return { code: 'file_not_found', exitCode: 7 };
    if (error.code === 'EACCES' || error.code === 'EPERM')
      return { code: 'permission_denied', exitCode: 7 };
    if (error.code === 'ENOSPC') return { code: 'disk_full', exitCode: 7 };
  }
  return { code: 'local_or_protocol_error', exitCode: 7 };
}

const explanations: Readonly<Record<string, readonly [string, string]>> = {
  credential_required: [
    'Set ARKVORY_TOKEN_FILE or add a profile with --token-file.',
    'Задайте ARKVORY_TOKEN_FILE или добавьте профиль с --token-file.',
  ],
  checkpoint_mismatch: [
    'The source, server or publication options differ from the checkpoint. Use the original values or a new --state.',
    'Исходный файл, сервер или параметры отличаются от чекпойнта. Верните прежние значения или выберите новый --state.',
  ],
  state_locked: [
    'Another process owns this checkpoint. After a hard crash, confirm it has stopped before removing the .lock file.',
    'Чекпойнт занят другим процессом. После аварии убедитесь, что процесс остановлен, прежде чем удалять .lock.',
  ],
  destination_exists: [
    'Choose a new output filename; the existing file was preserved.',
    'Выберите другое имя результата; существующий файл сохранён.',
  ],
  invalid_server_url: [
    'Use an HTTPS URL without credentials or query parameters.',
    'Укажите HTTPS URL без ключей, пароля и query-параметров.',
  ],
  integrity_failed: [
    'SHA-256 verification failed. Nothing was published; repeat the download.',
    'Проверка SHA-256 не пройдена. Файл не опубликован; повторите скачивание.',
  ],
  interrupted: [
    'Transfer interrupted. Repeat the same command to resume.',
    'Передача прервана. Повторите ту же команду для продолжения.',
  ],
  file_not_found: [
    'Check the input file, credential file and parent directory of the destination.',
    'Проверьте исходный файл, файл ключа и родительский каталог результата.',
  ],
  disk_full: [
    'Free local disk space, then repeat the command.',
    'Освободите место на локальном диске и повторите команду.',
  ],
  http_error: [
    'Check the HTTP status, key permissions and current resource revision.',
    'Проверьте HTTP-статус, права ключа и текущую ревизию ресурса.',
  ],
};
export function explanation(code: string, language: 'en' | 'ru'): string {
  return explanations[code]?.[language === 'ru' ? 1 : 0] ?? 'arkvoryctl --help';
}
