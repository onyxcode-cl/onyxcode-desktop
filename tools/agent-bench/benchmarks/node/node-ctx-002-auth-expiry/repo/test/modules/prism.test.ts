import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prismScore, prismLabel, prismClamp } from '../../src/modules/prism/index.ts';

test('prism: score', () => {
  assert.equal(prismScore(3), 72);
});

test('prism: label', () => {
  assert.equal(prismLabel(7), 'prism-7');
});

test('prism: clamp', () => {
  assert.equal(prismClamp(-5), 0);
  assert.equal(prismClamp(100000), 93);
});
