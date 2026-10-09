import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Users } from '../src/users.ts';
import { DuplicateUserError } from '../src/errors.ts';

test('ignora mayusculas y espacios laterales', () => {
  const u = new Users();
  u.register('ana');
  assert.throws(() => u.register('  Ana '), DuplicateUserError);
});

test('guarda el nombre recortado', () => {
  const u = new Users();
  assert.equal(u.register('  Bob  '), 'Bob');
  assert.deepEqual(u.list(), ['Bob']);
});

test('nombres distintos son validos', () => {
  const u = new Users();
  u.register('ana');
  u.register('beto');
  assert.deepEqual(u.list(), ['ana', 'beto']);
});

test('nombre invalido', () => {
  const u = new Users();
  assert.throws(() => u.register('   '), /invalid name/);
});
