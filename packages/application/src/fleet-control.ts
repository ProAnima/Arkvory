import { ArkvoryError, isFleetName } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';

/** A site as the controller keeps it (ADR 0077); `sealedKey` never leaves this layer. */
export interface FleetSiteRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly pin: string | null;
  readonly certificate: string | null;
  readonly sealedKey: Uint8Array;
  readonly addedBy: string;
  readonly addedAt: string;
  readonly seenAt: string | null;
  readonly state: string;
  readonly error: string | null;
  readonly topology: unknown;
}
/** The outcome of one poll: `ok` with the topology, or why the site was not read. */
export interface FleetObservation {
  readonly state: 'ok' | 'unreachable' | 'certificate' | 'revoked' | 'invalid' | 'refused';
  readonly error: string | null;
  /** When the controller read the site, by its clock: `seenAt` of an answer. */
  readonly at: string;
  readonly topology?: unknown;
  readonly name?: string;
}
export interface FleetSiteStore {
  list(): Promise<readonly FleetSiteRecord[]>;
  get(id: string): Promise<FleetSiteRecord | null>;
  add(
    site: Omit<FleetSiteRecord, 'addedAt' | 'seenAt' | 'state' | 'error' | 'topology'>,
  ): Promise<void>;
  observe(id: string, observation: FleetObservation): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface FleetEndpointView {
  readonly url: string;
  readonly pin: string | null;
  readonly certificate: string | null;
}
export interface SiteCertificateView {
  readonly pin: string;
  readonly certificate: string;
  readonly subject: string;
  readonly issuer: string;
  readonly validTo: string;
}
/** The part of an AbortSignal the fleet passes on; the core has no DOM or Node globals. */
export interface FleetAbortSignal extends Cancellation {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
/**
 * How the controller talks to sites; failures carry a `code` of FleetObservation states. An
 * aborted `signal` ends the request at once and releases what it holds.
 */
export interface FleetSiteClient {
  origin(url: unknown): string;
  certificate(origin: string): Promise<SiteCertificateView | null>;
  enroll(
    endpoint: FleetEndpointView,
    code: string,
    controllerName: string,
  ): Promise<{ readonly key: string; readonly name: string; readonly version: string }>;
  topology(
    endpoint: FleetEndpointView,
    key: string,
    actor: string,
    signal?: FleetAbortSignal,
  ): Promise<unknown>;
  /** A GET of `path` on the site with its key; the answer's status and JSON body. */
  read(
    endpoint: FleetEndpointView,
    key: string,
    actor: string,
    path: string,
    signal?: FleetAbortSignal,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  /** A change of `path` on the site with its key, sent once. */
  change(
    endpoint: FleetEndpointView,
    key: string,
    actor: string,
    method: 'PUT' | 'POST',
    path: string,
    body: unknown,
    signal?: FleetAbortSignal,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}
export interface FleetKeySeal {
  seal(siteId: string, key: string): Uint8Array;
  open(siteId: string, box: Uint8Array): string;
}

const failureState = (error: unknown): FleetObservation['state'] => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === 'unreachable' ||
    code === 'certificate' ||
    code === 'revoked' ||
    code === 'invalid' ||
    code === 'refused'
    ? code
    : 'invalid';
};

/** Sites polled at once: a slow site must not hold the others. */
const CONCURRENCY = 8;
/**
 * What the registry keeps of a site's topology. Its column holds 262144 bytes of jsonb text, which
 * adds a space after every `,` and `:`: a contract-checked topology (plain integers, no exponents)
 * grows by at most half there. Two thirds of the column in UTF-8 bytes of JSON, so the database
 * check never is the one that refuses it.
 */
const TOPOLOGY_LIMIT = Math.floor((262144 * 2) / 3);
/** Reads and changes passed to sites at once: per site and in all. */
const PER_SITE = 4;
const IN_FLIGHT = 16;

/**
 * The controller's side of the fleet (ADR 0077): get to know a site, pair with it, read every
 * site's state in the background, forget a site. Only a global administrator reaches it.
 */
export class FleetControl {
  private readonly inFlight = new Map<string, number>();
  private readonly polls = new Map<string, Promise<void>>();
  private total = 0;
  constructor(
    private readonly sites: FleetSiteStore,
    private readonly client: FleetSiteClient,
    private readonly seal: FleetKeySeal | undefined,
    private readonly ids: () => string,
    private readonly controllerName: string,
    private readonly now: () => string,
  ) {}

