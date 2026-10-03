import type { ApiMethod, OperationPolicy } from './operation-policy.js';
import type { ApiSurface, ApiVisibility } from './api-surfaces.js';
import {
  contentResponses,
  downloadHeaders,
  nativeErrorResponse,
  requestIdHeader,
} from './http-contract.js';
import { retryAfterHeader } from './errors.js';
import { downloadLinkOperations } from './download-link-api.js';

export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid API contract object');
  return Object.fromEntries(Object.entries(value));
}
export function route(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name === 'packagePath' || name === 'assetPath' ? '*' : `:${name}`,
  );
}

/** HEAD reuses the GET policy under a derived operationId unless it is declared explicitly. */
export function methodPolicy(
  declared: Partial<Record<ApiMethod, OperationPolicy>>,
  method: ApiMethod,
  path: string,
): OperationPolicy {
  const policy =
    declared[method] ??
    (method === 'head' && declared.get
      ? { ...declared.get, operationId: `${declared.get.operationId}Head` }
      : undefined);
  if (!policy) throw new Error(`Missing API policy: ${method} ${path}`);
  return policy;
}

// Anonymous and password operations are throttled with 429 and Retry-After (ADR 0049, 0051).
const throttled = new Set(['login', 'registerAccount', 'changeOwnPassword']);
const retryHeaders = { ...nativeErrorResponse.headers, 'Retry-After': retryAfterHeader };

/** Statuses every operation may answer before or besides its declared outcomes. */
function errorStatuses(original: ObjectValue, policy: OperationPolicy): readonly string[] {
  // All routes may be rejected by HTTP validation/CORS/admission or authentication.
  const statuses =
    policy.access.kind === 'public'
      ? ['400', '403', '503']
      : ['400', '401', '403', '404', '409', '422', '503', '507'];
  // A login with wrong credentials is 401 although the operation itself is public.
  if (policy.operationId === 'login') statuses.push('401');
  // Only JSON bodies pass the 64 KiB body limit and the media type parsers.
  const body = original['requestBody'] ? object(original['requestBody']) : undefined;
  if (body && object(body['content'])['application/json']) statuses.push('413', '415');
  return statuses;
}

/** Declared responses plus the shared error envelope; every response carries X-Request-Id. */
function operationResponses(
  original: ObjectValue,
  policy: OperationPolicy,
  method: ApiMethod,
  content: boolean,
): ObjectValue {
  const responses: ObjectValue = {
    ...object(original['responses']),
    ...(content ? contentResponses : {}),
    default: nativeErrorResponse,
  };
  for (const status of errorStatuses(original, policy)) responses[status] ??= nativeErrorResponse;
  if (method !== 'get' && method !== 'head')
    responses['405'] = {
      ...nativeErrorResponse,
      description: 'Reader rejects mutations with code read_only.',
      headers: {
        ...nativeErrorResponse.headers,
        Allow: { schema: { type: 'string', enum: ['GET, HEAD'] } },
      },
    };
  responses['503'] = {
    ...nativeErrorResponse,
    description: 'Unavailable or busy; reconcile mutation state before retry.',
    headers: retryHeaders,
  };
  if (throttled.has(policy.operationId))
    responses['429'] = {
      ...nativeErrorResponse,
      description: 'rate_limited: wait retryAfterSeconds; the attempt was not evaluated.',
      headers: retryHeaders,
    };
  if (method === 'head' && content) {
    delete responses['206'];
    delete responses['416'];
  }
  const normalized: ObjectValue = {};
  for (const [status, value] of Object.entries(responses)) {
    const response = object(value);
    response['headers'] = {
      'X-Request-Id': requestIdHeader,
      ...(response['headers'] ? object(response['headers']) : {}),
    };
    if (method === 'head') delete response['content'];
    normalized[status] = response;
  }
  return normalized;
}

/** HEAD of a content download keeps only the conditional header among header parameters. */
function contentParameters(declared: unknown, method: ApiMethod): unknown {
  const parameters = declared ?? downloadHeaders;
  if (method !== 'head') return parameters;
  return Array.isArray(parameters)
    ? parameters.filter((p: unknown) => {
        const parameter = object(p);
        return parameter['in'] !== 'header' || parameter['name'] === 'If-None-Match';
      })
    : [];
}

function streamingExtension(policy: OperationPolicy, method: ApiMethod, content: boolean) {
  const named =
    policy.operationId.startsWith('downloadPackageContent') ||
    policy.operationId.startsWith('downloadAssetContent');
  const upload =
    policy.operationId === 'putUploadContent' || policy.operationId === 'putUploadPart';
  return {
    ...(content
      ? {
          'x-arkvory-streaming': {
            sizeLimit: 'capabilities.limits.maxObjectBytes',
            range: method === 'head' ? 'ignored' : 'single',
            immutableBytes: true,
            resolution: named ? 'catalog-lookup-per-request' : 'artifact-id',
          },
        }
      : {}),
    ...(upload
      ? {
          'x-arkvory-streaming': {
            sizeLimit: 'capabilities.limits.maxObjectBytes',
            requestBytes: policy.operationId === 'putUploadPart' ? 'upload.partBytes' : 'size',
            checksum: 'sha256',
            partialRequestCommitted: false,
            recovery:
              policy.operationId === 'putUploadPart'
                ? 'list-parts-then-retry-same-index-and-hash'
                : 'get-upload-status-before-retry',
          },
        }
      : {}),
  };
}

/** Published operation object: declared fields, then policy-derived extensions and responses. */
export function composeOperation(
  original: ObjectValue,
  policy: OperationPolicy,
  classification: { surface: ApiSurface; visibility: ApiVisibility },
  method: ApiMethod,
  path: string,
): ObjectValue {
  const content = policy.tag === 'Content';
  return {
    ...original,
    ...(content ? { parameters: contentParameters(original['parameters'], method) } : {}),
    operationId: policy.operationId,
    tags: [policy.tag],
    security:
      policy.access.kind === 'public'
        ? []
        : downloadLinkOperations.includes(policy.operationId)
          ? [{ serviceKey: [] }, { downloadLink: [] }]
          : [{ serviceKey: [] }],
    'x-arkvory-authorization': policy.access,
    'x-arkvory-authority': policy.access.kind,
    'x-arkvory-surface': classification.surface,
    'x-arkvory-visibility': classification.visibility,
    'x-arkvory-retry': policy.retry,
    'x-arkvory-route': route(path),
    'x-arkvory-gateway': method === 'get' || method === 'head' ? 'writer-or-reader' : 'writer',
    ...streamingExtension(policy, method, content),
    responses: operationResponses(original, policy, method, content),
  };
}
