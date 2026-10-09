import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.ts';

const items = [
  { id: 1, name: 'Café molido', tags: ['bebida'] },
  { id: 2, name: 'Taza', tags: ['cafe', 'cocina'] },
  { id: 3, name: 'Cafetera', tags: ['cocina'] },
  { id: 4, name: 'Mesa', tags: ['hogar'] },
];

test('sin acentos y por nombre antes que por etiqueta', () => {
  assert.deepEqual(search(items, 'cafe').map((i) => i.id), [1, 3, 2]);
});

test('por etiqueta', () => {
  assert.deepEqual(search(items, 'HOGAR').map((i) => i.id), [4]);
});

test('consulta vacia', () => {
  assert.deepEqual(search(items, '   '), []);
  assert.deepEqual(search(items, ''), []);
});

test('sin resultados', () => {
  assert.deepEqual(search(items, 'zzz'), []);
});
