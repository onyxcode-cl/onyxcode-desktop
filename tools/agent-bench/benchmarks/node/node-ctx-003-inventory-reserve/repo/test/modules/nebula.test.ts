import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nebulaScore, nebulaLabel, nebulaClamp } from '../../src/modules/nebula/index.ts';

test('nebula: score', () => {
  assert.equal(nebulaScore(3), 24);
});

test('nebula: label', () => {
  assert.equal(nebulaLabel(7), 'nebula-7');
});

test('nebula: clamp', () => {
  assert.equal(nebulaClamp(-5), 0);
  assert.equal(nebulaClamp(100000), 159);
});
