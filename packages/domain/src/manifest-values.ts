import { ArkvoryError } from './artifact.js';

/** Validate persisted JSON without recursion or silently repairing the original manifest. */
export function validateManifestValues(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let remaining = 65536;
  const invalid = () => {
    throw new ArkvoryError('invalid_input', 'Invalid or excessively nested UPack manifest value');
  };
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const current = entry.value;
    // The source is limited to 64 KiB. Depth also protects later JSON serialization/DB encoding.
    if (--remaining < 0 || entry.depth > 128) invalid();
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      if (current.includes('\u0000') || /[\uD800-\uDFFF]/u.test(current)) invalid();
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) invalid();
      continue;
    }
    if (typeof current !== 'object') invalid();
    else {
      if (seen.has(current)) invalid();
      seen.add(current);
      const entries = Object.entries(current);
      if (entries.length + pending.length > remaining) invalid();
      for (const [key, child] of entries) {
        if (key.includes('\u0000') || /[\uD800-\uDFFF]/u.test(key)) invalid();
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
}
