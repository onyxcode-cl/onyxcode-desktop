import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { publishVps, readReleasesBrand } from './publish-vps.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'lzx-vps-'))

test('arma la estructura de GitHub, el JSON de latest y el SHA256SUMS', () => {
  const src = tmp()
  const out = join(tmp(), 'vps')
  writeFileSync(join(src, 'update.json'), '{"v":1}')
  writeFileSync(join(src, 'update.json.sig'), 'firma')
  writeFileSync(join(src, 'Lazunox-Setup-0.5.9-x64.exe'), 'exe')
  const files = ['update.json', 'update.json.sig', 'Lazunox-Setup-0.5.9-x64.exe'].map((n) => join(src, n))
  const { names } = publishVps({ tag: 'v0.5.9', outDir: out, files })
  const { origin, repo } = readReleasesBrand()
  assert.ok(names.includes('SHA256SUMS'))
  const latest = JSON.parse(readFileSync(join(out, 'repos', repo, 'releases', 'latest'), 'utf8'))
  assert.equal(latest.tag_name, 'v0.5.9')
  assert.equal(latest.draft, false)
  assert.equal(latest.html_url, `${origin}/${repo}/releases/tag/v0.5.9`)
  for (const n of names) {
    assert.ok(existsSync(join(out, repo, 'releases', 'download', 'v0.5.9', n)))
    assert.ok(existsSync(join(out, repo, 'releases', 'latest', 'download', n)))
  }
  const sums = readFileSync(join(out, repo, 'releases', 'download', 'v0.5.9', 'SHA256SUMS'), 'utf8')
  assert.match(sums, /^[0-9a-f]{64} {2}Lazunox-Setup-0\.5\.9-x64\.exe\n$/)
})

test('rechaza etiquetas, nombres y archivos inválidos', () => {
  const src = tmp()
  const f = join(src, 'a.zip')
  writeFileSync(f, 'x')
  assert.throws(() => publishVps({ tag: '0.5.9', outDir: join(src, 'o'), files: [f] }), /vX\.Y\.Z/)
  assert.throws(() => publishVps({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [] }), /Faltan archivos/)
  assert.throws(() => publishVps({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [join(src, 'no-existe')] }), /No existe/)
  mkdirSync(join(src, 'd'))
  writeFileSync(join(src, 'd', 'raro nombre.zip'), 'x')
  assert.throws(() => publishVps({ tag: 'v1.0.0', outDir: join(src, 'o'), files: [join(src, 'd', 'raro nombre.zip')] }), /no permitido/)
})
