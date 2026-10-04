import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, isExpired } from '../../src/auth/token.ts';

test('vigente y expirado', () => {
  const t = issueToken('u', 1_000_000, 60);
  assert.equal(isExpired(t, 1_030_000), false);
  assert.equal(isExpired(t, 1_061_000), true);
});
