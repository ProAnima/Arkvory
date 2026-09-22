export type ByteRange =
  { kind: 'full' } | { kind: 'unsatisfiable' } | { kind: 'partial'; start: number; end: number };

export function parseRange(value: string | undefined, size: number): ByteRange {
  if (value === undefined || value.includes(',')) return { kind: 'full' };
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return { kind: 'full' };
  const left = match[1] ?? '';
  const right = match[2] ?? '';
  // BigInt avoids precision loss for syntactically valid out-of-range integers.
  if (left === '') {
    const suffix = BigInt(right);
    if (suffix === 0n || size === 0) return { kind: 'unsatisfiable' };
    return {
      kind: 'partial',
      start: suffix >= BigInt(size) ? 0 : size - Number(suffix),
      end: size - 1,
    };
  }
  const start = BigInt(left);
  const end = right === '' ? BigInt(size) - 1n : BigInt(right);
  if (right !== '' && end < start) return { kind: 'full' };
  if (start >= BigInt(size)) return { kind: 'unsatisfiable' };
  return {
    kind: 'partial',
    start: Number(start),
    end: Number(end < BigInt(size) ? end : BigInt(size) - 1n),
  };
}

export function matchesEtag(value: string | undefined, etag: string): boolean {
  return (
    value !== undefined &&
    value.split(',').some((part) => part.trim() === '*' || part.trim().replace(/^W\//, '') === etag)
  );
}
