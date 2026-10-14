import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { downloadSchedulePolicy } from '@proanima/arkvory-domain';
import { DownloadScheduler, DownloadTickets } from '@proanima/arkvory-infrastructure';

const day = 24 * 60 * 60 * 1000;

test('a queue ticket proves when a download came and nothing else', () => {
  const tickets = new DownloadTickets(randomBytes(32));
  const now = Date.UTC(2026, 9, 14, 12);
  const ticket = tickets.issue('fleet\nartifact\nid-a', now - 60_000);
  assert.match(ticket, /^1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(tickets.read('fleet\nartifact\nid-a', ticket, now), now - 60_000);
  // Another download, another key, a moved time, an old or a future ticket: ignored.
  assert.equal(tickets.read('fleet\nartifact\nid-b', ticket, now), undefined);
  assert.equal(
    new DownloadTickets(randomBytes(32)).read('fleet\nartifact\nid-a', ticket, now),
    undefined,
  );
  const [, , mac] = ticket.split('.');
  const earlier = `1.${(now - 3_600_000).toString(36)}.${mac}`;
  assert.equal(tickets.read('fleet\nartifact\nid-a', earlier, now), undefined);
  assert.equal(tickets.read('fleet\nartifact\nid-a', ticket, now + day), undefined);
  const future = tickets.issue('k', now + 60_000);
  assert.equal(tickets.read('k', future, now), undefined);
  for (const wrong of [undefined, '', 'garbage', '2.abc.def', `${ticket}x`])
    assert.equal(tickets.read('fleet\nartifact\nid-a', wrong, now), undefined);
});

test('after a restart a download with its ticket takes its old turn', (t) => {
  const secret = randomBytes(32);
  let now = 1_000_000;
  const clock = () => now;
  const wall = () => now + 1_700_000_000_000;
  const policy = downloadSchedulePolicy(1, { sessionMinBytes: 0 });
  const request = (id) => ({
    key: `fleet\nobject\n${id}`,
    principal: 'fleet',
    class: 'release',
    size: 1000,
    queueAware: true,
  });
  const before = new DownloadScheduler(policy, undefined, clock, wall);
  t.after(() => before.close());
  before.useTickets(new DownloadTickets(secret));
  const holder = before.admit(request('holder'));
  assert.equal(holder.state, 'active');
  const early = before.admit(request('early'));
  assert.equal(early.state, 'queued');
  assert.ok(early.ticket);
  // The server restarts. Another client is first to ask the new process.
  now += 30_000;
  const after = new DownloadScheduler(policy, undefined, clock, wall);
  t.after(() => after.close());
  after.useTickets(new DownloadTickets(secret));
  assert.equal(after.admit(request('holder')).state, 'active');
  assert.equal(after.admit(request('late')).state, 'queued');
  // The early one comes back with its ticket and is ahead of the late one.
  assert.equal(after.admit({ ...request('early'), ticket: early.ticket }).state, 'queued');
  after.plan();
  assert.equal(after.admit({ ...request('early'), ticket: early.ticket }).position, 1);
  assert.equal(after.admit(request('late')).position, 2);
  // Without tickets on, none is issued and none is read.
  const plain = new DownloadScheduler(policy, undefined, clock, wall);
  t.after(() => plain.close());
  assert.equal(plain.admit(request('x')).ticket, undefined);
});
