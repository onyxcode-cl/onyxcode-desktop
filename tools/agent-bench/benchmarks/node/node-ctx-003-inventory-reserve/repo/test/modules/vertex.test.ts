import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vertexScore, vertexLabel, vertexClamp } from '../../src/modules/vertex/index.ts';

test('vertex: score', () => {
  assert.equal(vertexScore(3), 29);
});

test('vertex: label', () => {
  assert.equal(vertexLabel(7), 'vertex-7');
});

test('vertex: clamp', () => {
  assert.equal(vertexClamp(-5), 0);
  assert.equal(vertexClamp(100000), 129);
});
