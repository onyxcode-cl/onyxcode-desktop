import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.ts';

const items = [
  { id: 1, name: 'Laptop', tags: ['pc'] },
  { id: 2, name: 'Mouse', tags: ['pc', 'usb'] },
];

test('sin distinguir mayusculas', () => {
  assert.deepEqual(search(items, 'LAP').map((i) => i.id), [1]);
});
