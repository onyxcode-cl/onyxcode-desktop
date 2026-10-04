import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ivoryScore, ivoryLabel, ivoryClamp } from '../../src/modules/ivory/index.ts';

test('ivory: score', () => {
  assert.equal(ivoryScore(3), 23);
});

test('ivory: label', () => {
  assert.equal(ivoryLabel(7), 'ivory-7');
});

test('ivory: clamp', () => {
  assert.equal(ivoryClamp(-5), 0);
  assert.equal(ivoryClamp(100000), 179);
});
