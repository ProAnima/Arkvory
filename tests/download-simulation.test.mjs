import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadSessions, downloadSchedulePolicy } from '@proanima/arkvory-domain';

const MiB = 1024 * 1024;

/** Deterministic randomness: the same run every time. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * A mass update through the real session rules. Clients behave like the SDK: they read 8 MiB
 * ranges back to back while admitted and, when queued, come back after Retry-After plus up to
 * half of it. The link is shared equally by the responses in flight; the scheduler ticks every
 * 500 ms. Times are milliseconds of simulated time.
 */
function simulate({ clients, bytesPerSecond, slots, step = 100, policy = {} }) {
  const sessions = new DownloadSessions(downloadSchedulePolicy(slots, policy));
  const next = random(7);
  const people = clients.map((client, index) => ({
    ...client,
    key: `k${String(index)}`,
    at: client.arrives ?? 0,
    offset: 0,
    range: 0,
    reading: false,
    polls: 0,
    started: undefined,
    finished: undefined,
    promised: undefined,
  }));
  let now = 0;
  let idle = 0;
  const ask = (person) => {
    const answer = sessions.request(
      {
        key: person.key,
        principal: person.principal,
        class: person.class,
        size: person.size,
        queueAware: true,
      },
      now,
    );
    if (answer.state === 'active') {
      person.started ??= now;
      person.reading = true;
      person.range = Math.min(8 * MiB, person.size - person.offset);
      return;
    }
    person.polls++;
    person.promised ??= answer.startsAt;
    const retry = Math.max(1, Math.ceil((answer.checkAt - now) / 1000)) * 1000;
    person.at = now + retry + Math.floor((next() * retry) / 2);
  };
  while (people.some((person) => person.finished === undefined)) {
    assert.ok(now < 24 * 3600 * 1000, 'the simulation never ends');
    for (const person of people)
      if (!person.reading && person.finished === undefined && now >= person.at) ask(person);
    // The step's bytes go to the responses in flight; what one does not need goes to the rest.
    let budget = (bytesPerSecond * step) / 1000;
    if (!people.some((person) => person.reading)) idle += step;
    for (let reading = people.filter((person) => person.reading); budget > 1 && reading.length;) {
      const share = budget / reading.length;
      for (const person of reading) {
        const bytes = Math.min(share, person.range);
        budget -= bytes;
        person.range -= bytes;
        person.offset += bytes;
        sessions.progress(person.key, bytes, now);
        if (person.range > 0) continue;
        person.reading = false;
        const done = person.offset >= person.size;
        sessions.end(person.key, { finished: true, reachedEnd: done }, now);
        if (done) person.finished = now;
        else ask(person);
      }
      reading = people.filter((person) => person.reading && person.range > 0);
    }
    now += step;
    if (now % 500 === 0) sessions.plan(now);
  }
  sessions.plan(now + 600_000);
  return { people, sessions, now, idle };
}

test('a mass update: everyone finishes, the first within minutes, nobody lost, places stay busy', (t) => {
  const size = 40 * MiB;
  const bytesPerSecond = 40 * MiB;
  const clients = Array.from({ length: 500 }, () => ({
    principal: 'fleet',
    class: 'release',
    size,
  }));
  const { people, sessions, now, idle } = simulate({ clients, bytesPerSecond, slots: 16 });
  t.diagnostic(`link idle ${String(idle)} ms`);
  const ideal = (500 * size * 1000) / bytesPerSecond;
  const single = (16 * size * 1000) / bytesPerSecond;
  const finishes = people.map((person) => person.finished).sort((a, b) => a - b);
  const snapshot = sessions.snapshot(now);
  assert.equal(snapshot.completed, 500);
  assert.equal(snapshot.noShows, 0);
  assert.equal(snapshot.refused, 0);
  assert.equal(sessions.idle, true);
  // The first sixteen finish after one file time, not at the end of the whole update.
  assert.ok(finishes[0] <= single * 1.2, `first at ${String(finishes[0])}`);
  // No place waits for an absent client: the link never stands still.
  assert.equal(idle, 0);
  assert.ok(
    finishes.at(-1) <= ideal * 1.02,
    `last at ${String(finishes.at(-1))} of ${String(ideal)}`,
  );
  // Estimates: a client told an expected start began close to it.
  const errors = people
    .filter((person) => person.promised !== undefined)
    .map(
      (person) => Math.abs(person.started - person.promised) / Math.max(10_000, person.promised),
    );
  const worst = Math.max(...errors);
  assert.ok(errors.length > 400 && worst < 0.3, `worst estimate error ${String(worst)}`);
  // Clients poll a bounded number of times however long they wait.
  const polls = Math.max(...people.map((person) => person.polls));
  assert.ok(polls <= 30);
  t.diagnostic(
    `first ${String(finishes[0])} ms (one file ${String(single)}), last ${String(finishes.at(-1))} ms (ideal ${String(ideal)}), worst estimate error ${worst.toFixed(3)}, most polls ${String(polls)}`,
  );
});

