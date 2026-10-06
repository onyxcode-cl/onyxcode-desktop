import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'install.sh')
const PIN = '8446c25f2c710d66701c262f048390d8f6edba31'
const GOOD_SIG = `designated => identifier "cl.bentec.lazunox" and certificate leaf = H"${PIN}"`
const DMG = 'lazunox-0.3.0-arm64.dmg'
const DMG_BYTES = 'contenido-falso-del-dmg'
const sha = (s) => createHash('sha256').update(s).digest('hex')

const roots = []
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

// Dobles de los comandos del sistema. Cada uno anota su llamada en $LOG y se comporta según variables MOCK_*.
const MOCKS = {
  uname: `[ "$1" = "-s" ] && echo "\${MOCK_OS:-Darwin}" || echo "\${MOCK_ARCH:-arm64}"`,
  curl: `echo "curl $*" >> "$LOG"
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in
  */SHA256SUMS) printf '%s\\n' "$MOCK_SUMS" > "$out";;
  *.dmg) printf '%s' "$MOCK_DMG" > "$out";;
  *) exit 22;;
esac`,
  shasum: `echo "shasum $*" >> "$LOG"; echo "\${MOCK_SHA}  $3"`,
  hdiutil: `echo "hdiutil $*" >> "$LOG"
if [ "$1" = "attach" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "-mountpoint" ] && mp="$2"; shift; done
  mkdir -p "$mp/Lazunox.app/Contents"; echo bin > "$mp/Lazunox.app/Contents/marker"
fi`,
  ditto: `echo "ditto $*" >> "$LOG"; mkdir -p "$2"; cp -R "$1/." "$2/"`,
  codesign: `echo "codesign $*" >> "$LOG"; echo "Executable=x" >&2; echo "$MOCK_SIG"`,
  xattr: `echo "xattr $*" >> "$LOG"; [ "$1" = "-p" ] && [ -n "\${MOCK_QUARANTINE:-}" ] && exit 0; [ "$1" = "-p" ] && exit 1; exit 0`,
  open: `echo "open $*" >> "$LOG"`
}

function setup(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lazunox-install-test-'))
  roots.push(root)
  const bin = join(root, 'bin')
  const home = join(root, 'home')
  const apps = join(root, 'Applications')
  const tmp = join(root, 'tmp')
  for (const d of [bin, home, apps, tmp]) mkdirSync(d, { recursive: true })
  for (const [name, body] of Object.entries(MOCKS)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const data = join(home, 'Library', 'Application Support', 'Lazunox')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'datos.txt'), 'importante')
  const log = join(root, 'calls.log')
  writeFileSync(log, '')
  const baseEnv = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: tmp,
    LOG: log,
    LAZUNOX_RELEASES_REPO: 'dueno/repo',
    LAZUNOX_INSTALL_DIR: apps,
    MOCK_SUMS: `${sha(DMG_BYTES)}  ${DMG}`,
    MOCK_DMG: DMG_BYTES,
    MOCK_SHA: sha(DMG_BYTES),
    MOCK_SIG: GOOD_SIG,
    ...env
  }
  const run = (...args) => {
    const r = spawnSync('/bin/sh', [SCRIPT, ...args], { env: baseEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ...r, calls: readFileSync(log, 'utf8') }
  }
  return { run, apps, tmp, data, home }
}

test('caso feliz: descarga, verifica, instala y limpia', () => {
  const t = setup()
  const r = t.run('--no-open')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(t.apps, 'Lazunox.app', 'Contents', 'marker')))
  assert.match(r.calls, /curl -fsSL -o \S+\/SHA256SUMS https:\/\/github\.com\/dueno\/repo\/releases\/latest\/download\/SHA256SUMS/)
  assert.match(r.calls, /hdiutil attach -readonly/)
  assert.match(r.calls, /codesign -d -r-/)
  assert.match(r.calls, /hdiutil detach/)
  assert.ok(!r.calls.includes('sudo'))
  assert.deepEqual(readdirSync(t.tmp), [])
  assert.equal(readFileSync(join(t.data, 'datos.txt'), 'utf8'), 'importante')
})

test('--version usa la etiqueta de esa versión', () => {
  const t = setup()
  const r = t.run('--version', 'v0.3.0', '--no-open')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.calls, /releases\/download\/v0\.3\.0\/SHA256SUMS/)
})

test('quita la cuarentena solo si existe', () => {
  const con = setup({ MOCK_QUARANTINE: '1' }).run('--no-open')
  assert.match(con.calls, /xattr -dr com\.apple\.quarantine/)
  const sin = setup().run('--no-open')
  assert.ok(!sin.calls.includes('xattr -dr'))
})

test('SHA incorrecto aborta sin instalar y sin dejar temporales', () => {
  const t = setup({ MOCK_SHA: sha('otra cosa') })
  const r = t.run('--no-open')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /SHA-256/)
  assert.ok(!existsSync(join(t.apps, 'Lazunox.app')))
  assert.ok(!r.calls.includes('hdiutil attach'))
  assert.deepEqual(readdirSync(t.tmp), [])
})

test('firma distinta aborta, desmonta y limpia', () => {
  const t = setup({
    MOCK_SIG: 'designated => identifier "cl.bentec.lazunox" and certificate leaf = H"0000000000000000000000000000000000000000"'
  })
  const r = t.run('--no-open')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /firma/)
  assert.ok(!existsSync(join(t.apps, 'Lazunox.app')))
  assert.match(r.calls, /hdiutil detach/)
  assert.deepEqual(readdirSync(t.tmp), [])
})

test('Intel es rechazado antes de descargar nada', () => {
  const t = setup({ MOCK_ARCH: 'x86_64' })
  const r = t.run('--no-open')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /chip Apple/)
  assert.equal(r.calls, '')
})

test('el marcador PENDIENTE se niega a ejecutar', () => {
  const t = setup({ LAZUNOX_RELEASES_REPO: '' })
  const r = t.run('--no-open')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /todavía no hay una release/)
  assert.equal(r.calls, '')
  assert.ok(!existsSync(join(t.apps, 'Lazunox.app')))
})

test('--dry-run no ejecuta nada', () => {
  const t = setup()
  const r = t.run('--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.calls, '')
  assert.match(r.stdout, /\[dry-run\] curl -fsSL/)
  assert.match(r.stdout, /\[dry-run\] codesign -d -r-/)
  assert.deepEqual(readdirSync(t.tmp), [])
  assert.ok(!existsSync(join(t.apps, 'Lazunox.app')))
})

test('--uninstall borra la app pero nunca los datos, y lo dice', () => {
  const t = setup()
  mkdirSync(join(t.apps, 'Lazunox.app'))
  const r = t.run('--uninstall')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(join(t.apps, 'Lazunox.app')))
  assert.equal(readFileSync(join(t.data, 'datos.txt'), 'utf8'), 'importante')
  assert.match(r.stdout, /datos NO se han tocado/)
  assert.equal(r.calls, '')
})

test('--uninstall --dry-run no borra nada', () => {
  const t = setup()
  mkdirSync(join(t.apps, 'Lazunox.app'))
  const r = t.run('--uninstall', '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(t.apps, 'Lazunox.app')))
})

test('--help y opción desconocida', () => {
  const t = setup()
  assert.match(t.run('--help').stdout, /--uninstall/)
  const r = t.run('--nope')
  assert.equal(r.status, 2)
})

test('descarga fallida aborta y limpia', () => {
  const t = setup({ MOCK_SUMS: '' })
  const r = t.run('--no-open')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /ningún \.dmg/)
  assert.deepEqual(readdirSync(t.tmp), [])
})
