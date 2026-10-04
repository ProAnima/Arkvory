import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError, npmPackument } from '@proanima/arkvory-domain';
import type { NpmRegistry, NpmSearchItem } from '@proanima/arkvory-application';
import { UploadReceiver } from './upload-lifetime.js';
import type { ProtocolTransfers } from './protocol-transfers.js';
import { registerNpmErrors } from './npm-errors.js';
import { publicOrigin } from './public-origin.js';

interface Npm extends ProtocolTransfers {
  readonly npm: NpmRegistry;
}
type Request = FastifyRequest<{ Params: { repository: string } }>;
export type NpmTarget =
  | { readonly kind: 'search' }
  | { readonly kind: 'tags'; readonly name: string; readonly tag: string | null }
  | { readonly kind: 'tarball'; readonly name: string; readonly file: string }
  | { readonly kind: 'package'; readonly name: string };

const unsupported = () =>
  new ArkvoryError('invalid_input', 'This registry supports publish, install and dist-tags', {
    reason: 'method_not_allowed',
  });

/** `@scope/name` comes as two segments or as one with an encoded slash. */
function nameAt(segments: readonly string[], index: number): [string, number] | null {
  const first = segments[index];
  if (first === undefined || first === '') return null;
  if (!first.startsWith('@') || first.includes('/')) return [first, index + 1];
  const second = segments[index + 1];
  return second === undefined ? null : [`${first}/${second}`, index + 2];
}

/** What a path below `/npm/<repository>/` names; null for anything else. */
export function npmTarget(segments: readonly string[]): NpmTarget | null {
  if (segments[0] === '-') {
    if (segments.length === 3 && segments[1] === 'v1' && segments[2] === 'search')
      return { kind: 'search' };
    const at = segments[1] === 'package' ? nameAt(segments, 2) : null;
    if (!at || segments[at[1]] !== 'dist-tags') return null;
    const rest = segments.slice(at[1] + 1);
    if (rest.length > 1) return null;
    return { kind: 'tags', name: at[0], tag: rest[0] ?? null };
  }
  const at = nameAt(segments, 0);
  if (!at) return null;
  const rest = segments.slice(at[1]);
  if (rest.length === 0) return { kind: 'package', name: at[0] };
  const [dash, file] = rest;
  return rest.length === 2 && dash === '-' && file ? { kind: 'tarball', name: at[0], file } : null;
}

function targetOf(request: Request): NpmTarget {
  const path = (request.raw.url ?? '').split('?')[0] ?? '';
  let segments: string[];
  try {
    segments = path.split('/').slice(3).map(decodeURIComponent);
  } catch {
    throw new ArkvoryError('not_found', 'Not found', { reason: 'route_not_found' });
  }
  const target = npmTarget(segments);
  if (target) return target;
  // Unpublish and deprecation paths: npm prints that this registry does not offer them.
  if (request.method !== 'GET' && request.method !== 'HEAD') throw unsupported();
  throw new ArkvoryError('not_found', 'Not found', { reason: 'route_not_found' });
}

const base = (request: Request) =>
  `${publicOrigin(request).origin}/npm/${encodeURIComponent(request.params.repository)}`;
const count = (value: unknown, fallback: number, max: number) => {
  const number = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : fallback;
  return Math.min(number, max);
};
const searchObject = (item: NpmSearchItem) => ({
  // npm's search output reads maintainers and links of every result.
  package: { ...item, description: item.description ?? '', links: {}, maintainers: [] },
  score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } },
  searchScore: 1,
});

/** A dist-tag body: a JSON string of at most a few hundred bytes. */
async function smallJson(body: unknown): Promise<unknown> {
  if (!(body instanceof Readable)) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > 1024)
      throw new ArkvoryError('invalid_input', 'Body too large', { reason: 'body_too_large' });
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ArkvoryError('invalid_input', 'Malformed JSON', { reason: 'malformed_json' });
  }
}

async function read(s: Npm, request: Request, reply: FastifyReply, target: NpmTarget) {
  const principal = s.principal(request);
  const { repository } = request.params;
  switch (target.kind) {
    case 'package': {
      const { versions, tags } = await s.npm.packument(principal, repository, target.name);
      return reply.send(
        npmPackument(target.name, versions, tags, `${base(request)}/${target.name}/-/`),
      );
    }
    case 'tarball': {
      const artifactId = await s.npm.tarball(principal, repository, target.name, target.file);
      return s.sendContent(request, reply, repository, artifactId);
    }
    case 'search': {
      const raw: unknown = request.query;
      const query: Record<string, unknown> =
        typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
      const text = typeof query['text'] === 'string' ? query['text'] : '';
      const from = count(query['from'], 0, 100_000);
      const size = count(query['size'], 20, 250);
      const page = await s.npm.search(principal, repository, text, from, size);
      return reply.send({
        objects: page.packages.map(searchObject),
        total: page.total,
        time: new Date().toUTCString(),
      });
    }
    case 'tags':
      if (target.tag !== null) throw unsupported();
      return reply.send(await s.npm.tags(principal, repository, target.name));
  }
}

async function change(
  s: Npm,
  request: Request,
  reply: FastifyReply,
  target: NpmTarget,
  receiver: UploadReceiver,
) {
  const principal = s.principal(request);
  const { repository } = request.params;
  if (request.method === 'PUT' && target.kind === 'package') {
    if (!(request.body instanceof Readable)) request.body = Readable.from([]);
    const result = await s.modifying(request, () =>
      receiver.receive(request, reply, principal.id, s.signal(request, reply), (source, signal) =>
        s.npm.publish(principal, repository, target.name, source, signal),
      ),
    );
    return reply.code(result.created ? 201 : 200).send({ ok: true, id: target.name });
  }
  if (target.kind !== 'tags' || target.tag === null) throw unsupported();
  if (request.method === 'PUT') {
    const version = await smallJson(request.body);
    await s.npm.setTag(principal, repository, target.name, target.tag, version);
  } else await s.npm.removeTag(principal, repository, target.name, target.tag);
  return reply.code(200).send({ ok: true });
}

/**
 * The npm registry of a repository (ADR 0066) at `/npm/<repository>`: the scoped registry of
 * Unity Package Manager and of npm. Package names may contain `@scope/`, so one wildcard route
 * takes every path and `npmTarget` names it. Publishing shares upload admission, bandwidth and
 * deadlines with every other upload; tarballs download like artifacts.
 */
export function registerNpmRoutes(app: FastifyInstance, s: Npm) {
  const report = (request: FastifyRequest, code: 'upload.input_timeout' | 'upload.deadline') => {
    s.diagnostics.write({
      level: 'warning',
      component: 'http',
      code,
      requestId: request.id,
      route: request.routeOptions.url ?? 'unknown',
      method: request.method,
    });
  };
  const receiver = new UploadReceiver(s.policy, s.bandwidth, report);
  void app.register((scope, _options, done) => {
    registerNpmErrors(scope, s.context);
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });
    scope.route<{ Params: { repository: string } }>({
      method: ['GET', 'HEAD', 'PUT', 'DELETE'],
      url: '/npm/:repository/*',
      handler: async (request, reply) => {
        const target = targetOf(request);
        return request.method === 'GET' || request.method === 'HEAD'
          ? read(s, request, reply, target)
          : change(s, request, reply, target, receiver);
      },
    });
    done();
  });
}
