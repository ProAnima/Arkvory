import { createCipheriv, createHash } from 'node:crypto';
import { request } from 'node:https';
import { Readable } from 'node:stream';

/*
 * The clients of the HA stand, on the runner, through the cluster's virtual address with TLS:
 * the acknowledgment rule (ADR 0072) is judged by what a client saw. Every upload remembers
 * whether it got a 2xx; acknowledged ones must survive any failure, others may be retried.
 */

const repository = '/api/v1/repositories/releases';

/** Deterministic pseudo-random bytes (AES-CTR keystream): hashed and sent without RAM copies. */
function bytes(seed, size) {
  const key = createHash('sha256').update(seed).digest();
  const cipher = createCipheriv('aes-256-ctr', key, Buffer.alloc(16));
  const zero = Buffer.alloc(1024 * 1024);
  let left = size;
  return Readable.from(
    (function* () {
      while (left > 0) {
        const length = Math.min(left, zero.length);
        left -= length;
        yield cipher.update(zero.subarray(0, length));
      }
    })(),
  );
}

async function digest(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export function client({ host, ca, token }) {
  /** One HTTPS exchange; network failures resolve as status 0 so callers can count them. */
  function exchange(method, path, { body, headers = {}, timeoutMs = 30000, sink } = {}) {
    return new Promise((done) => {
      const call = request(
        {
          host,
          port: 8080,
          method,
          path,
          ca,
          headers: { authorization: `Bearer ${token}`, ...headers },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks = [];
          const consume = sink ? sink(response) : null;
          if (!consume) response.on('data', (chunk) => chunks.push(chunk));
          const finish = async () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {}
            done({
              status: response.statusCode ?? 0,
              json,
              text,
              value: consume ? await consume : null,
            });
          };
          response.on('end', () => void finish());
          response.on('error', (error) => done({ status: 0, error: error.message }));
        },
      );
      call.on('timeout', () => call.destroy(new Error('timeout')));
      call.on('error', (error) => done({ status: 0, error: error.message }));
      if (body instanceof Readable) body.pipe(call);
      else call.end(body);
    });
  }

  const json = (value) => ({
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' },
  });

  async function create(item) {
    const created = json({
      name: item.name,
      size: String(item.size),
      sha256: item.sha256,
      labels: ['ha-stand'],
      metadata: {},
    });
    return exchange('POST', `${repository}/uploads`, {
      ...created,
      headers: { ...created.headers, 'idempotency-key': item.key },
    });
  }

  /**
   * Creates and sends an upload, or (for an item tried before) confirms it: the same
   * idempotency key returns the session, and a write answered 2xx is an acknowledgment.
   */
  async function upload(item, onSent = () => {}) {
    item.sha256 ??= await digest(bytes(item.name, item.size));
    const created = await create(item);
    if (created.status !== 201) return settle(item, created);
    item.id = created.json.id;
    if (created.json.status === 'available') return settle(item, created);
    const body = bytes(item.name, item.size);
    let sent = 0;
    body.on('data', (chunk) => {
      sent += chunk.length;
      onSent(sent);
    });
    const content = await exchange('PUT', `${repository}/uploads/${item.id}/content`, {
      body,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(item.size) },
      timeoutMs: 15 * 60000,
    });
    return settle(item, content);
  }

  function settle(item, response) {
    item.acknowledged =
      response.status >= 200 && response.status < 300 && response.json?.status === 'available';
    item.last = {
      status: response.status,
      reason: response.json?.reason ?? response.error ?? null,
    };
    return item;
  }

  return {
    exchange,
    upload,
    /** Readiness through the virtual address: 200 means some node serves reads. */
    ready: () => exchange('GET', '/health/ready', { timeoutMs: 5000 }),
    canWrite: async () => {
      const probe = { name: `probe-${String(Date.now())}`, size: 1, key: crypto.randomUUID() };
      probe.sha256 = await digest(bytes(probe.name, 1));
      const response = await create(probe);
      return { status: response.status, reason: response.json?.reason ?? response.error ?? null };
    },
    /** The artifact's bytes hash as they come back from the active node. */
    async read(item) {
      const response = await exchange('GET', `${repository}/artifacts/${item.id}/content`, {
        timeoutMs: 15 * 60000,
        sink: (stream) => digest(stream),
      });
      return { status: response.status, sha256: response.value };
    },
    metrics: () => exchange('GET', '/health/metrics', { timeoutMs: 5000 }),
  };
}

/**
 * Small uploads in a loop until stopped, as CI agents would publish during a failure. Every
 * item keeps whether it was acknowledged; the stand later reads all acknowledged ones back.
 */
export function writer(api, label, { concurrency = 4 } = {}) {
  const items = [];
  let running = true;
  let sequence = 0;
  const loop = async () => {
    while (running) {
      const item = {
        name: `${label}-${String(sequence++)}.bin`,
        size: 64 * 1024 + ((sequence * 7919) % (960 * 1024)),
        key: crypto.randomUUID(),
      };
      items.push(item);
      await api.upload(item);
      // A steady stream (about 2 MB/s in all), not a flood the returning copy must catch up with.
      await new Promise((resolve) => setTimeout(resolve, item.acknowledged ? 250 : 500));
    }
  };
  const loops = Array.from({ length: concurrency }, loop);
  return {
    items,
    async stop() {
      running = false;
      await Promise.all(loops);
      return items;
    },
  };
}

export const bigItem = (label, size) => ({ name: `${label}.bin`, size, key: crypto.randomUUID() });
