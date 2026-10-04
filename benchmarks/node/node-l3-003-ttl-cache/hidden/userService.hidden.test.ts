import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserService } from '../src/userService.ts';
import { NotFoundError } from '../src/errors.ts';

function setup(ttlMs: number, known = true) {
  const t = { v: 1000 };
  const calls: string[] = [];
  const repo = {
    find: async (id: string) => {
      calls.push(id);
      return known ? { id, name: 'n' + calls.length } : undefined;
    },
  };
  return { t, calls, s: new UserService(repo, { ttlMs, clock: { now: () => t.v } }) };
}

test('expira al cumplirse el TTL', async () => {
  const { t, calls, s } = setup(60000);
  await s.get('a');
  t.v += 60000 - 1;
  await s.get('a');
  assert.equal(calls.length, 1);
  t.v += 1;
  const u = await s.get('a');
  assert.equal(calls.length, 2);
  assert.equal(u.name, 'n2');
});

test('ids distintos no comparten cache', async () => {
  const { calls, s } = setup(60000);
  await s.get('a');
  await s.get('b');
  assert.deepEqual(calls, ['a', 'b']);
});

test('NotFoundError no se cachea', async () => {
  const { calls, s } = setup(60000, false);
  await assert.rejects(s.get('x'), NotFoundError);
  await assert.rejects(s.get('x'), NotFoundError);
  assert.equal(calls.length, 2);
});

test('invalidate fuerza una nueva lectura', async () => {
  const { calls, s } = setup(60000);
  await s.get('a');
  s.invalidate('a');
  await s.get('a');
  assert.equal(calls.length, 2);
});

test('sin opciones no hay cache', async () => {
  let n = 0;
  const s = new UserService({ find: async (id: string) => (n++, { id, name: 'x' }) });
  await s.get('a');
  await s.get('a');
  assert.equal(n, 2);
});
