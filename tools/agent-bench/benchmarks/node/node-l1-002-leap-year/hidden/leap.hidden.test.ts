import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeapYear } from '../src/leap.ts';

test('siglos no bisiestos', () => {
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2100), false);
});

test('multiplos de 400', () => {
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2400), true);
});
