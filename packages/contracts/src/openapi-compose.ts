import { operationPolicies } from './operation-policy.js';
import { apiClassification } from './api-surfaces.js';
import type { ApiSurface, ApiVisibility } from './api-surfaces.js';
import type { ApiMethod, OperationPolicy } from './operation-policy.js';
import { composeOperation, methodPolicy, object, route } from './openapi-operation.js';
import type { ObjectValue } from './openapi-operation.js';

export interface ApiOperation extends OperationPolicy {
  surface: ApiSurface;
  visibility: ApiVisibility;
  summary: string;
  method: ApiMethod;
  path: string;
  route: string;
}
export const apiMethods: readonly ApiMethod[] = ['get', 'head', 'post', 'put', 'patch', 'delete'];

/**
 * Joins declared OpenAPI paths with operation policies. Every declared operation needs a policy
 * and every policy an operation; operationIds are unique, GET implies HEAD.
 */
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
      const policy = methodPolicy(declared, method, path);
      if (ids.has(policy.operationId))
        throw new Error(`Duplicate operationId: ${policy.operationId}`);
      ids.add(policy.operationId);
      const originalOperation = object(item[method]);
      const classification = apiClassification(policy);
      const summary = originalOperation['summary'];
      if (typeof summary !== 'string' || summary.length > 1024)
        throw new Error(`Missing API summary: ${method} ${path}`);
      item[method] = composeOperation(originalOperation, policy, classification, method, path);
      operations.push({ ...policy, ...classification, summary, method, path, route: route(path) });
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
