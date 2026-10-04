import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/merge.ts';

test('mezcla plana y anidada', () => {
  assert.deepEqual(mergeConfig({ a: 1, n: { x: 1 } }, { b: 2, n: { y: 2 } }), { a: 1, b: 2, n: { x: 1, y: 2 } });
});