  private sealer(): FleetKeySeal {
    if (!this.seal)
      throw new ArkvoryError('unavailable', 'ARKVORY_FLEET_KEY_FILE is not configured');
    return this.seal;
  }

  /** The certificate a site presents, for the administrator to compare before pairing. */
  async probe(url: unknown) {
    const origin = this.origin(url);
    const certificate = await this.reach(() => this.client.certificate(origin));
    return { url: origin, certificate };
  }

  /**
   * Pairs with a site: its certificate must still be the one the administrator confirmed, the
   * code is traded for a key, the key is sealed and the site read once.
   */
  async add(input: { url: unknown; pin: unknown; code: unknown; actor: string }) {
    const seal = this.sealer();
    const origin = this.origin(input.url);
    // Before the code is spent: a site paired once is not paired again by mistake.
    if ((await this.sites.list()).some((site) => site.url === origin))
      throw new ArkvoryError('conflict', 'This site is already managed here', {
        reason: 'already_exists',
      });
    const certificate = await this.reach(() => this.client.certificate(origin));
    const pin = certificate?.pin ?? null;
    if (pin !== (typeof input.pin === 'string' ? input.pin.toLowerCase() : null))
      throw new ArkvoryError('conflict', 'The site presents another certificate than confirmed', {
        reason: 'state_conflict',
      });
    if (typeof input.code !== 'string')
      throw new ArkvoryError('invalid_input', 'Pairing code required');
    const endpoint = { url: origin, pin, certificate: certificate?.certificate ?? null };
    const enrolled = await this.reach(() =>
      this.client.enroll(endpoint, input.code as string, this.controllerName),
    );
    const id = this.ids();
    await this.sites.add({
      id,
      name: enrolled.name,
      url: origin,
      pin,
      certificate: endpoint.certificate,
      sealedKey: seal.seal(id, enrolled.key),
      addedBy: input.actor,
    });
    await this.poll(id, input.actor);
    return this.view(id);
  }

  async list() {
    return (await this.sites.list()).map(present);
  }

  async view(id: string) {
    const site = await this.sites.get(id);
    if (!site) throw new ArkvoryError('not_found', 'Site not found');
    return present(site);
  }

  async remove(id: string) {
    await this.sites.remove(id);
  }

  /**
   * Reads one site now and records the outcome; never throws for the site's failure. A topology
   * that cannot be stored (larger than the registry keeps, or with characters a JSON column
   * refuses) is recorded as `invalid`, never left as the last good state.
   *
   * One read of a site at a time: a caller while one runs joins it (its actor and signal stay
   * the first caller's), so an older answer finishing last never overwrites a newer one.
   */
  poll(id: string, actor = 'fleet', signal?: FleetAbortSignal): Promise<void> {
    const running = this.polls.get(id);
    if (running) return running;
    const started = this.observe(id, actor, signal).finally(() => {
      this.polls.delete(id);
    });
    this.polls.set(id, started);
    return started;
  }

  private async observe(id: string, actor: string, signal: FleetAbortSignal | undefined) {
    const site = await this.sites.get(id);
    if (!site) throw new ArkvoryError('not_found', 'Site not found');
    let observation: FleetObservation;
    try {
      const key = this.sealer().open(site.id, site.sealedKey);
      const topology = await this.client.topology(site, key, actor, signal);
      const text = JSON.stringify(topology);
      if (utf8Length(text) > TOPOLOGY_LIMIT || text.includes('\\u0000'))
        throw Object.assign(new Error('Topology cannot be stored'), { code: 'invalid' });
      const name = siteName(topology);
      observation = {
        state: 'ok',
        error: null,
        at: this.now(),
        topology,
        ...(name ? { name } : {}),
      };
    } catch (error) {
      // Cancelled (shutdown): nothing was learnt of the site, so nothing is recorded.
      signal?.throwIfAborted();
      const state = failureState(error);
      observation = { state, error: state, at: this.now() };
    }
    await this.sites.observe(id, observation);
  }

  /**
   * Reads catalog metadata of a site with its key. `allowed` is the fixed list of read paths: a
   * path outside it is refused here, before the site is asked.
   */
  async read(
    id: string,
    path: string,
    actor: string,
    allowed: (path: string) => boolean,
    signal?: FleetAbortSignal,
  ) {
    if (!allowed(path))
      throw new ArkvoryError('invalid_input', 'Only catalog metadata of a site can be read');
    return this.forward(id, (site, key) => this.client.read(site, key, actor, path, signal));
  }

