import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meadowScore, meadowLabel, meadowClamp } from '../../src/modules/meadow/index.ts';

test('meadow: score', () => {
  assert.equal(meadowScore(3), 14);
});

test('meadow: label', () => {
  assert.equal(meadowLabel(7), 'meadow-7');
});

test('meadow: clamp', () => {
  assert.equal(meadowClamp(-5), 0);
  assert.equal(meadowClamp(100000), 133);
});
