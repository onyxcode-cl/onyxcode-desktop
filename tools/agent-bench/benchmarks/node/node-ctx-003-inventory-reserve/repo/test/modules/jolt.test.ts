import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joltScore, joltLabel, joltClamp } from '../../src/modules/jolt/index.ts';

test('jolt: score', () => {
  assert.equal(joltScore(3), 35);
});

test('jolt: label', () => {
  assert.equal(joltLabel(7), 'jolt-7');
});

test('jolt: clamp', () => {
  assert.equal(joltClamp(-5), 0);
  assert.equal(joltClamp(100000), 162);
});