  /**
   * Passes one change to a site (stage F3); `methodOf` names the method of an allowed path. The
   * site checks the revision or id of the change, so its answer, a conflict too, is returned.
   */
  async change(
    id: string,
    path: string,
    body: unknown,
    actor: string,
    methodOf: (path: string) => 'PUT' | 'POST' | undefined,
    signal?: FleetAbortSignal,
  ) {
    const method = methodOf(path);
    if (!method)
      throw new ArkvoryError('invalid_input', 'Only the listed settings of a site can be changed');
    return this.forward(id, (site, key) =>
      this.client.change(site, key, actor, method, path, body, signal),
    );
  }

  private async forward(
    id: string,
    send: (
      site: FleetEndpointView,
      key: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>,
  ) {
    const site = await this.sites.get(id);
    if (!site) throw new ArkvoryError('not_found', 'Site not found');
    const key = this.sealer().open(site.id, site.sealedKey);
    // Answers of up to 16 MiB are held in memory: few at once per site and in all.
    const running = this.inFlight.get(id) ?? 0;
    if (running >= PER_SITE || this.total >= IN_FLIGHT)
      throw new ArkvoryError('busy', 'Too many requests to sites at once; retry shortly', {
        retryAfterSeconds: 1,
      });
    this.inFlight.set(id, running + 1);
    this.total++;
    try {
      return await send(site, key);
    } catch (error) {
      const state = failureState(error);
      if (state === 'revoked')
        throw new ArkvoryError('conflict', 'The site revoked this controller: pair it again', {
          reason: 'state_conflict',
        });
      if (state === 'refused')
        throw new ArkvoryError('forbidden', 'The site refused this request', {
          reason: 'permission_missing',
        });
      throw new ArkvoryError('unavailable', `The site could not be read: ${state}`);
    } finally {
      this.total--;
      const left = (this.inFlight.get(id) ?? 1) - 1;
      if (left > 0) this.inFlight.set(id, left);
      else this.inFlight.delete(id);
    }
  }

  /**
   * Reads every site, at most CONCURRENCY at once. One site's failure to be recorded (a removed
   * site, a database hiccup) neither ends the round early nor lets the next one overlap it: the
   * round finishes, then reports the first failure. An aborted `signal` (shutdown) ends the
   * reads in flight and takes no further site; a cancelled round reports nothing.
   */
  async pollAll(signal?: FleetAbortSignal) {
    const queue = [...(await this.sites.list())];
    const failures: unknown[] = [];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let site = queue.shift(); site && !signal?.aborted; site = queue.shift())
        await this.poll(site.id, 'fleet', signal).catch((error: unknown) => {
          // Cancelled, or removed by an administrator during the round: nothing to record.
          if (signal?.aborted || (error instanceof ArkvoryError && error.code === 'not_found'))
            return;
          failures.push(error);
        });
    });
    await Promise.all(workers);
    if (failures.length) throw failures[0];
  }

  private origin(url: unknown) {
    try {
      return this.client.origin(url);
    } catch {
      throw new ArkvoryError(
        'invalid_input',
        'A site address is https://host[:port], or http:// on loopback only',
      );
    }
  }

  /** Site failures become answers the console can explain, not internal errors. */
  private async reach<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ArkvoryError) throw error;
      const state = failureState(error);
      if (state === 'revoked')
        throw new ArkvoryError('unauthorized', 'The site refused the pairing code', {
          reason: 'credential_invalid',
        });
      throw new ArkvoryError('unavailable', `The site could not be reached: ${state}`);
    }
  }
}

/** Bytes of `text` in UTF-8; a lone surrogate counts as the three bytes of its replacement. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** The name a site reports of itself, when it is one the registry can keep. */
function siteName(topology: unknown): string | undefined {
  if (!topology || typeof topology !== 'object' || !('site' in topology)) return undefined;
  const site = topology.site;
  const name = site && typeof site === 'object' && 'name' in site ? site.name : undefined;
  return isFleetName(name) ? name : undefined;
}

/** What the console sees of a site: no key, no certificate body. */
function present(site: FleetSiteRecord) {
  return {
    id: site.id,
    name: site.name,
    url: site.url,
    fingerprint: site.pin,
    addedBy: site.addedBy,
    addedAt: site.addedAt,
    seenAt: site.seenAt,
    state: site.state,
    error: site.error,
    topology: site.topology,
  };
}
