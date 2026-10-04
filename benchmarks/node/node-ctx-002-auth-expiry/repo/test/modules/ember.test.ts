import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emberScore, emberLabel, emberClamp } from '../../src/modules/ember/index.ts';

test('ember: score', () => {
  assert.equal(emberScore(3), 51);
});

test('ember: label', () => {
  assert.equal(emberLabel(7), 'ember-7');
});

test('ember: clamp', () => {
  assert.equal(emberClamp(-5), 0);
  assert.equal(emberClamp(100000), 108);
});
