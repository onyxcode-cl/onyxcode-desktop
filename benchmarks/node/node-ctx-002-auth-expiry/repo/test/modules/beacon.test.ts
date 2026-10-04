import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beaconScore, beaconLabel, beaconClamp } from '../../src/modules/beacon/index.ts';

test('beacon: score', () => {
  assert.equal(beaconScore(3), 35);
});

test('beacon: label', () => {
  assert.equal(beaconLabel(7), 'beacon-7');
});

test('beacon: clamp', () => {
  assert.equal(beaconClamp(-5), 0);
  assert.equal(beaconClamp(100000), 143);
});
