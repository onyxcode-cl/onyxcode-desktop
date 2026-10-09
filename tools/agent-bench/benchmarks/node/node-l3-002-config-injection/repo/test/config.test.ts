import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('valores por defecto', () => {
  const c = loadConfig({});
  assert.equal(c.smtp.host, 'localhost');
  assert.equal(c.smtp.port, 25);
  assert.equal(c.api.timeoutMs, 5000);
  assert.equal(c.log.level, 'info');
});
