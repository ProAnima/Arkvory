import { operationPolicies } from './operation-policy.js';
import type { ApiMethod, OperationPolicy } from './operation-policy.js';
import {
  contentResponses,
  downloadHeaders,
  nativeErrorResponse,
  requestIdHeader,
} from './http-contract.js';

type ObjectValue = Record<string, unknown>;
export interface ApiOperation extends OperationPolicy {
  method: ApiMethod;
  path: string;
  route: string;
}
export const apiMethods: readonly ApiMethod[] = ['get', 'head', 'post', 'put', 'patch', 'delete'];
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid API contract object');
  return Object.fromEntries(Object.entries(value));
}
function route(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name === 'packagePath' || name === 'assetPath' ? '*' : `:${name}`,
  );
}
export function composeApiPaths(source: Record<string, ObjectValue>) {
  const paths: Record<string, ObjectValue> = {};
  const operations: ApiOperation[] = [];
  const ids = new Set<string>();
  for (const [path, original] of Object.entries(source)) {
    const item = { ...original };
    const declared = operationPolicies[path];
    if (!declared) throw new Error(`Missing API policy: ${path}`);
    if (item['get'] && !item['head']) item['head'] = item['get'];
    for (const method of apiMethods) {
      if (!item[method]) continue;
      const policy =
        declared[method] ??
        (method === 'head' && declared.get
          ? { ...declared.get, operationId: `${declared.get.operationId}Head` }
          : undefined);
      if (!policy) throw new Error(`Missing API policy: ${method} ${path}`);
      if (ids.has(policy.operationId))
        throw new Error(`Duplicate operationId: ${policy.operationId}`);
      ids.add(policy.operationId);
      const originalOperation = object(item[method]);
      const content = policy.tag === 'Content' || policy.tag === 'Legacy';
      const upload =
        policy.operationId === 'putUploadContent' || policy.operationId === 'putUploadPart';
      const responses: ObjectValue = {
        ...object(originalOperation['responses']),
        ...(content ? contentResponses : {}),
        default: nativeErrorResponse,
      };
      // All routes may be rejected by HTTP validation/CORS/admission or authentication.
      const statuses =
        policy.access.kind === 'public'
          ? ['400', '403', '503']
          : ['400', '401', '403', '404', '409', '422', '503', '507'];
      for (const status of statuses) responses[status] ??= nativeErrorResponse;
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
        headers: {
          ...nativeErrorResponse.headers,
          'Retry-After': { schema: { type: 'string' }, description: 'Delay in seconds.' },
        },
      };
      if (method === 'head' && content) {
        delete responses['206'];
        delete responses['416'];
      }
      const normalizedResponses: ObjectValue = {};
      for (const [status, value] of Object.entries(responses)) {
        const response = object(value);
        response['headers'] = {
          'X-Request-Id': requestIdHeader,
          ...(response['headers'] ? object(response['headers']) : {}),
        };
        if (method === 'head') delete response['content'];
        normalizedResponses[status] = response;
      }
      const security =
        policy.access.kind === 'public'
          ? []
          : policy.tag === 'Legacy'
            ? [{ serviceKey: [] }, { legacyApiKey: [] }, { legacyBasic: [] }]
            : [{ serviceKey: [] }];
      const parameters = originalOperation['parameters'] ?? downloadHeaders;
      const headParameters = Array.isArray(parameters)
        ? parameters.filter((p: unknown) => {
            const parameter = object(p);
            return parameter['in'] !== 'header' || parameter['name'] === 'If-None-Match';
          })
        : [];
      item[method] = {
        ...originalOperation,
        ...(content ? { parameters: method === 'head' ? headParameters : parameters } : {}),
        operationId: policy.operationId,
        tags: [policy.tag],
        security,
        'x-depot-authorization': policy.access,
        'x-depot-retry': policy.retry,
        'x-depot-route': route(path),
        'x-depot-gateway': method === 'get' || method === 'head' ? 'writer-or-reader' : 'writer',
        ...(content
          ? {
              'x-depot-streaming': {
                maxObjectBytes: '5368709120',
                range: method === 'head' ? 'ignored' : 'single',
                immutableBytes: true,
                resolution: policy.tag === 'Legacy' ? 'catalog-lookup-per-request' : 'artifact-id',
              },
            }
          : {}),
        ...(upload
          ? {
              'x-depot-streaming': {
                maxObjectBytes: '5368709120',
                maxRequestBytes: policy.operationId === 'putUploadPart' ? '8388608' : '5368709120',
                checksum: 'sha256',
                partialRequestCommitted: false,
                recovery:
                  policy.operationId === 'putUploadPart'
                    ? 'list-parts-then-retry-same-index-and-hash'
                    : 'get-upload-status-before-retry',
              },
            }
          : {}),
        responses: normalizedResponses,
      };
      operations.push({ ...policy, method, path, route: route(path) });
    }
    paths[path] = item;
  }
  for (const [path, methods] of Object.entries(operationPolicies))
    for (const method of Object.keys(methods))
      if (!paths[path]?.[method]) throw new Error(`Policy has no API operation: ${method} ${path}`);
  return { paths, operations };
}

export interface RuntimeRoute {
  method: string;
  url: string;
}
export function assertRouteInventory(
  routes: readonly RuntimeRoute[],
  operations: readonly ApiOperation[],
  exclusions: readonly RuntimeRoute[] = [],
): void {
  const key = (r: RuntimeRoute) => `${r.method.toUpperCase()} ${r.url}`;
  const expected = new Set(operations.map((o) => key({ method: o.method, url: o.route })));
  const excluded = new Set(exclusions.map(key));
  const actual = new Set(routes.map(key));
  const unexpected = [...actual].filter((r) => !expected.has(r) && !excluded.has(r));
  const missing = [...expected].filter((r) => !actual.has(r));
  if (unexpected.length || missing.length)
    throw new Error(
      `API route drift: undocumented [${unexpected.join(', ')}]; unregistered [${missing.join(', ')}]`,
    );
}
