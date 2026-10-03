import { ArkvoryError } from '@proanima/arkvory-domain';
import type {
  FeedbackAttachmentsResponse,
  FeedbackRequest,
  FeedbackReceipt,
} from '@proanima/arkvory-contracts';

/** The hub this server sends feedback to (ADR 0060); null when the operator turned it off. */
export interface FeedbackHub {
  readonly url: string;
  readonly project: string;
}
export interface FeedbackSources {
  readonly hub: FeedbackHub | null;
  readonly version: string;
  /** The newest records of this API process; null when the caller owns the logger. */
  readonly log: { text(): string } | null;
  /** A summary without secrets: versions, update, backup and mirror states. */
  readonly system: () => Promise<Record<string, unknown>>;
  readonly fetch?: typeof fetch;
}

const os = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'x64' ? 'x86_64' : process.arch;

/**
 * Forwards a checked feedback request to the hub as the hub's multipart form. The server log
 * and system summary are added only when the caller (an administrator) asked for them; the
 * console shows the same texts before sending. Nothing is retried: a second click is a second
 * message.
 */
export class FeedbackForwarder {
  constructor(private readonly sources: FeedbackSources) {}

  async attachments(): Promise<FeedbackAttachmentsResponse> {
    return {
      serverLog: this.sources.log?.text() ?? '',
      system: `${JSON.stringify(await this.sources.system(), null, 2)}\n`,
    };
  }

  async send(request: FeedbackRequest): Promise<FeedbackReceipt> {
    const hub = this.sources.hub;
    if (!hub)
      throw new ArkvoryError('unavailable', 'Feedback is turned off', {
        reason: 'feedback_disabled',
      });
    const form = new FormData();
    form.append('message', request.message);
    if (request.email) form.append('email', request.email);
    form.append(
      'meta',
      JSON.stringify({
        version: this.sources.version,
        os,
        arch,
        mode: 'server',
        lang: request.lang,
        ...(request.screen ? { screen: request.screen } : {}),
      }),
    );
    for (const shot of request.screenshots)
      form.append(
        'screenshot',
        new Blob([Buffer.from(shot.data, 'base64')], { type: shot.type }),
        shot.name,
      );
    const log = (name: string, text: string) => {
      form.append('log', new Blob([text], { type: 'text/plain' }), name);
    };
    if (request.clientLog) log('arkvory-console.log', request.clientLog);
    if (request.serverLog) {
      const attached = await this.attachments();
      if (attached.serverLog) log('arkvory-api.log', attached.serverLog);
      log('arkvory-system.json', attached.system);
    }
    return this.post(hub, form);
  }

  private async post(hub: FeedbackHub, form: FormData): Promise<FeedbackReceipt> {
    let response: Response;
    try {
      response = await (this.sources.fetch ?? fetch)(
        `${hub.url}/v1/${encodeURIComponent(hub.project)}/feedback`,
        { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60000) },
      );
    } catch {
      throw unreachable();
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 202 && body && typeof body === 'object' && 'id' in body)
      return { id: String(body.id) };
    throw refusal(response, body);
  }
}

const unreachable = () =>
  new ArkvoryError('unavailable', 'The feedback hub cannot be reached', {
    reason: 'hub_unreachable',
  });

/** The hub's `{"error": {"code"}}` in this API's error contract. */
function refusal(response: Response, body: unknown): ArkvoryError {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (code === 'feedback.rate_limited' || response.status === 429)
    return new ArkvoryError('rate_limited', 'Too much feedback from this server', {
      reason: 'feedback_attempts',
      retryAfterSeconds: Math.min(Number(response.headers.get('retry-after')) || 600, 86400),
    });
  if (code === 'feedback.disabled' || code === 'project.unknown')
    return new ArkvoryError('unavailable', 'Feedback is turned off at the hub', {
      reason: 'feedback_disabled',
    });
  // Checked here with the hub's own limits: a refusal means the two disagree, not the user.
  if (response.status >= 400 && response.status < 500)
    return new ArkvoryError('invalid_input', `The hub refused the feedback (${code || 'unknown'})`);
  return unreachable();
}
