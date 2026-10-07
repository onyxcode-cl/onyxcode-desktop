import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgs } from './pin.mjs'

test('parseArgs: versión, plataforma y sujeto Authenticode', () => {
  const a = parseArgs(['2026.9.3', '--network', '--platform', 'win32-x64', '--authenticode-subject', 'CN=Cloudflare, Inc.', '--write'])
  assert.equal(a.version, '2026.9.3')
  assert.deepEqual(a.targets, ['win32-x64'])
  assert.equal(a.authenticodeSubject, 'CN=Cloudflare, Inc.')
  assert.ok(a.flags.has('--network') && a.flags.has('--write'))
})

test('parseArgs: sin --platform deja el valor por defecto de la biblioteca', () => {
  assert.equal(parseArgs(['2026.9.3', '--network']).targets, undefined)
})

test('parseArgs: opción sin valor falla', () => {
  assert.throws(() => parseArgs(['2026.9.3', '--platform']), /valor/)
  assert.throws(() => parseArgs(['2026.9.3', '--authenticode-subject', '--write']), /valor/)
})
