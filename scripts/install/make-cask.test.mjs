import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_OUT, renderCask } from './make-cask.mjs'

const SHA = 'a'.repeat(64)
const HERE = dirname(fileURLToPath(import.meta.url))

test('la cask lleva version, sha256, url, arquitectura y postflight', () => {
  const c = renderCask({ version: '0.4.0', sha256: SHA, repo: 'dueno/repo' })
  assert.match(c, /version "0\.4\.0"/)
  assert.match(c, new RegExp(`sha256 "${SHA}"`))
  assert.match(c, /url "https:\/\/lazunox\.onyxcode\.cl\/dueno\/repo\/releases\/download\/v#\{version\}\/lazunox-#\{version\}-arm64\.dmg"/)
  assert.match(c, /depends_on arch: :arm64/)
  assert.match(c, /depends_on macos:/)
  assert.match(c, /xattr/)
  assert.match(c, /com\.apple\.quarantine/)
  assert.match(c, /autofirmado/)
})

test('el zap no borra los datos del usuario', () => {
  const zap = renderCask({ version: '0.4.0', sha256: SHA, repo: 'dueno/repo' }).match(/zap trash: \[([^\]]*)\]/)[1]
  assert.ok(!zap.includes('Application Support'))
})

test('rechaza entradas inválidas', () => {
  assert.throws(() => renderCask({ version: 'x', sha256: SHA, repo: 'a/b' }), /versión/)
  assert.throws(() => renderCask({ version: '1.0.0', sha256: 'abc', repo: 'a/b' }), /sha256/)
  assert.throws(() => renderCask({ version: '1.0.0', sha256: SHA, repo: 'sin-barra' }), /repo/)
})

test('la CLI escribe el archivo pedido y falla con argumentos malos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lazunox-cask-'))
  try {
    const out = join(dir, 'x', 'lazunox.rb')
    const ok = spawnSync(
      process.execPath,
      [join(HERE, 'make-cask.mjs'), '--version', 'v1.2.3', '--sha256', SHA, '--repo', 'a/b', '--out', out],
      { encoding: 'utf8' }
    )
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(readFileSync(out, 'utf8'), /version "1\.2\.3"/)
    const bad = spawnSync(process.execPath, [join(HERE, 'make-cask.mjs'), '--version', '1.2.3'], { encoding: 'utf8' })
    assert.equal(bad.status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la cask de ejemplo del tap coincide con la plantilla (marcadores PENDIENTE)', () => {
  const esperado = renderCask({ version: '0.3.0', sha256: '0'.repeat(64), repo: 'PENDIENTE/lazunox' })
  assert.equal(readFileSync(DEFAULT_OUT, 'utf8'), esperado)
})
