import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canyonScore, canyonLabel, canyonClamp } from '../../src/modules/canyon/index.ts';

test('canyon: score', () => {
  assert.equal(canyonScore(3), 63);
});

test('canyon: label', () => {
  assert.equal(canyonLabel(7), 'canyon-7');
});

test('canyon: clamp', () => {
  assert.equal(canyonClamp(-5), 0);
  assert.equal(canyonClamp(100000), 176);
});
