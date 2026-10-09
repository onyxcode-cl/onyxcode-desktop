import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Users } from '../src/users.ts';
import { DuplicateUserError } from '../src/errors.ts';

test('mismo nombre exacto es duplicado', () => {
  const u = new Users();
  u.register('ana');
  assert.throws(() => u.register('ana'), DuplicateUserError);
});
