import test from 'node:test';
import assert from 'node:assert/strict';
import { readDownloadQueue } from '../apps/api/dist/download-config.js';

const limits = { maxDownloads: 16, perPrincipal: 4, holdSeconds: 20, gateways: false };

test('without settings the download queue takes the safe defaults', () => {
  const { downloadQueue, downloadHoldSeconds } = readDownloadQueue({}, limits);
  assert.deepEqual(downloadQueue, {
    strategy: 'ordered',
    slots: 16,
    weights: { interactive: 8, release: 4, bulk: 2, background: 1 },
    interactiveReserve: 1,
    perPrincipalActive: 4,
    maxSessions: 65536,
    maxSessionsPerPrincipal: 4096,
    idleMs: 30000,
    agingMs: 900000,
    preempt: true,
    rangesPerSession: 4,
    sessionMinBytes: 16777216,
  });
  assert.equal(downloadHoldSeconds, 20);
  // Read gateways queue per process: until the shared queue, admission per request.
  assert.equal(
    readDownloadQueue({}, { ...limits, gateways: true }).downloadQueue.strategy,
    'shared',
  );
  assert.equal(
    readDownloadQueue({ ARKVORY_DOWNLOAD_STRATEGY: 'ordered' }, { ...limits, gateways: true })
      .downloadQueue.strategy,
    'ordered',
  );
});

test('every setting of the download queue can be changed', () => {
  const { downloadQueue, downloadHoldSeconds } = readDownloadQueue(
    {
      ARKVORY_DOWNLOAD_STRATEGY: 'smallest-first',
      ARKVORY_MAX_DOWNLOAD_SESSIONS: '32',
      ARKVORY_DOWNLOAD_RESERVE: '4',
      ARKVORY_DOWNLOAD_WEIGHTS: 'bulk=3',
      ARKVORY_DOWNLOAD_SESSION_MIN_BYTES: '0',
      ARKVORY_DOWNLOAD_IDLE_SECONDS: '120',
      ARKVORY_DOWNLOAD_AGING_MINUTES: '0',
      ARKVORY_DOWNLOAD_PREEMPT: 'false',
      ARKVORY_DOWNLOAD_RANGES_PER_SESSION: '8',
      ARKVORY_DOWNLOAD_QUEUE_LIMIT: '1000',
      ARKVORY_DOWNLOAD_QUEUE_PER_PRINCIPAL: '500',
      ARKVORY_DOWNLOAD_HOLD_SECONDS: '0',
    },
    limits,
  );
  assert.deepEqual(downloadQueue, {
    strategy: 'smallest-first',
    slots: 32,
    weights: { interactive: 8, release: 4, bulk: 3, background: 1 },
    interactiveReserve: 4,
    perPrincipalActive: 4,
    maxSessions: 1000,
    maxSessionsPerPrincipal: 500,
    idleMs: 120000,
    agingMs: 0,
    preempt: false,
    rangesPerSession: 8,
    sessionMinBytes: 0,
  });
  assert.equal(downloadHoldSeconds, 0);
  // A share above the sessions is the sessions.
  assert.equal(
    readDownloadQueue({ ARKVORY_MAX_DOWNLOAD_SESSIONS: '2' }, limits).downloadQueue
      .perPrincipalActive,
    2,
  );
  // Three places or fewer leave no reserve by default.
  assert.equal(
    readDownloadQueue({ ARKVORY_MAX_DOWNLOAD_SESSIONS: '3' }, limits).downloadQueue
      .interactiveReserve,
    0,
  );
});

test('a wrong value stops the start and names its variable', () => {
  for (const [name, value] of [
    ['ARKVORY_DOWNLOAD_STRATEGY', 'fastest'],
    ['ARKVORY_MAX_DOWNLOAD_SESSIONS', '0'],
    ['ARKVORY_DOWNLOAD_RESERVE', '16'],
    ['ARKVORY_DOWNLOAD_WEIGHTS', 'bulk=0'],
    ['ARKVORY_DOWNLOAD_SESSION_MIN_BYTES', '-1'],
    ['ARKVORY_DOWNLOAD_IDLE_SECONDS', '0'],
    ['ARKVORY_DOWNLOAD_AGING_MINUTES', 'soon'],
    ['ARKVORY_DOWNLOAD_PREEMPT', 'yes'],
    ['ARKVORY_DOWNLOAD_RANGES_PER_SESSION', '65'],
    ['ARKVORY_DOWNLOAD_QUEUE_PER_PRINCIPAL', '70000'],
    ['ARKVORY_DOWNLOAD_HOLD_SECONDS', '121'],
  ])
    assert.throws(() => readDownloadQueue({ [name]: value }, limits), {
      message: new RegExp(name),
    });
});
