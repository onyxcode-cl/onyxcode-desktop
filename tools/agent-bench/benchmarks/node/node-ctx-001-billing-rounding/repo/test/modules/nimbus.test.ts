import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nimbusScore, nimbusLabel, nimbusClamp } from '../../src/modules/nimbus/index.ts';

test('nimbus: score', () => {
  assert.equal(nimbusScore(3), 29);
});

test('nimbus: label', () => {
  assert.equal(nimbusLabel(7), 'nimbus-7');
});

test('nimbus: clamp', () => {
  assert.equal(nimbusClamp(-5), 0);
  assert.equal(nimbusClamp(100000), 156);
});
