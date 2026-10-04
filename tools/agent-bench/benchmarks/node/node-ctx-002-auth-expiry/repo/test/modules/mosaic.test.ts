import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaicScore, mosaicLabel, mosaicClamp } from '../../src/modules/mosaic/index.ts';

test('mosaic: score', () => {
  assert.equal(mosaicScore(3), 27);
});

test('mosaic: label', () => {
  assert.equal(mosaicLabel(7), 'mosaic-7');
});

test('mosaic: clamp', () => {
  assert.equal(mosaicClamp(-5), 0);
  assert.equal(mosaicClamp(100000), 180);
});
