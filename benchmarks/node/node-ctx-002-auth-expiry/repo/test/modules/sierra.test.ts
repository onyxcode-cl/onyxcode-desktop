import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sierraScore, sierraLabel, sierraClamp } from '../../src/modules/sierra/index.ts';

test('sierra: score', () => {
  assert.equal(sierraScore(3), 62);
});

test('sierra: label', () => {
  assert.equal(sierraLabel(7), 'sierra-7');
});

test('sierra: clamp', () => {
  assert.equal(sierraClamp(-5), 0);
  assert.equal(sierraClamp(100000), 155);
});