test('a CI build arriving during a fleet update gets the next free place', (t) => {
  const size = 40 * MiB;
  const clients = Array.from({ length: 300 }, () => ({
    principal: 'fleet',
    class: 'release',
    size,
  }));
  clients.push({ principal: 'ci', class: 'release', size, arrives: 60_000 });
  clients.push({ principal: 'ann', class: 'interactive', size, arrives: 90_000 });
  const { people } = simulate({ clients, bytesPerSecond: 40 * MiB, slots: 16 });
  const ci = people.at(-2);
  const person = people.at(-1);
  // Equal files free a place about every file time divided by the places, about a second here.
  assert.ok(ci.started - 60_000 <= 10_000, `CI waited ${String(ci.started - 60_000)} ms`);
  t.diagnostic(`CI waited ${String(ci.started - 60_000)} ms`);
  // A person takes the reserved place at once.
  assert.equal(person.started, 90_000);
});

test('bulk keeps moving next to release, background is not starved', (t) => {
  const size = 40 * MiB;
  const clients = [
    ...Array.from({ length: 100 }, () => ({ principal: 'ci', class: 'release', size })),
    ...Array.from({ length: 100 }, () => ({ principal: 'agents', class: 'bulk', size })),
    ...Array.from({ length: 20 }, () => ({ principal: 'mirror', class: 'background', size })),
  ];
  const { people } = simulate({ clients, bytesPerSecond: 40 * MiB, slots: 8 });
  const median = (group) => {
    const times = people
      .filter((person) => person.class === group)
      .map((person) => person.finished)
      .sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  };
  t.diagnostic(
    `median finish: release ${String(median('release'))}, bulk ${String(median('bulk'))}, background ${String(median('background'))} ms`,
  );
  assert.ok(median('release') < median('bulk'));
  // Background moves too: its first download ends long before the last release one.
  const first = (group) =>
    Math.min(...people.filter((person) => person.class === group).map((p) => p.finished));
  assert.ok(first('background') < Math.max(...people.map((person) => person.finished)) / 2);
  // Background still finishes: the weights give it a share, aging lifts the long waiters.
  assert.ok(people.every((person) => person.finished !== undefined));
});

test('short downloads over a fast link keep it busy: the next client is there when a place frees', (t) => {
  for (const [size, rate] of [
    [20, 125],
    [64, 125],
    [200, 125],
  ]) {
    // Sizes differ a little, as real files do.
    const clients = Array.from({ length: 400 }, (_, index) => ({
      principal: 'fleet',
      class: 'release',
      size: (size + (index % 7)) * MiB,
    }));
    const { people, idle } = simulate({ clients, bytesPerSecond: rate * MiB, slots: 16 });
    const total = clients.reduce((sum, client) => sum + client.size, 0);
    const ideal = (total * 1000) / (rate * MiB);
    const last = Math.max(...people.map((person) => person.finished));
    t.diagnostic(
      `${String(size)} MiB at ${String(rate)} MiB/s: ${String(last)} of ${String(Math.round(ideal))} ms, idle ${String(idle)} ms`,
    );
    assert.ok(last <= ideal * 1.02, `${String(size)} MiB: ${String(last)} of ${String(ideal)}`);
  }
});
