import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkLicenseCoherence, detectLicense } from './license-check.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIT = 'MIT License\n\nCopyright (c) 2026 x\n\nPermission is hereby granted, free of charge, to any person'
const OK = '**Licencia de OnyxCode: MIT.** El código propio se distribuye bajo la licencia del fichero `LICENSE`.'

test('el repositorio real es coherente (LICENSE y THIRD_PARTY_NOTICES.md)', () => {
  const errs = checkLicenseCoherence(
    readFileSync(resolve(root, 'LICENSE'), 'utf8'),
    readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  )
  assert.deepEqual(errs, [])
})

test('detecta la licencia y las contradicciones', () => {
  assert.equal(detectLicense(MIT), 'MIT')
  assert.equal(detectLicense('Apache License\n Version 2.0, January 2004'), 'Apache-2.0')
  assert.equal(detectLicense('propia'), null)
  assert.deepEqual(checkLicenseCoherence(MIT, OK), [])
  assert.match(checkLicenseCoherence(MIT, '**LICENCIA PROPIA DE ONYXCODE: PENDIENTE.** x')[0], /PENDIENTE/)
  assert.ok(checkLicenseCoherence(MIT, OK.replace('MIT', 'Apache-2.0')).some((e) => /declara «Apache-2.0» pero LICENSE es MIT/.test(e)))
  assert.ok(checkLicenseCoherence(MIT, 'sin declaración').some((e) => /no declara/.test(e)))
  assert.ok(checkLicenseCoherence(MIT, OK.replace('`LICENSE`', 'el archivo')).some((e) => /remitir/.test(e)))
  assert.ok(checkLicenseCoherence('LICENCIA PENDIENTE', OK).length >= 1)
})
