// Guardias de los flujos de GitHub Actions (no los ejecuta: comprueba por lectura las reglas de seguridad de docs/RELEASE.md).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(resolve(root, '.github/workflows', f), 'utf8')
const ci = read('ci.yml')
const release = read('release.yml')
const windows = read('windows.yml')
const require = createRequire(import.meta.url)
let yaml = null
try {
  yaml = require('js-yaml') // transitiva de eslint; si no está, solo se hacen las comprobaciones de texto
} catch {
  /* sin js-yaml */
}

const code = (t) =>
  t
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')

test('los dos flujos son YAML válido con los jobs esperados', { skip: !yaml }, () => {
  assert.deepEqual(Object.keys(yaml.load(ci).jobs), ['checks'])
  assert.deepEqual(Object.keys(yaml.load(release).jobs), ['draft-release'])
})

test('todas las acciones van fijadas por SHA de commit (40 hex)', () => {
  for (const t of [ci, release, windows]) {
    const uses = [...code(t).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    assert.ok(uses.length > 0)
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u)
  }
})

test('ci.yml: solo lectura, sin secretos y sin E2E ni empaquetado', () => {
  const c = code(ci)
  assert.match(c, /permissions:\s*\n\s+contents: read/)
  assert.ok(!/secrets\./.test(c))
  assert.ok(!/test:e2e|test:smoke|npm run verify\b|npm run package|electron-builder/.test(c))
  for (const step of ['npm run typecheck', 'npm run lint', 'npm run format:check', 'npm test']) assert.ok(c.includes(step), step)
  assert.ok(!/write/.test(c.replace(/cancel-in-progress/g, '')), 'ci.yml no pide permisos de escritura')
})

test('release.yml: entorno protegido, borrador, sin clave Ed25519 y sin publicar', () => {
  const c = code(release)
  assert.match(c, /environment: release/)
  assert.match(c, /gh release create .*\\?[\s\S]*--draft/)
  assert.ok(c.includes('--manifest-only'))
  assert.ok(c.includes('--expect devid'))
  assert.ok(!/LAZUNOX_UPDATE_KEY|update\.pem|sign-update|UPDATE_PRIVATE/i.test(c), 'la clave de actualizaciones nunca va al CI')
  assert.ok(!/gh release (edit|upload)|--draft=false|--latest/.test(c), 'nunca publica por sí solo')
  // Permisos mínimos: lectura global y escritura solo en el job.
  assert.match(c, /^permissions:\s*\n\s+contents: read/m)
  assert.equal([...c.matchAll(/contents: write/g)].length, 1)
  // Todo secreto entra como ${{ secrets.X }} (nada escrito a mano) y ninguno se imprime con echo.
  const names = new Set([...c.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))
  assert.deepEqual([...names].sort(), [
    'APPLE_API_ISSUER',
    'APPLE_API_KEY_ID',
    'APPLE_API_KEY_P8',
    'APPLE_TEAM_ID',
    'MAC_CERT_P12_BASE64',
    'MAC_CERT_PASSWORD'
  ])
  assert.ok(!/echo\s+"?\$\{?(MAC_CERT|APPLE_API_KEY_P8)/.test(c))
  // Orden: puerta de publicación → empaquetar → verificar → manifiesto → borrador; limpieza siempre.
  const order = ['verify:release', 'npm run package', 'verify:signed', '--manifest-only', 'gh release create']
  let at = -1
  for (const s of order) {
    const i = c.indexOf(s)
    assert.ok(i > at, `${s} fuera de orden`)
    at = i
  }
  assert.match(c, /if: always\(\)[\s\S]*delete-keychain/)
})

test('windows.yml: YAML válido, solo lectura, sin secretos, sin publicar y con las comprobaciones de Windows', () => {
  if (yaml) {
    const w = yaml.load(windows)
    assert.deepEqual(Object.keys(w.jobs), ['windows'])
    assert.equal(w.jobs.windows['runs-on'], 'windows-latest')
    assert.deepEqual(w.permissions, { contents: 'read' })
    assert.equal(w.jobs.windows.permissions, undefined, 'el job no amplía permisos')
  }
  const c = code(windows)
  assert.match(c, /^permissions:\s*\n\s+contents: read/m)
  assert.ok(!/secrets\./.test(c), 'sin secretos')
  assert.ok(!/write/.test(c.replace(/cancel-in-progress/g, '')), 'sin permisos de escritura')
  assert.ok(!/environment:|gh release|--publish|CSC_LINK|WIN_CSC|UPDATE_PRIVATE|update\.pem|sign-update/i.test(c), 'no publica ni firma')
  assert.ok(!/test:e2e|test:smoke|npm run verify\b/.test(c), 'sin E2E de Electron en el runner')
  const order = [
    'npm ci',
    'npm run typecheck',
    'vitest run --maxWorkers=2',
    'npm run build',
    'npm run package:win',
    'pack-check.ps1',
    'tar-check.mjs',
    'swap-check.ps1'
  ]
  let at = -1
  for (const s of order) {
    const i = c.indexOf(s)
    assert.ok(i > at, `${s} falta o está fuera de orden`)
    at = i
  }
  // El humo de la app empaquetada no bloquea, pero los controles estáticos sí.
  assert.match(c, /pack-check\.ps1[^\n]*-NoSmoke/)
  assert.match(c, /continue-on-error: true/)
})

test('los scripts de scripts/win que usa windows.yml aceptan otra raíz y mantienen su raíz por defecto', () => {
  const ps = (f) => readFileSync(resolve(root, 'scripts/win', f), 'utf8')
  for (const f of ['pack-check.ps1', 'swap-check.ps1']) {
    assert.match(ps(f), /\[string\]\$Root = '[A-Z]:\\[^']+'/, `${f}: raíz por defecto del PC de pruebas`)
    assert.match(ps(f), /\[string\]\$Wt = ''/, `${f}: -Wt`)
  }
  assert.match(readFileSync(resolve(root, 'scripts/win/tar-check.mjs'), 'utf8'), /arg\('--root', '[A-Z]:\\\\[^']+'\)/)
})
