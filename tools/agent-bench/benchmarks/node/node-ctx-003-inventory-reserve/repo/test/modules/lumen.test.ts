import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lumenScore, lumenLabel, lumenClamp } from '../../src/modules/lumen/index.ts';

test('lumen: score', () => {
  assert.equal(lumenScore(3), 15);
});

test('lumen: label', () => {
  assert.equal(lumenLabel(7), 'lumen-7');
});

test('lumen: clamp', () => {
  assert.equal(lumenClamp(-5), 0);
  assert.equal(lumenClamp(100000), 107);
});
