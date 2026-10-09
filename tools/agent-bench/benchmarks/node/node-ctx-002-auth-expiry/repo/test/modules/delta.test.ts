import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaScore, deltaLabel, deltaClamp } from '../../src/modules/delta/index.ts';

test('delta: score', () => {
  assert.equal(deltaScore(3), 19);
});

test('delta: label', () => {
  assert.equal(deltaLabel(7), 'delta-7');
});

test('delta: clamp', () => {
  assert.equal(deltaClamp(-5), 0);
  assert.equal(deltaClamp(100000), 88);
});
