import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { buildPlan, main, proposedIdentity, readIdentity } from './rename-app.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'onyx-rename-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

function fakeRepo() {
  const r = mkdtempSync(join(tmp, 'repo-'))
  const w = (rel, text) => {
    mkdirSync(join(r, rel, '..'), { recursive: true })
    writeFileSync(join(r, rel), text)
  }
  w(
    'src/shared/brand.ts',
    "export const DISPLAY_NAME = 'Lazunox'\nexport const INTERNAL_NAME = 'OnyxCode'\nexport const APP_NAME = INTERNAL_NAME\nexport const AUTHOR_ALIAS = 'bentec'\nexport const APP_SLUG = 'onyxcode'\nexport const REMOTE_HOST = 'https://remoto.onyxcode.cl'\n"
  )
  w('package.json', '{"name":"onyxcode","productName":"OnyxCode","author":"bentec"}')
  w('src/shared/i18n/es/app.ts', "export default { 'a.b': 'Bienvenido a OnyxCode' }")
  w('src/main/x.ts', "const p = 'OnyxCode'; const e = process.env.ONYXCODE_X; const u = 'onyxcode://app'")
  w('docs/A.md', 'OnyxCode OnyxCode')
  w('node_modules/pkg/index.js', 'OnyxCode')
  w('dist/x.js', 'OnyxCode')
  w('src/main/legacy.ts', "const old = 'Lapis'; const od = 'OpenDesk'")
  writeFileSync(join(r, 'src/main/bin.dat'), Buffer.from([0, 1, 2, 79, 110, 121, 120, 67, 111, 100, 101]))
  return r
}
function snapshot(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[p] = createHash('sha256').update(readFileSync(p)).digest('hex') + statSync(p).mtimeMs
    }
  }
  walk(dir)
  return out
}

test('lee la identidad y propone los valores derivados', () => {
  const r = fakeRepo()
  const cur = readIdentity(r)
  assert.deepEqual(cur, {
    name: 'OnyxCode',
    slug: 'onyxcode',
    alias: 'bentec',
    appId: 'cl.bentec.onyxcode',
    helperId: 'cl.bentec.opendesk.cu-helper',
    disclaimId: 'cl.bentec.onyxcode.disclaim'
  })
  const next = proposedIdentity(cur, { name: 'Zafiro', alias: 'zaf' })
  assert.equal(next.appId, 'cl.zaf.zafiro')
  assert.equal(next.helperId, 'cl.zaf.opendesk.cu-helper')
  assert.equal(next.disclaimId, 'cl.zaf.zafiro.disclaim')
  assert.throws(() => proposedIdentity(cur, { name: 'mal nombre' }), /--name/)
  assert.throws(() => proposedIdentity(cur, { alias: 'Mal' }), /--alias/)
})

test('lista por categoría, ignora node_modules, dist, binarios y nombres históricos, y NO modifica nada', () => {
  const r = fakeRepo()
  const before = snapshot(r)
  const plan = buildPlan(r, { name: 'Zafiro', alias: 'zaf' })
  assert.deepEqual(snapshot(r), before, 'no escribe nada')
  const files = Object.fromEntries(plan.files.map((f) => [f.file, f]))
  assert.deepEqual(Object.keys(files).sort(), [
    'docs/A.md',
    'package.json',
    'src/main/x.ts',
    'src/shared/brand.ts',
    'src/shared/i18n/es/app.ts'
  ])
  assert.equal(files['docs/A.md'].counts.name, 2)
  assert.deepEqual(files['src/main/x.ts'].counts, { name: 1, slug: 1, env: 1 })
  assert.equal(files['src/shared/brand.ts'].counts.domain, 1)
  assert.equal(files['src/shared/brand.ts'].category, 'identidad')
  assert.equal(files['src/shared/i18n/es/app.ts'].category, 'i18n')
  assert.ok(plan.notes.some((n) => /appId/.test(n)) && plan.notes.some((n) => /Lapis/.test(n)))
})

test('main: exige --dry-run; con él imprime la lista y devuelve 0; nombre inválido devuelve 1', () => {
  const r = fakeRepo()
  const errs = []
  assert.equal(main(['--name', 'Zafiro'], { root: r, err: (m) => errs.push(m) }), 2)
  assert.match(errs[0], /--dry-run/)
  const out = []
  assert.equal(main(['--dry-run', '--name', 'Zafiro', '--alias', 'zaf'], { root: r, log: (m) => out.push(m) }), 0)
  const text = out.join('\n')
  assert.match(text, /no se ha modificado ningún archivo/)
  assert.match(text, /cl\.bentec\.onyxcode → cl\.zaf\.zafiro/)
  const json = []
  assert.equal(main(['--dry-run', '--json'], { root: r, log: (m) => json.push(m) }), 0)
  assert.equal(JSON.parse(json[0]).totalFiles, 5)
  assert.equal(main(['--dry-run', '--name', 'x y'], { root: r, err: () => undefined }), 1)
})
