import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.ts';

test('espacios multiples y bordes', () => {
  assert.equal(slugify('  Many   spaces  '), 'many-spaces');
  assert.equal(slugify('a--b'), 'a-b');
});

test('acentos', () => {
  assert.equal(slugify('Ñandú rápido'), 'nandu-rapido');
});
