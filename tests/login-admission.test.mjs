import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LoginAdmission } from '../apps/api/dist/login-admission.js';

function exchange() {
  const raw = new EventEmitter();
  let destroyed = false;
  const request = {
    raw: {
      destroy() {
        destroyed = true;
        raw.emit('close');
      },
    },
  };
  const reply = { raw, header() {} };
  return { request, reply, destroyed: () => destroyed };
}

test('login deadline closes an incomplete body and releases its independent capacity', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new LoginAdmission();
  const pending = Array.from({ length: 16 }, exchange);
  for (const item of pending) gate.acquire(item.request, item.reply);
  const extra = exchange();
  assert.throws(() => gate.acquire(extra.request, extra.reply), { code: 'busy' });
  t.mock.timers.tick(9999);
  assert(pending.every((item) => !item.destroyed()));
  t.mock.timers.tick(1);
  assert(pending.every((item) => item.destroyed()));
  assert.doesNotThrow(() => gate.acquire(extra.request, extra.reply));
  extra.reply.raw.emit('close');
});

test('parsed login stops the body clock but keeps its slot until the response ends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new LoginAdmission();
  const pending = Array.from({ length: 16 }, exchange);
  for (const item of pending) {
    gate.acquire(item.request, item.reply);
    gate.bodyReceived(item.request);
  }
  t.mock.timers.tick(20000);
  assert(pending.every((item) => !item.destroyed()));
  const next = exchange();
  assert.throws(() => gate.acquire(next.request, next.reply), { code: 'busy' });
  pending[0].reply.raw.emit('close');
  pending[0].reply.raw.emit('close');
  gate.acquire(next.request, next.reply);
  const excess = exchange();
  assert.throws(() => gate.acquire(excess.request, excess.reply), { code: 'busy' });
  for (const item of pending.slice(1)) item.reply.raw.emit('close');
  next.reply.raw.emit('close');
});
