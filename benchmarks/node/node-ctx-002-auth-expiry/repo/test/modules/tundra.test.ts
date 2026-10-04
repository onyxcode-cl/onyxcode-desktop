import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tundraScore, tundraLabel, tundraClamp } from '../../src/modules/tundra/index.ts';

test('tundra: score', () => {
  assert.equal(tundraScore(3), 33);
});

test('tundra: label', () => {
  assert.equal(tundraLabel(7), 'tundra-7');
});

test('tundra: clamp', () => {
  assert.equal(tundraClamp(-5), 0);
  assert.equal(tundraClamp(100000), 183);
});
