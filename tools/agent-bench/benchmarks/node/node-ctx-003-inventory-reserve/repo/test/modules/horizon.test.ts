import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizonScore, horizonLabel, horizonClamp } from '../../src/modules/horizon/index.ts';

test('horizon: score', () => {
  assert.equal(horizonScore(3), 35);
});

test('horizon: label', () => {
  assert.equal(horizonLabel(7), 'horizon-7');
});

test('horizon: clamp', () => {
  assert.equal(horizonClamp(-5), 0);
  assert.equal(horizonClamp(100000), 121);
});
