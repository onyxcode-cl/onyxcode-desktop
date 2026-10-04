import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zenithScore, zenithLabel, zenithClamp } from '../../src/modules/zenith/index.ts';

test('zenith: score', () => {
  assert.equal(zenithScore(3), 34);
});

test('zenith: label', () => {
  assert.equal(zenithLabel(7), 'zenith-7');
});

test('zenith: clamp', () => {
  assert.equal(zenithClamp(-5), 0);
  assert.equal(zenithClamp(100000), 101);
});
