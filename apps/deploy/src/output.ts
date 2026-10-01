export type ReportLevel = 'info' | 'warning' | 'error';

const maxLine = 4000;
// Order matters: whole database URLs first, then credentials embedded in other URLs.
const rules: readonly (readonly [RegExp, string])[] = [
  [/postgres(?:ql)?:\/\/\S+/gi, '[database URL redacted]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1<redacted>@'],
  [
    /\b((?:proxy-)?authorization)\s*[:=]\s*(?:(?:bearer|basic|token|digest)\s+)?[^\s,;'"]+/gi,
    '$1: <redacted>',
  ],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <redacted>'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '<redacted-token>'],
  [/\b(?:arkvory_|pat_|dps_)[A-Za-z0-9._-]{8,}/g, '<redacted-token>'],
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    '$1$2<redacted>',
  ],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<redacted-token>'],
  // Opaque runs with a digit (hex keys, hashes). "/" and "-" end a run, so paths, UUIDs and
  // release names stay readable.
  [/(?=[A-Za-z0-9+_]*[0-9])[A-Za-z0-9+_]{32,}={0,2}/g, '<redacted>'],
];

/**
 * The single redaction applied to every deploy CLI line: database URLs, credentials in URLs,
 * Authorization headers, Bearer values, GitHub and Arkvory tokens, key=value secrets and long
 * opaque strings. Output is also bounded and kept on one line.
 */
export function redactSecrets(text: string): string {
  let result = text.replace(/[\r\n]+/g, ' ');
  for (const [pattern, replacement] of rules) result = result.replace(pattern, replacement);
  return result.length > maxLine ? result.slice(0, maxLine) + '…' : result;
}

const labels: Readonly<Record<ReportLevel, string>> = {
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
};

/** "<ISO-8601 UTC> <LEVEL> <redacted message>"; one line, no trailing newline. */
export function formatLine(level: ReportLevel, message: string, now: Date): string {
  return `${now.toISOString()} ${labels[level]} ${redactSecrets(message)}`;
}

/** Progress on stdout, warnings and errors on stderr; never secrets. */
export function report(level: ReportLevel, message: string, now: Date = new Date()): void {
  const line = formatLine(level, message, now) + '\n';
  if (level === 'info') process.stdout.write(line);
  else process.stderr.write(line);
}
