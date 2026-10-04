import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yonderScore, yonderLabel, yonderClamp } from '../../src/modules/yonder/index.ts';

test('yonder: score', () => {
  assert.equal(yonderScore(3), 37);
});

test('yonder: label', () => {
  assert.equal(yonderLabel(7), 'yonder-7');
});

test('yonder: clamp', () => {
  assert.equal(yonderClamp(-5), 0);
  assert.equal(yonderClamp(100000), 105);
});
