import { test } from 'node:test';
import assert from 'node:assert/strict';
import { junctionScore, junctionLabel, junctionClamp } from '../../src/modules/junction/index.ts';

test('junction: score', () => {
  assert.equal(junctionScore(3), 42);
});

test('junction: label', () => {
  assert.equal(junctionLabel(7), 'junction-7');
});

test('junction: clamp', () => {
  assert.equal(junctionClamp(-5), 0);
  assert.equal(junctionClamp(100000), 186);
});
