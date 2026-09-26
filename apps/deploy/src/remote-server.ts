import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { RemoteWorkflow } from './remote-workflow.js';
import { remoteInput, remoteOwner } from './remote-model.js';
import type { RemoteOwner } from './remote-model.js';
import { wizardView, wizardStyle } from './remote-view.js';
import type { WizardLanguage } from './remote-view.js';

export interface WizardJob {
  state: RemoteWorkflow['state'];
  active: boolean;
  discover(): Promise<void>;
  inspect(): Promise<void>;
  install(owner?: RemoteOwner): Promise<void>;
  close(): void;
}
interface Options {
  artifact?: string;
  factory?: (input: ReturnType<typeof remoteInput>) => WizardJob;
}
const random = () => randomBytes(32).toString('hex');
const same = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
class WizardSession {
  readonly entry = random();
  private readonly cookie = random();
  private readonly cookieName = 'arkvory-wizard-' + random().slice(0, 16);
  private readonly csrf = random();
  private redeemed = false;
  private job: WizardJob | undefined;
  private busy = false;
  touched = Date.now();
  origin = '';
  constructor(private readonly options: Options) {}
  close() {
    this.job?.close();
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    // Keep same-origin form Origin verifiable while stripping the one-time entry path from referrers.
    res.setHeader('Referrer-Policy', 'strict-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (req.headers.host !== new URL(this.origin).host) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', this.origin),
      language: WizardLanguage = url.searchParams.get('lang') === 'en' ? 'en' : 'ru';
    if (
      req.method === 'GET' &&
      url.pathname === '/entry' &&
      !this.redeemed &&
      same(url.searchParams.get('key') ?? '', this.entry)
    ) {
      this.redeemed = true;
      res.setHeader(
        'Set-Cookie',
        `${this.cookieName}=${this.cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      res.writeHead(303, { Location: '/' }).end();
      return;
    }
    const supplied =
      (req.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(this.cookieName + '='))
        ?.slice(this.cookieName.length + 1) ?? '';
    if (!same(supplied, this.cookie)) {
      res.writeHead(403).end();
      return;
    }
    this.touched = Date.now();
    if (req.method === 'GET' && url.pathname === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }).end(wizardStyle);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      this.page(res, language, url.searchParams.has('error'));
      return;
    }
    if (
      req.method !== 'POST' ||
      req.headers.origin !== this.origin ||
      req.headers['content-type']?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded'
    ) {
      res.writeHead(403).end();
      return;
    }
    const form = await body(req);
    if (!same(form.get('csrf') ?? '', this.csrf) || form.getAll('csrf').length !== 1) {
      res.writeHead(403).end();
      return;
    }
    const error = await this.action(url.pathname, form);
    res.writeHead(303, { Location: `/?lang=${language}${error ? '&error=1' : ''}` }).end();
  }
  private page(res: ServerResponse, language: WizardLanguage, error: boolean) {
    const job = this.job;
    if (job && !['fingerprint', 'review', 'failed', 'closed'].includes(job.state.phase))
      res.setHeader('Refresh', job.state.phase === 'ready' ? '10' : '2');
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(wizardView(language, this.csrf, job?.state, job?.active, error));
  }
  private async action(path: string, form: URLSearchParams) {
    try {
      if (path === '/reset') {
        this.job?.close();
        this.job = undefined;
      } else if (path === '/discover' && !this.job && !this.busy) {
        this.busy = true;
        try {
          const input = remoteInput(form);
          this.job =
            this.options.factory?.(input) ?? new RemoteWorkflow(input, this.options.artifact);
          await this.job.discover();
        } catch {
          this.job?.close();
          this.job = undefined;
          return true;
        } finally {
          this.busy = false;
        }
      } else if (
        path === '/inspect' &&
        this.job &&
        this.job.state.phase === 'fingerprint' &&
        form.get('trusted') === 'yes'
      )
        void this.job.inspect().catch(() => undefined);
      else if (path === '/install' && this.job && this.job.state.phase === 'review')
        void this.job
          .install(this.job.state.target?.installed ? undefined : remoteOwner(form))
          .catch(() => undefined);
      else return true;
    } catch {
      return true;
    }
    return false;
  }
}
export async function createRemoteWizard(options: Options = {}) {
  const session = new WizardSession(options);
  const server = createServer((req, res) => {
    void session.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 32;
  const close = () => {
    clearInterval(idle);
    session.close();
    server.closeAllConnections();
    server.close();
  };
  const idle = setInterval(() => {
    if (Date.now() - session.touched > 30 * 60000) close();
  }, 60000);
  idle.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    close();
    throw new Error('Wizard address unavailable');
  }
  session.origin = `http://127.0.0.1:${String(address.port)}`;
  return { url: `${session.origin}/entry?key=${session.entry}`, close };
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of req) {
    const chunk: unknown = raw;
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid request');
    size += chunk.length;
    if (size > 128 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
