import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { downloadSchedulePolicy } from '@proanima/arkvory-domain';
import { DownloadScheduler, DownloadTickets } from '@proanima/arkvory-infrastructure';

const day = 24 * 60 * 60 * 1000;
const minute = 60 * 1000;
const key = 'fleet\nartifact\nid-a';

test('a queue ticket proves when a download came and nothing else', () => {
  const tickets = new DownloadTickets(randomBytes(32));
  const now = Date.UTC(2026, 9, 14, 12);
  const ticket = tickets.issue(key, now - minute, now);
  assert.match(ticket, /^2\.[0-9a-z]+\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(tickets.read(key, ticket, now), now - minute);
  // Another download, another key, a moved time: ignored.
  assert.equal(tickets.read('fleet\nartifact\nid-b', ticket, now), undefined);
  assert.equal(new DownloadTickets(randomBytes(32)).read(key, ticket, now), undefined);
  const [, , issued, mac] = ticket.split('.');
  const earlier = `2.${(now - 3_600_000).toString(36)}.${issued}.${mac}`;
  assert.equal(tickets.read(key, earlier, now), undefined);
  const reissued = `2.${(now - minute).toString(36)}.${(now + day).toString(36)}.${mac}`;
  assert.equal(tickets.read(key, reissued, now), undefined);
  // An arrival after the issue is never signed; one slightly ahead of this clock is taken as now.
  assert.equal(tickets.read(key, tickets.issue(key, now + minute, now + minute), now), now);
  assert.equal(tickets.read(key, tickets.issue(key, now, now + 10 * minute), now), undefined);
  for (const wrong of [undefined, '', 'garbage', '2.abc.def', `${ticket}x`])
    assert.equal(tickets.read(key, wrong, now), undefined);
  // The first format is no longer read: a ticket is a hint, losing it costs a place once.
  assert.equal(tickets.read(key, `1.${now.toString(36)}.${mac}`, now), undefined);
});

test('a ticket is accepted shortly after its issue only; an old one cannot be replayed', () => {
  const tickets = new DownloadTickets(randomBytes(32));
  const now = Date.UTC(2026, 9, 14, 12);
  const ticket = tickets.issue(key, now - 2 * day, now);
  assert.equal(tickets.read(key, ticket, now + 14 * minute), now - 2 * day);
  assert.equal(tickets.read(key, ticket, now + 16 * minute), undefined);
  assert.equal(tickets.read(key, ticket, now + day), undefined);
});

test('a download waiting longer than a day keeps its arrival through re-issued tickets', (t) => {
  const secret = randomBytes(32);
  let now = 1_000_000;
  const clock = () => now;
  const wall = () => now + 1_700_000_000_000;
  const policy = downloadSchedulePolicy(1, { sessionMinBytes: 0 });
  const request = (id, ticket) => ({
    key: `fleet\nobject\n${id}`,
    principal: id,
    class: 'release',
    size: 1000,
    queueAware: true,
    ...(ticket === undefined ? {} : { ticket }),
  });
  const scheduler = new DownloadScheduler(policy, undefined, clock, wall);
  t.after(() => scheduler.close());
  scheduler.useTickets(new DownloadTickets(secret));
  assert.equal(scheduler.admit(request('holder')).state, 'active');
  const arrived = wall();
  let ticket = scheduler.admit(request('patient')).ticket;
  // Thirty hours of checking back every ten minutes; the holder's response streams meanwhile.
  for (let step = 0; step < 180; step++) {
    now += 10 * minute;
    scheduler.plan();
    const answer = scheduler.admit(request('patient', ticket));
    assert.equal(answer.state, 'queued');
    ticket = answer.ticket;
  }
  // The server restarts: the fresh ticket still carries the first arrival.
  const tickets = new DownloadTickets(secret);
  assert.equal(tickets.read(request('patient').key, ticket, wall()), arrived);
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
