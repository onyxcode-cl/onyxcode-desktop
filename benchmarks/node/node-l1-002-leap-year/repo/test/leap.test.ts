import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeapYear } from '../src/leap.ts';

test('anios comunes', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(2000), true);
});
