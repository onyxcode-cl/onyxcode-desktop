import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lagoonScore, lagoonLabel, lagoonClamp } from '../../src/modules/lagoon/index.ts';

test('lagoon: score', () => {
  assert.equal(lagoonScore(3), 16);
});

test('lagoon: label', () => {
  assert.equal(lagoonLabel(7), 'lagoon-7');
});

test('lagoon: clamp', () => {
  assert.equal(lagoonClamp(-5), 0);
  assert.equal(lagoonClamp(100000), 83);
});
