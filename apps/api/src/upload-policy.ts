export interface UploadTimeoutOptions {
  readonly uploadIdleTimeoutMs?: number;
  readonly uploadDeadlineMs?: number;
}

export function resolveUploadTimeouts(options: UploadTimeoutOptions) {
  const uploadIdleTimeoutMs = options.uploadIdleTimeoutMs ?? 30_000;
  const uploadDeadlineMs = options.uploadDeadlineMs ?? 1_800_000;
  for (const value of [uploadIdleTimeoutMs, uploadDeadlineMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_800_000)
      throw new Error('Upload timeouts must be integers in 1..1800000 ms');
  }
  if (uploadIdleTimeoutMs > uploadDeadlineMs)
    throw new Error('Upload idle timeout cannot exceed the operation deadline');
  return { uploadIdleTimeoutMs, uploadDeadlineMs };
}

export function readUploadTimeouts(env: NodeJS.ProcessEnv) {
  const value = (key: string, fallback: number) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`Invalid ${key}`);
    return Number(raw);
  };
  return resolveUploadTimeouts({
    uploadIdleTimeoutMs: value('ARKVORY_UPLOAD_IDLE_TIMEOUT_MS', 30_000),
    uploadDeadlineMs: value('ARKVORY_UPLOAD_DEADLINE_MS', 1_800_000),
  });
}
