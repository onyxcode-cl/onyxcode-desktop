import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandScore, islandLabel, islandClamp } from '../../src/modules/island/index.ts';

test('island: score', () => {
  assert.equal(islandScore(3), 37);
});

test('island: label', () => {
  assert.equal(islandLabel(7), 'island-7');
});

test('island: clamp', () => {
  assert.equal(islandClamp(-5), 0);
  assert.equal(islandClamp(100000), 168);
});
