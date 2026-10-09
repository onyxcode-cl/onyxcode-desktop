import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/csv.ts';

test('campo con coma entre comillas', () => {
  assert.deepEqual(parseLine('a,"b,c",d'), ['a', 'b,c', 'd']);
});
