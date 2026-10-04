import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiteScore, kiteLabel, kiteClamp } from '../../src/modules/kite/index.ts';

test('kite: score', () => {
  assert.equal(kiteScore(3), 47);
});

test('kite: label', () => {
  assert.equal(kiteLabel(7), 'kite-7');
});

test('kite: clamp', () => {
  assert.equal(kiteClamp(-5), 0);
  assert.equal(kiteClamp(100000), 36);
});
