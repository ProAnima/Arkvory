import { idPattern, repositoryPattern as repositorySource } from './artifact.js';

/**
 * OCI Distribution rules (ADR 0063), free of HTTP and storage. A registry name is
 * `<repository>/<image>`: the first segment is the Arkvory repository, the rest the image name.
 */
export const ociErrorCodes = {
  BLOB_UNKNOWN: 404,
  BLOB_UPLOAD_INVALID: 400,
  BLOB_UPLOAD_UNKNOWN: 404,
  DIGEST_INVALID: 400,
  MANIFEST_BLOB_UNKNOWN: 400,
  MANIFEST_INVALID: 400,
  MANIFEST_UNKNOWN: 404,
  NAME_INVALID: 400,
  NAME_UNKNOWN: 404,
  SIZE_INVALID: 400,
  UNAUTHORIZED: 401,
  DENIED: 403,
  UNSUPPORTED: 415,
  TOOMANYREQUESTS: 429,
  UNAVAILABLE: 503,
} as const;
export type OciErrorCode = keyof typeof ociErrorCodes;

/** A refusal in the registry's own error format; HTTP status by code. */
export class OciError extends Error {
  readonly status: number;
  constructor(
    readonly code: OciErrorCode,
    message: string,
    /** Only where the specification names another status (416 for a chunk out of order). */
    status?: number,
  ) {
    super(message);
    this.name = 'OciError';
    this.status = status ?? ociErrorCodes[code];
  }
}

const repositoryPattern = new RegExp(repositorySource);
const componentPattern = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*$/;
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const uploadPattern = new RegExp(idPattern);

export type OciRoute =
  | { readonly kind: 'blob'; readonly digest: string }
  | { readonly kind: 'uploads' }
  | { readonly kind: 'upload'; readonly upload: string }
  | { readonly kind: 'manifest'; readonly reference: string }
  | { readonly kind: 'tags' };
export interface OciPath {
  readonly repository: string;
  readonly image: string;
  readonly route: OciRoute;
}

/** A content digest; only sha256 is supported, as Arkvory verifies every blob by it. */
export function ociDigest(value: string): string {
  if (!digestPattern.test(value))
    throw new OciError(
      value.startsWith('sha256:') ? 'DIGEST_INVALID' : 'UNSUPPORTED',
      'Only sha256 digests are supported',
    );
  return value;
}
export const isOciDigest = (value: string) => digestPattern.test(value);

/** The route at the end of a registry path; the name before it may contain any segment. */
function routeOf(segments: readonly string[]): { route: OciRoute; length: number } {
  const [last = '', previous = '', third = ''] = [...segments].reverse();
  if (previous === 'tags' && last === 'list') return { route: { kind: 'tags' }, length: 2 };
  if (previous === 'manifests') {
    if (!tagPattern.test(last) && !isOciDigest(last))
      throw new OciError(
        last.includes(':') ? 'DIGEST_INVALID' : 'MANIFEST_INVALID',
        'Invalid reference',
      );
    return { route: { kind: 'manifest', reference: last }, length: 2 };
  }
  if (previous === 'blobs' && last === 'uploads') return { route: { kind: 'uploads' }, length: 2 };
  if (third === 'blobs' && previous === 'uploads') {
    if (last === '') return { route: { kind: 'uploads' }, length: 3 };
    if (!uploadPattern.test(last)) throw new OciError('BLOB_UPLOAD_UNKNOWN', 'Unknown upload');
    return { route: { kind: 'upload', upload: last }, length: 3 };
  }
  if (previous === 'blobs') return { route: { kind: 'blob', digest: ociDigest(last) }, length: 2 };
  // Clients probe the referrers API and fall back to tags on 404, as the specification asks.
  if (previous === 'referrers')
    throw new OciError('UNSUPPORTED', 'The referrers API is not supported', 404);
  throw new OciError('NAME_UNKNOWN', 'Unknown registry path');
}

/** `<repository>/<image>/(blobs/…|manifests/…|tags/list)` below /v2/. */
export function parseOciPath(path: string): OciPath {
  const segments = path.split('/');
  const { route, length } = routeOf(segments);
  const [repository = '', ...image] = segments.slice(0, segments.length - length);
  const imageName = image.join('/');
  if (
    !repositoryPattern.test(repository) ||
    image.length === 0 ||
    imageName.length > 200 ||
    !image.every((component) => componentPattern.test(component))
  )
    throw new OciError('NAME_INVALID', 'Invalid repository name');
  return { repository, image: imageName, route };
}

export const ociManifestTypes = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
] as const;
export type OciManifestType = (typeof ociManifestTypes)[number];
export const MAX_OCI_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface OciManifest {
  readonly mediaType: OciManifestType;
  /** Blobs (config and layers) of an image manifest; must exist in the repository. */
  readonly blobs: readonly string[];
  /** Manifests of an index or manifest list; must exist in the repository. */
  readonly manifests: readonly string[];
}

const isIndex = (type: string) => type.endsWith('index.v1+json') || type.endsWith('list.v2+json');
function descriptors(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new OciError('MANIFEST_INVALID', `${field} must be a list`);
  const values: readonly unknown[] = value;
  return values.map((item) => {
    if (!item || typeof item !== 'object' || !('digest' in item) || typeof item.digest !== 'string')
      throw new OciError('MANIFEST_INVALID', `${field} entries need a digest`);
    if (!isOciDigest(item.digest))
      throw new OciError('MANIFEST_INVALID', `${field} entries need a sha256 digest`);
    return item.digest;
  });
}

/**
 * Parses an image manifest, image index, Docker schema 2 manifest or manifest list. The type
 * comes from Content-Type, falling back to the document's own mediaType; the document must not
 * contradict it. Only what the registry checks is extracted: the referenced digests.
 */
export function parseOciManifest(
  text: string,
  size: number,
  contentType: string | undefined,
): OciManifest {
  if (size === 0 || size > MAX_OCI_MANIFEST_BYTES)
    throw new OciError('MANIFEST_INVALID', 'Manifest size is out of range');
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new OciError('MANIFEST_INVALID', 'Manifest is not JSON');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new OciError('MANIFEST_INVALID', 'Manifest must be an object');
  const own =
    'mediaType' in document && typeof document.mediaType === 'string'
      ? document.mediaType
      : undefined;
  const declared = contentType?.split(';')[0]?.trim() || own;
  const mediaType = ociManifestTypes.find((type) => type === declared);
  if (!mediaType) throw new OciError('MANIFEST_INVALID', 'Unsupported manifest media type');
  if (own !== undefined && own !== mediaType)
    throw new OciError('MANIFEST_INVALID', 'Manifest media type differs from Content-Type');
  if (!('schemaVersion' in document) || document.schemaVersion !== 2)
    throw new OciError('MANIFEST_INVALID', 'Only schemaVersion 2 is supported');
  if (isIndex(mediaType))
    return {
      mediaType,
      blobs: [],
      manifests: descriptors('manifests' in document ? document.manifests : undefined, 'manifests'),
    };
  const config = 'config' in document ? descriptors([document.config], 'config') : [];
  if (config.length !== 1) throw new OciError('MANIFEST_INVALID', 'Image manifest needs a config');
  const layers = descriptors('layers' in document ? document.layers : [], 'layers');
  return { mediaType, blobs: [...new Set([...config, ...layers])], manifests: [] };
}

/** A tag is the reference unless it is a digest. */
export const isOciTag = (reference: string) =>
  tagPattern.test(reference) && !isOciDigest(reference);
