import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quartzScore, quartzLabel, quartzClamp } from '../../src/modules/quartz/index.ts';

test('quartz: score', () => {
  assert.equal(quartzScore(3), 24);
});

test('quartz: label', () => {
  assert.equal(quartzLabel(7), 'quartz-7');
});

test('quartz: clamp', () => {
  assert.equal(quartzClamp(-5), 0);
  assert.equal(quartzClamp(100000), 89);
});
