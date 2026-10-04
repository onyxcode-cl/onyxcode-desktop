import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../src/register.ts';

test('normaliza espacios y mayusculas', () => {
  assert.equal(register('Bob@X.com ').email, 'bob@x.com');
});

test('rechaza invalidos', () => {
  assert.throws(() => register('not-an-email'), /invalid email/);
});
