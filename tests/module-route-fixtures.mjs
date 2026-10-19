import { moduleManifestOf, packageEntries } from './module-fixtures.mjs';

/**
 * The baseline module of the extension point `routes` (ADR 0083, N7 and N12): `echo`, a
 * `transfer` module whose routes cover every answer the core offers. Neutral on purpose: it
 * serves nothing but what tests ask of it.
 *
 * Routes under `/api/ext/<id>/v1/`:
 * - `GET info/:word` — JSON echo of the parameters, the query, the method and the mode;
 * - `GET repositories/:repository/artifacts/:artifact/content` — the artifact as `content`
 *   (`content.read`), `?cache=immutable` asks for the immutable cache;
 * - `GET stream?size=N` — N bytes of `e` as a `stream` with ETag `"echo-N"`; `&lie=1` declares
 *   one byte more than it sends;
 * - `POST repositories/:repository/echo` — a `stream` body (`upload.create`), answered with its
 *   length and SHA-256;
 * - `POST admin/notes` — a JSON body, global administrator only;
 * - `GET fail` throws, `GET slow` waits until its 200 ms run out, `GET refuse` refuses with
 *   `conflict`, `GET bad` answers HTML, which the core refuses.
 *
 * `options`: `fragment` (`none`, `missing` without the operation of `GET fail`, `extra` with an
 * operation without a route, `foreign` with a reference to a schema of another module),
 * `outside` (a route outside the prefix), `offer` (false: no transfer offer), `uploadLimit`.
 */
