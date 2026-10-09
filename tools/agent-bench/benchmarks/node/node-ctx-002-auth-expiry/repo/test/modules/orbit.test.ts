import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orbitScore, orbitLabel, orbitClamp } from '../../src/modules/orbit/index.ts';

test('orbit: score', () => {
  assert.equal(orbitScore(3), 56);
});

test('orbit: label', () => {
  assert.equal(orbitLabel(7), 'orbit-7');
});

test('orbit: clamp', () => {
  assert.equal(orbitClamp(-5), 0);
  assert.equal(orbitClamp(100000), 133);
});
