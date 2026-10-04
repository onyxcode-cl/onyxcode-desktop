import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ridgeScore, ridgeLabel, ridgeClamp } from '../../src/modules/ridge/index.ts';

test('ridge: score', () => {
  assert.equal(ridgeScore(3), 24);
});

test('ridge: label', () => {
  assert.equal(ridgeLabel(7), 'ridge-7');
});

test('ridge: clamp', () => {
  assert.equal(ridgeClamp(-5), 0);
  assert.equal(ridgeClamp(100000), 164);
});