export function echoRoutesSource(manifest, options = {}) {
  return Buffer.from(`import { createHash } from 'node:crypto';
const manifest = ${JSON.stringify(manifest)};
const options = ${JSON.stringify(options)};
const prefix = '/api/ext/' + manifest.id + '/v1/';
const schema = 'ext_' + manifest.id.replaceAll('-', '_') + '_Answer';
const json = (body, status = 200) => ({ kind: 'json', status, body });
const read = { effect: 'read', access: 'authenticated', action: null, repositoryParam: null,
  body: { kind: 'none' }, responseLimit: 1048576, timeoutMs: 10000 };
function route(method, path, name, handle, overrides = {}) {
  return { ...read, method, path: prefix + path, operationId: manifest.id + '.' + name, handle,
    ...overrides };
}
async function* bytes(count) {
  let left = count;
  while (left > 0) {
    const size = Math.min(left, 16384);
    left -= size;
    yield new Uint8Array(size).fill(101);
  }
}
let retained;
function routes(context) {
  const list = [
    route('GET', 'info/:word', 'info', async (request) =>
      json({ module: manifest.id, word: request.params.word, query: request.query,
        method: request.method, mode: context.mode })),
    route('GET', 'repositories/:repository/artifacts/:artifact/content', 'content',
      async (request) => ({ kind: 'content', repository: request.params.repository,
        artifact: request.params.artifact,
        ...(request.query.cache ? { cache: request.query.cache } : {}) }),
      { action: 'content.read', repositoryParam: 'repository' }),
    route('GET', 'stream', 'stream', async (request) => {
      const size = Number(request.query.size ?? '1000');
      return { kind: 'stream', contentType: 'application/octet-stream',
        length: request.query.lie ? size + 1 : size, etag: '"echo-' + size + '"', body: bytes(size) };
    }, { responseLimit: 4194304 }),
    route('POST', 'repositories/:repository/echo', 'echo', async (request, signal) => {
      const hash = createHash('sha256');
      let length = 0;
      for await (const chunk of request.body.bytes) {
        signal.throwIfAborted();
        hash.update(chunk);
        length += chunk.byteLength;
      }
      return json({ length, declared: request.body.length, sha256: hash.digest('hex') }, 201);
    }, { effect: 'write', action: 'upload.create', repositoryParam: 'repository',
      body: { kind: 'stream', limit: options.uploadLimit ?? 1048576 } }),
    route('POST', 'admin/notes', 'note', async (request) => json({ received: request.body.value }, 202),
      { effect: 'write', access: 'administrator', body: { kind: 'json', limit: 1024 } }),
    route('GET', 'fail', 'fail', async () => { throw new Error('boom'); }),
    route('GET', 'slow', 'slow', (_request, signal) => new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve(json({ late: true })), { once: true })),
      { timeoutMs: 200 }),
    route('GET', 'refuse', 'refuse', async () => ({ kind: 'error', code: 'conflict' })),
    route('GET', 'bad', 'bad', async () => ({ kind: 'stream', contentType: 'text/html',
      length: null, etag: null, body: bytes(4) })),
  ];
  if (options.scope) list.push(
    route('GET', 'uploads/:repository/:id', 'uploadRead', async (request, signal) => {
      const scope = context.services['catalog-read'].intersect(request.scope, request.scope);
      const ref = { repository: request.params.repository, id: request.params.id };
      const reader = context.services['upload-read'];
      if (request.query.retained) return json({ upload: retained ? await reader.upload(retained, ref.repository, ref.id) : null });
      retained = scope;
      const upload = await reader.upload(scope, ref.repository, ref.id);
      if (!upload) return { kind: 'error', code: 'not_found' };
      if (request.query.view) return json(upload);
      const range = { start: Number(request.query.start), end: Number(request.query.end) };
      const source = reader.read(scope, ref, range, signal);
      if (request.query.eager) {
        const iterator = source[Symbol.asyncIterator]();
        const first = await iterator.next();
        return { kind: 'stream', contentType: 'application/octet-stream', length: range.end - range.start + 1, etag: '"upload"',
          body: { async *[Symbol.asyncIterator]() { if (!first.done) yield first.value; yield* source; } } };
      }
      return { kind: 'stream', contentType: 'application/octet-stream', length: range.end - range.start + 1, etag: null, body: source };
    }),
    route('POST', 'withdraw', 'withdraw', async () => {
      context.services.routes.withdrawTransfer(manifest.id);
      return json({ withdrawn: true });
    }, { effect: 'write', access: 'administrator' }),
  );
  if (options.outside) list.push(route('GET', '../v2/info', 'outside', async () => json({})));
  return list;
}
function operation(entry) {
  return {
    operationId: entry.operationId,
    summary: 'Echo ' + entry.operationId,
    'x-arkvory-access': entry.access,
    ...(entry.body.kind === 'none' ? {} : { requestBody: { content: {
      [entry.body.kind === 'json' ? 'application/json' : 'application/octet-stream']: {} } } }),
    responses: {
      200: { description: 'Answer', content: { 'application/json': { schema: { $ref:
        '#/components/schemas/' + (options.fragment === 'foreign' ? 'ext_other_Answer' : schema) } } } },
      default: { description: 'Error', content: { 'application/json': { schema: { $ref:
        '#/components/schemas/NativeError' } } } },
    },
  };
}
function fragment(list) {
  const paths = {};
  for (const entry of list) {
    if (options.fragment === 'missing' && entry.operationId.endsWith('.fail')) continue;
    const path = entry.path.replace(/:([a-zA-Z0-9]+)/g, '{$1}');
    paths[path] = { ...paths[path], [entry.method.toLowerCase()]: operation(entry) };
  }
  if (options.fragment === 'extra')
    paths[prefix + 'ghost'] = { get: operation({ ...read, operationId: manifest.id + '.ghost' }) };
  return { openapi: '3.1.0', paths, components: { schemas: { [schema]: { type: 'object' } } } };
}
export default {
  manifest,
  parseConfig: (input) => input ?? {},
  describeConfig: () => ({}),
  create(context) {
    const list = routes(context);
    for (const entry of list) context.services.routes.add(entry);
    if (options.fragment !== 'none') context.services.routes.document(fragment(list));
    if (options.offer !== false)
      context.services.routes.offerTransfer({ name: manifest.id, versions: ['1.0.0', '1.1.0'], prefix });
    return {
      async start() {},
      async drain() {},
      async stop() {},
      health: () => ({ status: 'ok', code: null }),
    };
  },
};
`);
}

/** The signed package of `echoRoutesSource`: kind `transfer`, the service `routes`, one prefix. */
export function echoRoutesPackage(signer, manifest = {}, options = {}) {
  const id = manifest.id ?? 'echo';
  const roles = manifest.roles ?? ['api', 'reader'];
  const full = {
    id,
    kind: 'transfer',
    uses: ['routes'],
    routePrefixes: [`/api/ext/${id}/v1/`],
    roles,
    entry: Object.fromEntries(roles.map((r) => [r, 'files/main.mjs'])),
    ...manifest,
  };
  return packageEntries({
    signer,
    manifest: full,
    files: {
      'files/main.mjs': echoRoutesSource(moduleManifestOf(full), options),
      'files/LICENSE.md': Buffer.from('# Module terms\n\nTest terms.\n'),
    },
  });
}
