import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { DAY, iso, newId, seal } from '../licence-fixtures.mjs';

/**
 * A stand-in for the hub's licensing (pas-Hub README, "Licences"; protocol.rs): activate,
 * refresh with secret rotation, the one retry of a lost answer, clone suspension, lapse and
 * restore, revocation statements, deactivate and the revocation list. Real HTTP on loopback;
 * documents signed by the test authority. Every request is recorded for assertions.
 */
export async function licenceHubStub(authority, options = {}) {
  const requests = [];
  const licences = new Map();
  const activations = new Map();
  const retired = new Set();
  const hub = {
    requests,
    licences,
    activations,
    /** Replies to the next call instead of the protocol: `{status, body}` or `'drop'`. */
    next: [],
    revocationList: null,
    issuedAtMs: () => Date.now(),
    licence(key, fields = {}) {
      const licence = {
        key,
        licenceId: newId('lic'),
        type: 'standard',
        features: ['dedup', 'delta'],
        max: 1,
        state: 'active',
        offlineDays: 30,
        graceDays: 30,
        notAfter: Date.now() + 365 * DAY,
        ...fields,
      };
      licences.set(key, licence);
      return licence;
    },
  };
  const token = (licence, activation, nonce) => {
    const issued = Math.max(hub.issuedAtMs(), activation.lastIssued);
    activation.lastIssued = issued;
    let notAfter = issued + licence.offlineDays * DAY;
    if (licence.notAfter !== null)
      notAfter = Math.min(notAfter, licence.notAfter + licence.graceDays * DAY);
    return authority.token({
      issuedAtMs: issued,
      licenceId: licence.licenceId,
      activationId: activation.id,
      installation: activation.install,
      type: licence.type,
      features: licence.features,
      refreshAfter: iso(Math.min(issued + DAY, notAfter)),
      notAfter: iso(notAfter),
      licenceNotAfter: licence.notAfter === null ? null : iso(licence.notAfter),
      graceDays: licence.graceDays,
      seq: activation.seq,
      nonce,
    });
  };
  const revocation = (licence, activation, reason, nonce) =>
    authority.revocation({
      licenceId: licence.licenceId,
      activationId: activation.id,
      installation: activation.install,
      reason,
      revokedAt: iso(Date.now()),
      issuedAt: iso(Math.max(Date.now(), activation.lastIssued)),
      seq: activation.seq + 1,
      nonce,
    });
  const secret = () => randomBytes(32).toString('base64url');
  const refuse = (status, code) => ({ status, body: { code, message: code, details: {} } });
  const taken = (licence) =>
    [...activations.values()].filter((a) => a.licence === licence && a.state === 'active').length;

  function activate(body) {
    const licence = licences.get(body.key);
    if (!licence) return refuse(403, 'licence_key_invalid');
    if (licence.state !== 'active') return refuse(403, 'licence_not_active');
    let activation = [...activations.values()].find(
      (a) => a.licence === licence && a.install === body.installId,
    );
    if (activation?.state === 'revoked') return refuse(403, 'activation_revoked');
    if (!activation) {
      if (taken(licence) >= licence.max) return refuse(409, 'activation_limit_reached');
      activation = {
        id: newId('act'),
        licence,
        install: body.installId,
        seq: 0,
        lastIssued: 0,
        state: 'active',
      };
      activations.set(activation.id, activation);
    } else if (activation.secret) retired.add(activation.secret);
    activation.seq += activation.state === 'released' ? 2 : 1;
    activation.state = 'active';
    activation.secret = secret();
    activation.prev = null;
    return {
      status: 200,
      body: {
        token: token(licence, activation, body.nonce),
        activationSecret: activation.secret,
        activationId: activation.id,
      },
    };
  }

  function refresh(body) {
    const activation = activations.get(body.activationId);
    if (!activation) return refuse(404, 'activation_unknown');
    const licence = activation.licence;
    const current = body.activationSecret === activation.secret;
    const retry =
      !current &&
      activation.prev?.secret === body.activationSecret &&
      activation.prev.until >= Date.now() &&
      activation.prev.nonce === body.nonce &&
      body.seq === activation.seq - 1;
    if (!current && !retry) {
      if (activation.prev?.secret === body.activationSecret || retired.has(body.activationSecret)) {
        if (activation.state === 'active') activation.state = 'suspended';
        return refuse(409, 'activation_secret_reused');
      }
      return refuse(404, 'activation_unknown');
    }
    if (licence.state === 'revoked')
      return {
        status: 200,
        body: { revocation: revocation(licence, activation, 'licence_revoked', body.nonce) },
      };
    if (activation.state === 'revoked')
      return {
        status: 200,
        body: { revocation: revocation(licence, activation, 'activation_revoked', body.nonce) },
      };
    if (activation.state === 'suspended') return refuse(403, 'activation_suspended');
    if (!retry && body.seq !== activation.seq) return refuse(400, 'licence_request_invalid');
    if (activation.state === 'lapsed') {
      if (taken(licence) >= licence.max) return refuse(409, 'activation_lapsed');
      activation.state = 'active';
    }
    retired.add(activation.secret);
    activation.prev = retry
      ? null
      : { secret: activation.secret, nonce: body.nonce, until: Date.now() + 600_000 };
    activation.seq += 1;
    activation.secret = secret();
    return {
      status: 200,
      body: {
        token: token(licence, activation, body.nonce),
        activationSecret: activation.secret,
        activationId: activation.id,
      },
    };
  }

  function deactivate(body) {
    const activation = activations.get(body.activationId);
    if (!activation || activation.secret !== body.activationSecret)
      return refuse(404, 'activation_unknown');
    activation.state = 'released';
    return { status: 204, body: null };
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url, 'http://hub');
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : null;
      requests.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        body,
        headers: request.headers,
      });
      const scripted = hub.next.shift();
      if (scripted === 'drop') {
        // The hub did the work but the answer is lost on the way back.
        const route = url.pathname.split('/').pop();
        if (route === 'refresh') refresh(body);
        if (route === 'activate') activate(body);
        request.socket.destroy();
        return;
      }
      let answer = scripted;
      if (!answer) {
        const route = url.pathname.split('/').pop();
        if (url.pathname.startsWith('/v1/arkvory/licence/') && request.method === 'POST')
          answer =
            route === 'activate'
              ? activate(body)
              : route === 'refresh'
                ? refresh(body)
                : route === 'deactivate'
                  ? deactivate(body)
                  : refuse(404, 'not_found');
        else if (route === 'revocations')
          answer = hub.revocationList
            ? { status: 200, raw: hub.revocationList }
            : { status: 204, body: null };
        else answer = refuse(404, 'not_found');
      }
      response.writeHead(answer.status, {
        'content-type': 'application/json',
        ...(answer.headers ?? {}),
      });
      response.end(answer.raw ?? (answer.body === null ? '' : JSON.stringify(answer.body)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  hub.url = `http://127.0.0.1:${server.address().port}`;
  hub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return hub;
}
