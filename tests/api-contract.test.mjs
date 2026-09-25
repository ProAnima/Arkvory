import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  apiMethods,
  apiOperations,
  assertRouteInventory,
  openApiDocument,
} from '@proanima/depot-contracts';
import { serviceActions } from '@proanima/depot-domain';
import { ajv } from './api-schema.mjs';

test('published contract has stable IDs, complete parameter/security metadata and compilable schemas', async () => {
  const baseline = JSON.parse(
    await readFile(new URL('./fixtures/api-operations.json', import.meta.url), 'utf8'),
  );
  const current = apiOperations
    .map(({ method, path, operationId }) => `${method.toUpperCase()} ${path} ${operationId}`)
    .sort();
  assert.deepEqual(current, baseline);
  assert.equal(new Set(apiOperations.map((o) => o.operationId)).size, apiOperations.length);
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    const variables = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const method of apiMethods) {
      const operation = item[method];
      if (!operation) continue;
      assert.ok(operation.operationId);
      assert.ok(operation.tags.length);
      assert.ok(operation['x-depot-retry']);
      assert.equal(
        operation['x-depot-gateway'],
        ['get', 'head'].includes(method) ? 'writer-or-reader' : 'writer',
      );
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
      assert.deepEqual(
        parameters
          .filter((p) => p.in === 'path')
          .map((p) => p.name)
          .sort(),
        variables,
      );
      for (const parameter of parameters) {
        if (parameter.in === 'path') assert.equal(parameter.required, true);
        ajv.compile(parameter.schema);
      }
      for (const requirement of operation.security)
        for (const [scheme, scopes] of Object.entries(requirement)) {
          assert.ok(openApiDocument.components.securitySchemes[scheme]);
          assert.deepEqual(scopes, []);
        }
      const access = operation['x-depot-authorization'];
      assert.equal(operation.security.length === 0, access.kind === 'public');
      if (access.kind === 'repository') {
        assert.ok(access.actions.length);
        assert.ok(access.actions.every((a) => serviceActions.includes(a)));
        assert.ok(access.legacy === null || access.legacy.length);
        if (access.legacy === null) assert.deepEqual(access.actions, ['artifact.delete']);
        if (access.resource === 'path.repository') assert.ok(variables.includes('repository'));
        else assert.equal(access.owner, 'job');
      }
      for (const content of Object.values(operation.requestBody?.content ?? {}))
        ajv.compile(content.schema);
      for (const [status, response] of Object.entries(operation.responses)) {
        assert.equal(typeof response.description, 'string');
        if (method === 'head' || ['204', '304', '416'].includes(status))
          assert.equal(response.content, undefined);
        for (const content of Object.values(response.content ?? {})) ajv.compile(content.schema);
      }
    }
  }
  const published = JSON.parse(
    await readFile(new URL('../packages/contracts/dist/openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(published, openApiDocument);
  const browser = await readFile(new URL('../apps/web/public/console.js', import.meta.url), 'utf8');
  assert.equal(
    browser.includes('API route drift'),
    false,
    'Server contract inventory must be tree-shaken out of the browser SDK',
  );
});

test('route drift rejects unknown methods, missing routes and undocumented console APIs', () => {
  const routes = apiOperations.map((o) => ({ method: o.method.toUpperCase(), url: o.route }));
  assertRouteInventory(routes, apiOperations);
  assert.throws(() => assertRouteInventory(routes.slice(1), apiOperations), /unregistered/);
  assert.throws(
    () =>
      assertRouteInventory(
        [...routes, { method: 'POST', url: '/api/v1/unchecked' }],
        apiOperations,
      ),
    /undocumented/,
  );
  const staticFile = { method: 'GET', url: '/console/' };
  assertRouteInventory([...routes, staticFile], apiOperations, [staticFile]);
  assert.throws(
    () =>
      assertRouteInventory([...routes, { method: 'POST', url: '/console/admin' }], apiOperations, [
        staticFile,
      ]),
    /undocumented/,
  );
});

test('streaming contract separates full, range and HEAD semantics and scopes every legacy auth scheme', () => {
  for (const op of apiOperations.filter((o) => ['Content', 'Legacy'].includes(o.tag))) {
    const contract = openApiDocument.paths[op.path][op.method];
    assert.deepEqual(op.access.actions, ['content.read']);
    assert.equal(contract['x-depot-streaming'].maxObjectBytes, '5368709120');
    if (op.method === 'head') {
      assert.equal(contract.responses['206'], undefined);
      assert.equal(contract.responses['416'], undefined);
      assert.equal(contract.responses['200'].content, undefined);
    } else
      assert.equal(
        contract.responses['206'].content['application/octet-stream'].schema.format,
        'binary',
      );
    assert.equal(contract.security.length, op.tag === 'Legacy' ? 3 : 1);
  }
  const common = openApiDocument.paths['/api/packages/{repository}/download'].head;
  assert.deepEqual(
    common.parameters.filter((p) => p.required).map((p) => p.name),
    ['name', 'version'],
  );
});
