import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserService } from '../src/userService.ts';

test('cache dentro del TTL', async () => {
  let calls = 0;
  const repo = { find: async (id: string) => (calls++, { id, name: 'n' }) };
  const t = { v: 0 };
  const s = new UserService(repo, { ttlMs: 60000, clock: { now: () => t.v } });
  await s.get('a');
  await s.get('a');
  assert.equal(calls, 1);
});
