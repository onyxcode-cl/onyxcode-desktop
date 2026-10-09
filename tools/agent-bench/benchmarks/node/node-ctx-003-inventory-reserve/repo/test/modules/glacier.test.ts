import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glacierScore, glacierLabel, glacierClamp } from '../../src/modules/glacier/index.ts';

test('glacier: score', () => {
  assert.equal(glacierScore(3), 23);
});

test('glacier: label', () => {
  assert.equal(glacierLabel(7), 'glacier-7');
});

test('glacier: clamp', () => {
  assert.equal(glacierClamp(-5), 0);
  assert.equal(glacierClamp(100000), 104);
});
