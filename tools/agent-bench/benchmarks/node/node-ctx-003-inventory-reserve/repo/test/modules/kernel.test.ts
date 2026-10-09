import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelScore, kernelLabel, kernelClamp } from '../../src/modules/kernel/index.ts';

test('kernel: score', () => {
  assert.equal(kernelScore(3), 61);
});

test('kernel: label', () => {
  assert.equal(kernelLabel(7), 'kernel-7');
});

test('kernel: clamp', () => {
  assert.equal(kernelClamp(-5), 0);
  assert.equal(kernelClamp(100000), 83);
});
