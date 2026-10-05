import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** A dictionary of the console other than the bundled English and Russian: `xx.json`. */
const dictionaryName = /^[a-z]{2}\.json$/;
/** The flag beside a language in the switch: `gb.svg`. */
const flagName = /^[a-z]{2}\.svg$/;

function send(reply: FastifyReply, type: string, body: Buffer) {
  return reply
    .header('Content-Type', type)
    .header(
      'Content-Security-Policy',
      // blob: only for images the page itself made from local files (feedback screenshots).
      "default-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    .header('Referrer-Policy', 'no-referrer')
    .send(body);
}

export function registerConsole(app: FastifyInstance, directory: string) {
  const files = [
    ['/console/arkvory.svg', 'arkvory.svg', 'image/svg+xml'],
    ['/console/arkvory.ico', 'arkvory.ico', 'image/x-icon'],
    ['/console/arkvory.png', 'arkvory.png', 'image/png'],
    ['/console/THIRD-PARTY.txt', 'THIRD-PARTY.txt', 'text/plain; charset=utf-8'],
    ['/console/', 'index.html', 'text/html; charset=utf-8'],
    ['/console/console.js', 'console.js', 'text/javascript; charset=utf-8'],
    ['/console/hash-worker.js', 'hash-worker.js', 'text/javascript; charset=utf-8'],
    ['/console/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/console/tokens.css', 'tokens.css', 'text/css; charset=utf-8'],
    ['/console/appearance-init.js', 'appearance-init.js', 'text/javascript; charset=utf-8'],
  ] as const;
  for (const [url, file, type] of files)
    app.get(url, async (_request, reply) =>
      send(reply, type, await readFile(resolve(directory, file))),
    );
  // A name is checked before it reaches the file system: two letters and the extension.
  named(
    app,
    '/console/locales/:file',
    directory,
    'locales',
    dictionaryName,
    'application/json; charset=utf-8',
  );
  named(app, '/console/flags/:file', directory, 'flags', flagName, 'image/svg+xml');
}

function named(
  app: FastifyInstance,
  route: string,
  directory: string,
  folder: string,
  pattern: RegExp,
  type: string,
) {
  app.get<{ Params: { file: string } }>(route, async (request, reply) => {
    const name = request.params.file;
    const body = pattern.test(name)
      ? await readFile(resolve(directory, folder, name)).catch(() => undefined)
      : undefined;
    if (!body) {
      reply.callNotFound();
      return reply;
    }
    return send(reply, type, body);
  });
}
