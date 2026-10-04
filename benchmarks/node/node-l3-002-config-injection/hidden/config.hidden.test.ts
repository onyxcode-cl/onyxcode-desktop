import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createMailer } from '../src/mailer.ts';
import { createClient } from '../src/client.ts';
import { createLogger } from '../src/logger.ts';

test('validacion', () => {
  assert.throws(() => loadConfig({ SMTP_PORT: 'abc' }), /invalid SMTP_PORT/);
  assert.throws(() => loadConfig({ API_TIMEOUT_MS: '-1' }), /invalid API_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /invalid LOG_LEVEL/);
});

test('los modulos usan la configuracion recibida y no process.env', () => {
  process.env.SMTP_HOST = 'del-entorno';
  process.env.API_URL = 'http://entorno';
  process.env.LOG_LEVEL = 'error';
  try {
    const cfg = loadConfig({ SMTP_HOST: 'mx.local', SMTP_PORT: '2525', API_URL: 'http://api.local/', LOG_LEVEL: 'debug' });
    assert.equal(createMailer(cfg).describe(), 'mx.local:2525');
    const client = createClient(cfg);
    assert.equal(client.url('/v1/x'), 'http://api.local/v1/x');
    assert.equal(client.timeout, 5000);
    const log = createLogger(cfg);
    assert.equal(log.level, 'debug');
    assert.equal(log.enabled('debug'), true);
  } finally {
    delete process.env.SMTP_HOST;
    delete process.env.API_URL;
    delete process.env.LOG_LEVEL;
  }
});
