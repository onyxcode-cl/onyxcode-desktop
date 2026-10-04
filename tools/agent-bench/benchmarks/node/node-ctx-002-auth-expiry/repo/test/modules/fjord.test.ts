import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fjordScore, fjordLabel, fjordClamp } from '../../src/modules/fjord/index.ts';

test('fjord: score', () => {
  assert.equal(fjordScore(3), 50);
});

test('fjord: label', () => {
  assert.equal(fjordLabel(7), 'fjord-7');
});

test('fjord: clamp', () => {
  assert.equal(fjordClamp(-5), 0);
  assert.equal(fjordClamp(100000), 43);
});
