import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xenonScore, xenonLabel, xenonClamp } from '../../src/modules/xenon/index.ts';

test('xenon: score', () => {
  assert.equal(xenonScore(3), 71);
});

test('xenon: label', () => {
  assert.equal(xenonLabel(7), 'xenon-7');
});

test('xenon: clamp', () => {
  assert.equal(xenonClamp(-5), 0);
  assert.equal(xenonClamp(100000), 105);
});
