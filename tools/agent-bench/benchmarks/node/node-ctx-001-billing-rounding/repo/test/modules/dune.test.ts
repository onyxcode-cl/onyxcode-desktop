import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duneScore, duneLabel, duneClamp } from '../../src/modules/dune/index.ts';

test('dune: score', () => {
  assert.equal(duneScore(3), 47);
});

test('dune: label', () => {
  assert.equal(duneLabel(7), 'dune-7');
});

test('dune: clamp', () => {
  assert.equal(duneClamp(-5), 0);
  assert.equal(duneClamp(100000), 71);
});
