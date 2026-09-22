import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

export function registerConsole(app: FastifyInstance, directory: string) {
  const files = [
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
      reply
        .header('Content-Type', type)
        .header(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        )
        .header('Referrer-Policy', 'no-referrer')
        .send(await readFile(resolve(directory, file))),
    );
}
