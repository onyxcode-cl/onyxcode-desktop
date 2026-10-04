import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSlice } from '../src/paginate.ts';

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

test('segunda pagina', () => {
  assert.deepEqual(pageSlice(items, 2, 4), items.slice(4, 8));
});

test('ultima pagina parcial', () => {
  assert.deepEqual(pageSlice(items, 4, 3), ['j']);
});

test('fuera de rango', () => {
  assert.deepEqual(pageSlice(items, 0, 4), []);
  assert.deepEqual(pageSlice(items, 99, 4), []);
});
