/** Deployment configuration wire keys; values are opaque and must never be rewritten. */
export function normalizeRuntimeSettings<T extends string | undefined>(
  values: Readonly<Record<string, T>>,
): Record<string, T> {
  const result: Record<string, T> = Object.fromEntries(
    Object.entries(values).filter(([key]) => !key.startsWith('DEPOT_')),
  );
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('DEPOT_')) continue;
    const canonical = `ARKVORY_${key.slice(6)}`;
    if (result[canonical] !== undefined && result[canonical] !== value)
      throw new Error(`Conflicting configuration: ${canonical}`);
    result[canonical] = value;
  }
  return result;
}
