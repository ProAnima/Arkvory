import { DepotError, parseDescriptor, requireId } from './artifact.js';

export const attachmentKinds = ['manifest', 'sbom', 'signature', 'report', 'file'] as const;
export interface BuildAttachment {
  name: string;
  kind: (typeof attachmentKinds)[number];
  artifactId: string;
  description: string;
}

/** Links are descriptive; no file execution, schema fetching or recursive resolution. */
export function parseAttachments(value: unknown, parentId: string): readonly BuildAttachment[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new DepotError('invalid_input', 'At most 32 attachments allowed');
  const names = new Set<string>();
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new DepotError('invalid_input', 'Invalid attachment');
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(entry));
    if (
      Object.keys(input).some((key) => !['name', 'kind', 'artifactId', 'description'].includes(key))
    )
      throw new DepotError('invalid_input', 'Unknown attachment field');
    const { name, kind, artifactId, description } = input;
    if (typeof artifactId !== 'string' || requireId(artifactId) === parentId)
      throw new DepotError('invalid_input', 'Invalid attachment target');
    if (
      kind !== 'manifest' &&
      kind !== 'sbom' &&
      kind !== 'signature' &&
      kind !== 'report' &&
      kind !== 'file'
    )
      throw new DepotError('invalid_input', 'Invalid attachment kind');
    if (
      typeof description !== 'string' ||
      description.length > 512 ||
      description.includes('\u0000') ||
      /[\uD800-\uDFFF]/u.test(description)
    )
      throw new DepotError('invalid_input', 'Invalid attachment description');
    const checked = parseDescriptor({ name, size: '0', sha256: '0'.repeat(64) }).name;
    if (checked.trim() !== checked || names.has(checked.toLowerCase()))
      throw new DepotError('invalid_input', 'Attachment names must be unique');
    names.add(checked.toLowerCase());
    return { name: checked, kind, artifactId, description };
  });
}
