import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoScore, cargoLabel, cargoClamp } from '../../src/modules/cargo/index.ts';

test('cargo: score', () => {
  assert.equal(cargoScore(3), 24);
});

test('cargo: label', () => {
  assert.equal(cargoLabel(7), 'cargo-7');
});

test('cargo: clamp', () => {
  assert.equal(cargoClamp(-5), 0);
  assert.equal(cargoClamp(100000), 96);
});
