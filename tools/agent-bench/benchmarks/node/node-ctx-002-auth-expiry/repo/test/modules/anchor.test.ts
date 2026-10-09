import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorScore, anchorLabel, anchorClamp } from '../../src/modules/anchor/index.ts';

test('anchor: score', () => {
  assert.equal(anchorScore(3), 19);
});

test('anchor: label', () => {
  assert.equal(anchorLabel(7), 'anchor-7');
});

test('anchor: clamp', () => {
  assert.equal(anchorClamp(-5), 0);
  assert.equal(anchorClamp(100000), 106);
});
