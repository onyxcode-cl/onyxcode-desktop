import { test } from 'node:test';
import assert from 'node:assert/strict';
import { willowScore, willowLabel, willowClamp } from '../../src/modules/willow/index.ts';

test('willow: score', () => {
  assert.equal(willowScore(3), 13);
});

test('willow: label', () => {
  assert.equal(willowLabel(7), 'willow-7');
});

test('willow: clamp', () => {
  assert.equal(willowClamp(-5), 0);
  assert.equal(willowClamp(100000), 98);
});
