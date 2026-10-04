import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bravoScore, bravoLabel, bravoClamp } from '../../src/modules/bravo/index.ts';

test('bravo: score', () => {
  assert.equal(bravoScore(3), 56);
});

test('bravo: label', () => {
  assert.equal(bravoLabel(7), 'bravo-7');
});

test('bravo: clamp', () => {
  assert.equal(bravoClamp(-5), 0);
  assert.equal(bravoClamp(100000), 110);
});
