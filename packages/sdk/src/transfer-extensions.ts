import type {
  TransferChannel,
  TransferExtension,
  TransferOffer,
  TransferResponse,
} from '@proanima/arkvory-extension-api';
import { readCapabilityOffers, record } from '@proanima/arkvory-contracts';
import type { TreeCapability } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { ArkvoryClientError, ArkvoryNetworkError, releaseReader } from './transfer.js';

/**
 * `auto` (the default) falls back to the core transfer whenever no extension fits or one fails;
 * `strict` refuses instead: no common capability is `transfer_unavailable`, a failing extension
 * fails the operation (ADR 0079, 5.2).
 */
export type TransferMode = 'auto' | 'strict';

/** Which way one operation moved its bytes; for diagnostics and progress output. */
export interface TransferEvent {
  readonly operation: 'download' | 'upload';
  /** The extension's name and the agreed version, or null for the core transfer. */
  readonly extension: { readonly name: string; readonly version: number } | null;
  /**
   * Why the core transfer took over from an extension: `declined` (it returned null or
   * false), `failed` (it threw), `incomplete` (its stream ended early).
   */
  readonly fallback?: 'declined' | 'failed' | 'incomplete';
}

/** An extension agreed for one operation. */
export interface ChosenTransfer {
  readonly extension: TransferExtension;
  readonly offer: TransferOffer;
}

const NAME = /^[a-z][a-z0-9-]{1,31}$/;
/** A module prefix the server may offer: the core API or a module under `/api/ext/`. */
const PREFIX = /^\/api\/(v1|ext\/[a-z][a-z0-9-]{1,31}\/v[1-9][0-9]{0,3})\/$/;
/** A relative path under the prefix: no scheme, no leading slash, no `.` or `..` segment. */
const RELATIVE = /^(?![/\\])[A-Za-z0-9._~!$&'()*+,;=:@%/?-]{0,2048}$/;

function validExtension(extension: TransferExtension): boolean {
  const versions: readonly unknown[] = extension.versions;
  return (
    NAME.test(extension.name) &&
    versions.length > 0 &&
    versions.length <= 32 &&
    versions.every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1)
  );
}

/**
 * The first extension of the client's list that the server offers, with the highest version
 * both know; the client's order is its preference. Offers with a malformed prefix are ignored.
 */
export function chooseTransfer(
  extensions: readonly TransferExtension[],
  offers: readonly TreeCapability[],
): ChosenTransfer | null {
  for (const extension of extensions) {
    for (const offer of offers) {
      if (offer.name !== extension.name || !PREFIX.test(offer.prefix)) continue;
      const common = offer.versions.filter((version) => extension.versions.includes(version));
      if (common.length === 0) continue;
      return {
        extension,
        offer: {
          name: offer.name,
          version: Math.max(...common),
          module: offer.module,
          prefix: offer.prefix,
        },
      };
    }
  }
  return null;
}

/** The server's `capabilities.transfer`, read once per client and tolerant of its absence. */
export class TransferExtensions {
  private offers: Promise<readonly TreeCapability[]> | undefined;
  constructor(
    private readonly http: HttpPort,
    readonly extensions: readonly TransferExtension[] = [],
    readonly mode: TransferMode = 'auto',
    private readonly observer?: (event: TransferEvent) => void,
  ) {
    if (extensions.some((extension) => !validExtension(extension)))
      throw new ArkvoryClientError('invalid_argument', 'Invalid transfer extension');
    const modes: readonly unknown[] = ['auto', 'strict'];
    if (!modes.includes(mode))
      throw new ArkvoryClientError('invalid_argument', 'Invalid transfer mode');
  }

  /** The extension for this operation, or null for the core transfer. */
  async choose(operation: 'download' | 'upload', signal?: AbortSignal) {
    const capable = this.extensions.filter(
      (extension) => typeof extension[operation] === 'function',
    );
    if (capable.length === 0 && this.mode === 'auto') return null;
    const chosen = chooseTransfer(capable, await this.serverOffers(signal));
    if (chosen === null && this.mode === 'strict')
      throw new ArkvoryClientError(
        'transfer_unavailable',
        'The server offers none of the transfer extensions of this client',
      );
    return chosen;
  }

  report(event: TransferEvent): void {
    try {
      this.observer?.(event);
    } catch {
      // Diagnostics never change the outcome of a transfer.
    }
  }

  /** Whether a failure of an extension falls back to the core transfer. */
  fallsBack(failure: unknown, signal?: AbortSignal): boolean {
    return this.mode === 'auto' && !signal?.aborted && !isAbort(failure);
  }

  private serverOffers(signal?: AbortSignal): Promise<readonly TreeCapability[]> {
    this.offers ??= this.http.call('api/v1/capabilities', 'GET', undefined, signal).then(
      (value) => readCapabilityOffers(record(value)['transfer']) ?? [],
      (error: unknown) => {
        // A failed read is not remembered: the next operation asks again.
        this.offers = undefined;
        if (this.mode === 'strict' || isAbort(error)) throw error;
        return [];
      },
    );
    return this.offers;
  }

  /** Requests under the offer's prefix with this client's credential and checks. */
  channel(offer: TransferOffer): TransferChannel {
    return {
      request: async (path, request, signal) => {
        if (!relativePath(path))
          throw new ArkvoryClientError('invalid_argument', 'Invalid extension path');
        const response = await this.http.request(
          `${offer.prefix.slice(1)}${path}`,
          {
            method: request.method,
            ...(request.headers ? { headers: { ...request.headers } } : {}),
            ...(request.body ? { body: new Uint8Array(request.body) } : {}),
          },
          signalOf(signal),
        );
        return transferResponse(response, signalOf(signal));
      },
    };
  }
}

/**
 * A path that stays under the prefix once resolved: no empty segment and no dot segment, in
 * any of the forms the URL parser reads as one (`%2e` is a dot to it).
 */
function relativePath(path: string): boolean {
  if (!RELATIVE.test(path)) return false;
  const [pathPart = ''] = path.split('?');
  return pathPart.split('/').every((segment, index, all) => {
    const dots = segment.toLowerCase().replaceAll('%2e', '.');
    return dots !== '.' && dots !== '..' && (segment !== '' || index === all.length - 1);
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** The extension contract types the signal structurally; the client passes real ones only. */
function signalOf(signal: unknown): AbortSignal | undefined {
  return signal instanceof AbortSignal ? signal : undefined;
}

function transferResponse(response: Response, signal?: AbortSignal): TransferResponse {
  const body = response.body;
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    body: {
      async *[Symbol.asyncIterator]() {
        if (!body) return;
        const reader = body.getReader();
        try {
          for (;;) {
            signal?.throwIfAborted();
            let result: ReadableStreamReadResult<Uint8Array>;
            try {
              result = await reader.read();
            } catch (error) {
              signal?.throwIfAborted();
              throw new ArkvoryNetworkError(error);
            }
            if (result.done) return;
            yield result.value;
          }
        } finally {
          await releaseReader(reader);
        }
      },
    },
    cancel: async () => {
      await body?.cancel().catch(() => undefined);
    },
  };
}
