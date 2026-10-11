import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { publishGithub, readReleasesRepo } from './publish-github.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'lzx-gh-'))

test('copia los archivos, escribe SHA256SUMS y arma un comando de BORRADOR', () => {
  const src = tmp()
  const out = join(tmp(), 'gh')
  writeFileSync(join(src, 'update.json'), '{"v":1}')
  writeFileSync(join(src, 'Lazunox-Setup-0.5.9-x64.exe'), 'exe')
  writeFileSync(join(src, 'lazunox-0.5.9-arm64.dmg'), 'dmg')
  const files = ['update.json', 'Lazunox-Setup-0.5.9-x64.exe', 'lazunox-0.5.9-arm64.dmg'].map((n) => join(src, n))
  const { names, command, stage } = publishGithub({ tag: 'v0.5.9', outDir: out, files })
  assert.ok(names.includes('SHA256SUMS'))
  for (const n of names) assert.ok(existsSync(join(stage, n)))
  const sums = readFileSync(join(stage, 'SHA256SUMS'), 'utf8')
  assert.match(sums, /^[0-9a-f]{64} {2}Lazunox-Setup-0\.5\.9-x64\.exe\n[0-9a-f]{64} {2}lazunox-0\.5\.9-arm64\.dmg\n$/)
  assert.ok(!sums.includes('update.json'))
  assert.match(command, /^gh release create v0\.5\.9 /)
  assert.match(command, new RegExp(`--repo ${readReleasesRepo().replace('/', '\\/')}`))
  assert.match(command, / --draft /)
})

test('rechaza etiquetas, nombres y archivos inválidos; SHA256SUMS no se pasa a mano', () => {
  const src = tmp()
  const f = join(src, 'a.zip')
  writeFileSync(f, 'x')
  assert.throws(() => publishGithub({ tag: '0.5.9', outDir: join(src, 'o'), files: [f] }), /vX\.Y\.Z/)
  assert.throws(() => publishGithub({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [] }), /Faltan archivos/)
  assert.throws(() => publishGithub({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [join(src, 'no-existe')] }), /No existe/)
  mkdirSync(join(src, 'd'))
  writeFileSync(join(src, 'd', 'raro nombre.zip'), 'x')
  assert.throws(() => publishGithub({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [join(src, 'd', 'raro nombre.zip')] }), /no permitido/)
  writeFileSync(join(src, 'SHA256SUMS'), 'x')
  assert.throws(() => publishGithub({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [join(src, 'SHA256SUMS')] }), /lo genera/)
  assert.throws(() => publishGithub({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [f, f] }), /repetido/)
})

test('--prerelease se añade al comando', () => {
  const src = tmp()
  const f = join(src, 'a.zip')
  writeFileSync(f, 'x')
  const { command } = publishGithub({ tag: 'v1.0.0-beta.1', outDir: join(tmp(), 'o'), files: [f], prerelease: true })
  assert.match(command, / --prerelease$/)
})
