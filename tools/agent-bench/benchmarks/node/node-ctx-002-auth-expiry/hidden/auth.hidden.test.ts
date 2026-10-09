import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, isExpired } from '../src/auth/token.ts';
import { startSession, refresh, SESSION_TTL_SEC } from '../src/auth/session.ts';

test('limite exacto expira', () => {
  const t = issueToken('u', 5_000_000, 10);
  assert.equal(isExpired(t, 5_009_999), false);
  assert.equal(isExpired(t, 5_010_000), true);
});

test('refresh usa nowMs recibido', () => {
  const s = startSession('u', 2_000_000);
  const r = refresh(s, 2_100_000);
  assert.equal(r.token.exp, 2_100 + SESSION_TTL_SEC);
});

test('refresh de sesion expirada falla', () => {
  const s = startSession('u', 2_000_000);
  assert.throws(() => refresh(s, 2_000_000 + (SESSION_TTL_SEC + 1) * 1000), /session expired/);
});
