import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gammaScore, gammaLabel, gammaClamp } from '../../src/modules/gamma/index.ts';

test('gamma: score', () => {
  assert.equal(gammaScore(3), 48);
});

test('gamma: label', () => {
  assert.equal(gammaLabel(7), 'gamma-7');
});

test('gamma: clamp', () => {
  assert.equal(gammaClamp(-5), 0);
  assert.equal(gammaClamp(100000), 192);
});
