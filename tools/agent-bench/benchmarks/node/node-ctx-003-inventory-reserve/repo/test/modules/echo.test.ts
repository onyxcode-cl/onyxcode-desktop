import { test } from 'node:test';
import assert from 'node:assert/strict';
import { echoScore, echoLabel, echoClamp } from '../../src/modules/echo/index.ts';

test('echo: score', () => {
  assert.equal(echoScore(3), 66);
});

test('echo: label', () => {
  assert.equal(echoLabel(7), 'echo-7');
});

test('echo: clamp', () => {
  assert.equal(echoClamp(-5), 0);
  assert.equal(echoClamp(100000), 92);
});
