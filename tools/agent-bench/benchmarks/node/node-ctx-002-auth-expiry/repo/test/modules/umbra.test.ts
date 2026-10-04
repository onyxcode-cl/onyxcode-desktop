import { test } from 'node:test';
import assert from 'node:assert/strict';
import { umbraScore, umbraLabel, umbraClamp } from '../../src/modules/umbra/index.ts';

test('umbra: score', () => {
  assert.equal(umbraScore(3), 18);
});

test('umbra: label', () => {
  assert.equal(umbraLabel(7), 'umbra-7');
});

test('umbra: clamp', () => {
  assert.equal(umbraClamp(-5), 0);
  assert.equal(umbraClamp(100000), 37);
});
