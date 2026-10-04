import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alphaScore, alphaLabel, alphaClamp } from '../../src/modules/alpha/index.ts';

test('alpha: score', () => {
  assert.equal(alphaScore(3), 43);
});

test('alpha: label', () => {
  assert.equal(alphaLabel(7), 'alpha-7');
});

test('alpha: clamp', () => {
  assert.equal(alphaClamp(-5), 0);
  assert.equal(alphaClamp(100000), 134);
});
