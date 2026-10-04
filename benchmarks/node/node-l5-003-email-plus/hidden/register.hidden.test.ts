import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../src/register.ts';

test('conserva el +', () => {
  assert.equal(register('bob+news@x.com').email, 'bob+news@x.com');
  assert.equal(register('  Bob+News@X.com').email, 'bob+news@x.com');
});

test('sigue rechazando invalidos', () => {
  assert.throws(() => register('a b@x.com'), /invalid email/);
  assert.throws(() => register('bob@'), /invalid email/);
});
