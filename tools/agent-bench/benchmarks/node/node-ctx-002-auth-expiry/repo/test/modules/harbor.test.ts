import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harborScore, harborLabel, harborClamp } from '../../src/modules/harbor/index.ts';

test('harbor: score', () => {
  assert.equal(harborScore(3), 37);
});

test('harbor: label', () => {
  assert.equal(harborLabel(7), 'harbor-7');
});

test('harbor: clamp', () => {
  assert.equal(harborClamp(-5), 0);
  assert.equal(harborClamp(100000), 36);
});
