import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSlice } from '../src/paginate.ts';

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

test('primera pagina', () => {
  assert.deepEqual(pageSlice(items, 1, 4), items.slice(0, 4));
});
