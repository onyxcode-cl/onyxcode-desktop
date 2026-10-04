import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../src/index.ts';

test('on y emit', () => {
  const e = createEmitter();
  const seen: unknown[] = [];
  e.on('x', (v) => seen.push(v));
  e.emit('x', 1);
  assert.deepEqual(seen, [1]);
});
