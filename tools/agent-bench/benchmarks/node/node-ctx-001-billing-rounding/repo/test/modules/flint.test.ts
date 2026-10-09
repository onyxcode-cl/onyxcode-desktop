import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flintScore, flintLabel, flintClamp } from '../../src/modules/flint/index.ts';

test('flint: score', () => {
  assert.equal(flintScore(3), 33);
});

test('flint: label', () => {
  assert.equal(flintLabel(7), 'flint-7');
});

test('flint: clamp', () => {
  assert.equal(flintClamp(-5), 0);
  assert.equal(flintClamp(100000), 88);
});
