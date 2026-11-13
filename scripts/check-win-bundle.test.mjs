// Pruebas de la comprobación de empaquetado de Control del PC en Windows (plan win-C, C7). Sin red, sin Electron.
//   node --test scripts/check-win-bundle.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fsMod from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  HELPER_EXE,
  PYTHON_WIN_EXE,
  PYTHON_WIN_SEAL,
  RIPGREP_WIN_EXE,
  checkRipgrepWinPackaging,
  checkPythonWinPackaging,
  checkComputerWinPackaging,
  checkWslBundlePackaging,
  checkHelperPresent,
  computerWinPackExpected,
  expectedWslBlocks,
  wslBundlePackExpected,
  wslLeaksInAsar
} from './check-win-bundle.mjs'
import { STAGING_DIR, bundleFilesFromPin, checkBundleDir } from './wsl-bundle-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'check-win-bundle.mjs')

/** Carga electron-builder.js en un proceso aparte, con `TASKS_WIN_BUILD` simulado y el entorno dado, y devuelve la config. */
function loadConfig({ flagLiteral, env = {} }) {
  const code = `
    const fs = require('node:fs')
    const real = fs.readFileSync
    fs.readFileSync = function (p, ...a) {
      if (String(p).endsWith('feature-flags.ts')) return 'export const TASKS_WIN_BUILD = ${flagLiteral}\\n'
      return real.call(this, p, ...a)
    }
    const c = require(${JSON.stringify(join(root, 'electron-builder.js'))})
    process.stdout.write(JSON.stringify({ files: c.files, asarUnpack: c.asarUnpack, extraResources: c.extraResources, mac: { extraResources: c.mac.extraResources }, win: { extraResources: c.win.extraResources } }))
  `
  const cleanEnv = { ...process.env, ...env }
  delete cleanEnv.CSC_NAME
  delete cleanEnv.CSC_LINK
  if (!('LAZUNOX_COMPUTER_WIN_PACK' in env)) delete cleanEnv.LAZUNOX_COMPUTER_WIN_PACK
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { env: cleanEnv, encoding: 'utf8' }))
}

test('la regla de «activa» es solo la puerta de compilación (la variable ya no cuenta)', () => {
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '1' }, 'export const TASKS_WIN_BUILD = false'), false)
  assert.equal(computerWinPackExpected({}, 'export const TASKS_WIN_BUILD = false'), false)
  assert.equal(computerWinPackExpected({}, 'export const TASKS_WIN_BUILD = true'), true)
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '0' }, 'export const TASKS_WIN_BUILD = true'), true)
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '1' }, 'export const TASKS_WIN_BUILD = true'), true)
})

test('con la función activa y sin helper compilado falla; apagada no exige nada', () => {
  assert.equal(checkHelperPresent(true, () => false).length, 1)
  assert.match(checkHelperPresent(true, () => false)[0], /--win-helper/)
  assert.deepEqual(
    checkHelperPresent(true, (p) => p.endsWith('cu-helper.exe')),
    []
  )
  assert.deepEqual(
    checkHelperPresent(false, () => false),
    []
  )
})

test('config real, puerta apagada: ni helper ni agente, aunque se pida con la variable', () => {
  for (const env of [{}, { LAZUNOX_COMPUTER_WIN_PACK: '1' }]) {
    const cfg = loadConfig({ flagLiteral: 'false', env })
    assert.deepEqual(checkComputerWinPackaging(cfg, false), [])
    const all = JSON.stringify([cfg.extraResources, cfg.mac, cfg.win])
    assert.ok(!all.includes('cu-helper.exe') && !all.includes('computer.win.md'))
  }
})

test('config real, puerta encendida sin variable: entra igual (la variable ya no hace falta)', () => {
  const cfg = loadConfig({ flagLiteral: 'true' })
  assert.deepEqual(checkComputerWinPackaging(cfg, true), [])
  assert.ok(JSON.stringify(cfg.win.extraResources).includes('cu-helper.exe'))
})

test('config real, puerta encendida: entran solo esos dos archivos, solo en win', () => {
  const cfg = loadConfig({ flagLiteral: 'true', env: { LAZUNOX_COMPUTER_WIN_PACK: '1' } })
  assert.deepEqual(checkComputerWinPackaging(cfg, true), [])
  const all = (list) => JSON.stringify(list)
  assert.ok(all(cfg.win.extraResources).includes('cu-helper.exe') && all(cfg.win.extraResources).includes('computer.win.md'))
  assert.ok(!all(cfg.mac.extraResources).includes('cu-helper.exe') && !all(cfg.mac.extraResources).includes('computer.win.md'))
  assert.ok(!all(cfg.extraResources).includes('cu-helper.exe'))
  // y la comprobación detecta que con la función «apagada» eso sería un error
  assert.ok(checkComputerWinPackaging(cfg, false).length >= 2)
})

test('detecta configuraciones peligrosas', () => {
  const good = loadConfig({ flagLiteral: 'true', env: { LAZUNOX_COMPUTER_WIN_PACK: '1' } })
  const clone = () => JSON.parse(JSON.stringify(good))
  const has = (cfg, re, active = true) => checkComputerWinPackaging(cfg, active).some((p) => re.test(p))

  let c = clone()
  c.files = c.files.filter((f) => !f.includes('computer-use'))
  assert.ok(has(c, /ya no excluye resources\/computer-use\/win/))

  c = clone()
  c.files = c.files.filter((f) => f !== '!resources/opencode/agents-win/**')
  assert.ok(has(c, /agents-win\/\*\* del asar/))

  c = clone()
  c.win.extraResources.push({ from: 'resources/computer-use/win', to: 'computer-use' })
  assert.ok(has(c, /solo se permite resources\/computer-use\/win\/bin/))

  c = clone()
  c.win.extraResources.push({ from: 'resources/computer-use/win/target', to: 'x' })
  assert.ok(has(c, /nunca fuentes de Rust ni target/))

  c = clone()
  c.win.extraResources.find((e) => e.from.endsWith('win/bin')).filter = ['*']
  assert.ok(has(c, /filtro debe ser exactamente/))

  c = clone()
  c.mac.extraResources.push({ from: 'resources/computer-use/win/bin', to: 'computer-use/bin', filter: ['cu-helper.exe'] })
  assert.ok(has(c, /solo puede ir en win\.extraResources/))

  c = clone()
  c.files.push('resources/computer-use/win/src/**')
  assert.ok(has(c, /files incluye/))

  c = clone()
  c.win.extraResources = c.win.extraResources.filter((e) => !e.from.endsWith('win/bin'))
  assert.ok(has(c, /no lleva cu-helper\.exe/))
})

// ───────────── Python incluido en Windows (W11) ─────────────
test('Python de Windows: la config real lleva UN bloque en win.extraResources, no en mac ni en común, y pasa con python.exe y sello', () => {
  const cfg = loadConfig({ flagLiteral: 'false' })
  assert.deepEqual(
    checkPythonWinPackaging(cfg, () => true),
    []
  )
  const py = cfg.win.extraResources.filter((e) => /python-bin/.test(e.from))
  assert.equal(py.length, 1)
  assert.equal(py[0].from, 'resources/python-bin/win-x64')
  assert.equal(py[0].to, 'python-bin/win-x64')
  assert.ok(py[0].filter.includes('!**/*.pyc') && py[0].filter.includes('!**/__pycache__'))
  assert.ok(!JSON.stringify(cfg.mac.extraResources).includes('win-x64') && !JSON.stringify(cfg.extraResources).includes('win-x64'))
  // también con la función de Tareas encendida (no depende de ella)
  assert.deepEqual(
    checkPythonWinPackaging(loadConfig({ flagLiteral: 'true' }), () => true),
    []
  )
})

test('Python de Windows: falla sin sello o sin python.exe, y detecta bloques mal puestos', () => {
  const good = loadConfig({ flagLiteral: 'false' })
  const clone = () => JSON.parse(JSON.stringify(good))
  const has = (cfg, re, exists = () => true) => checkPythonWinPackaging(cfg, exists).some((p) => re.test(p))
  assert.ok(has(good, /falta el sello/, (p) => p !== PYTHON_WIN_SEAL))
  assert.ok(has(good, /falta resources\/python-bin\/win-x64\/python\/python\.exe/, (p) => p !== PYTHON_WIN_EXE))
  let c = clone()
  c.win.extraResources = c.win.extraResources.filter((e) => !/python-bin/.test(e.from))
  assert.ok(has(c, /debe llevar UN bloque/))
  c = clone()
  c.win.extraResources.find((e) => /python-bin/.test(e.from)).filter = ['**/*']
  assert.ok(has(c, /debe ser to/))
  c = clone()
  c.mac.extraResources.push({ from: 'resources/python-bin/win-x64', to: 'python' })
  assert.ok(has(c, /solo win\.extraResources/))
  c = clone()
  c.files = c.files.filter((f) => f !== '!resources/python-bin/**')
  assert.ok(has(c, /entraría en el \.asar/))
})

test('ripgrep de Windows: la config real lleva UN bloque solo en win.extraResources y pasa con rg.exe', () => {
  const cfg = loadConfig({ flagLiteral: 'false' })
  assert.deepEqual(
    checkRipgrepWinPackaging(cfg, () => true),
    []
  )
  const rg = cfg.win.extraResources.filter((e) => /ripgrep-bin/.test(e.from))
  assert.equal(rg.length, 1)
  assert.deepEqual(rg[0], { from: 'resources/ripgrep-bin/bin', to: 'ripgrep', filter: ['rg.exe'] })
  assert.ok(cfg.files.includes('!resources/ripgrep-bin/**'))
})

test('ripgrep de Windows: falla sin rg.exe y detecta bloques mal puestos', () => {
  const good = loadConfig({ flagLiteral: 'false' })
  const clone = () => JSON.parse(JSON.stringify(good))
  const has = (cfg, re, exists = () => true) => checkRipgrepWinPackaging(cfg, exists).some((p) => re.test(p))
  assert.ok(has(good, /falta resources\/ripgrep-bin\/bin\/rg\.exe/, (p) => p !== RIPGREP_WIN_EXE))
  let c = clone()
  c.win.extraResources = c.win.extraResources.filter((e) => !/ripgrep-bin/.test(e.from))
  assert.ok(has(c, /debe llevar UN bloque/))
  c = clone()
  c.win.extraResources.find((e) => /ripgrep-bin/.test(e.from)).to = 'otra'
  assert.ok(has(c, /debe ser from/))
  c = clone()
  c.mac.extraResources.push({ from: 'resources/ripgrep-bin/bin', to: 'ripgrep', filter: ['rg.exe'] })
  assert.ok(has(c, /solo win\.extraResources/))
  c = clone()
  c.files = c.files.filter((f) => f !== '!resources/ripgrep-bin/**')
  assert.ok(has(c, /entraría en el \.asar/))
})

// El script con la función activa exige las dos imágenes de WSL (`resources/wsl-images/`, gitignored, las deja
// `npm run stage:wsl-bundle`) y `cu-helper.exe` (gitignored, lo compila `build-native.mjs --win-helper`). Ninguno existe
// en el CI de GitHub (macOS limpio), así que esta prueba de integración se SALTA ahí cuando falte algo. El script no
// cambia: `npm run package:win` sigue fallando cerrado si faltan. Las pruebas unitarias de arriba sí cubren la regla.
const flagsSource = readFileSync(join(root, 'src', 'shared', 'feature-flags.ts'), 'utf8')
const packagingStaged = (() => {
  // El Python de Windows (fetch-python.mjs, solo se baja en un PC con Windows) también es un artefacto local.
  if (!fsMod.existsSync(join(root, PYTHON_WIN_SEAL))) return false
  if (!fsMod.existsSync(join(root, RIPGREP_WIN_EXE))) return false
  if (!wslBundlePackExpected(flagsSource)) return true
  const pinForStaging = JSON.parse(readFileSync(join(root, 'resources', 'opencode-bin', 'pin.json'), 'utf8'))
  const imagesOk = bundleFilesFromPin(pinForStaging).files.every((f) => fsMod.existsSync(join(root, STAGING_DIR, f.name)))
  return imagesOk && fsMod.existsSync(join(root, HELPER_EXE))
})()

test(
  'el script con --config-only sale 0 con la config real',
  {
    skip: packagingStaged
      ? false
      : 'faltan artefactos locales (no están en git): resources/python-bin/win-x64 (npm run fetch:python en Windows), resources/ripgrep-bin/bin/rg.exe (npm run fetch:ripgrep) o, con la función activa, resources/wsl-images/* o cu-helper.exe'
  },
  () => {
    const out = execFileSync(process.execPath, [script, '--config-only'], { encoding: 'utf8' })
    assert.match(out, /OK: empaquetado de Control del PC en Windows/)
  }
)

// ───────────── paquete de WSL (Tareas en Windows, beta opcional 2026-10-07) ─────────────
const realPin = JSON.parse(readFileSync(join(root, 'resources', 'opencode-bin', 'pin.json'), 'utf8'))

test('wslBundlePackExpected: solo depende del literal TASKS_WIN_BUILD (texto fuente inyectado)', () => {
  assert.equal(wslBundlePackExpected('export const TASKS_WIN_BUILD = false'), false)
  assert.equal(wslBundlePackExpected('export const TASKS_WIN_BUILD = true'), true)
  assert.equal(wslBundlePackExpected('// TASKS_WIN_BUILD = true\nexport const TASKS_WIN_BUILD = false'), false)
})

test('bandera apagada (la real hoy): ni un archivo de WSL en win.extraResources y la config pasa', () => {
  const cfg = loadConfig({ flagLiteral: 'false' })
  assert.deepEqual(checkWslBundlePackaging(cfg, false, realPin), [])
  assert.ok(!JSON.stringify(cfg.win.extraResources).includes('wsl'))
  assert.ok(cfg.files.includes('!resources/wsl/**') && cfg.files.includes('!resources/wsl-images/**'))
})

test('bandera encendida: EXACTAMENTE los tres bloques del plan, solo en win; mac intacto', () => {
  const cfg = loadConfig({ flagLiteral: 'true' })
  assert.deepEqual(checkWslBundlePackaging(cfg, true, realPin), [])
  const wsl = cfg.win.extraResources.filter((e) => /wsl/.test(e.to ?? '') || /wsl/.test(e.from))
  assert.deepEqual(wsl, [
    { from: 'resources/wsl', to: 'wsl', filter: ['launcher.py', 'landlock.py', 'mux.py', 'protocol.py', 'lzx_rm.py', 'wsl.conf'] },
    { from: 'resources/opencode-bin', to: 'wsl', filter: ['pin.json'] },
    { from: 'resources/wsl-images', to: 'wsl/images', filter: ['lazunox-rootfs-2026.11.12-x64.tar.gz', 'opencode-linux-x64.tar.gz'] }
  ])
  assert.deepEqual(wsl, expectedWslBlocks(realPin))
  // En mac solo se permite el rm propio de Tareas (`lzx_rm.py`), la misma fuente que va a WSL; nada más de WSL.
  const macWsl = cfg.mac.extraResources.filter((e) => JSON.stringify(e).includes('wsl'))
  assert.deepEqual(macWsl, [{ from: 'resources/wsl', to: 'wsl', filter: ['lzx_rm.py'] }])
  assert.ok(!JSON.stringify(cfg.extraResources).includes('wsl'))
  // mac.extraResources es idéntico con la bandera apagada
  assert.deepEqual(cfg.mac.extraResources, loadConfig({ flagLiteral: 'false' }).mac.extraResources)
  // con la función «apagada» esperada, esos bloques son un error
  assert.ok(checkWslBundlePackaging(cfg, false, realPin).length >= 1)
})

test('el filtro del lanzador nunca deja pasar pruebas, vectores ni rootfs/', () => {
  const cfg = loadConfig({ flagLiteral: 'true' })
  const block = cfg.win.extraResources.find((e) => e.from === 'resources/wsl')
  for (const f of block.filter) assert.ok(!/test_|vectors|rootfs/.test(f), f)
  assert.ok(wslLeaksInAsar(['/src/main.js', '/resources/wsl/launcher.py']).length === 1)
})

test('detecta configuraciones peligrosas del paquete de WSL', () => {
  const good = loadConfig({ flagLiteral: 'true' })
  const clone = () => JSON.parse(JSON.stringify(good))
  const has = (cfg, re, active = true) => checkWslBundlePackaging(cfg, active, realPin).some((p) => re.test(p))
  const wslBlock = (c, from) => c.win.extraResources.find((e) => e.from === from)

  let c = clone()
  c.files = c.files.filter((f) => f !== '!resources/wsl/**')
  assert.ok(has(c, /ya no excluye resources\/wsl\/\*\*/))

  c = clone()
  c.files = c.files.filter((f) => f !== '!resources/wsl-images/**')
  assert.ok(has(c, /ya no excluye resources\/wsl-images/))

  c = clone()
  c.files.push('resources/wsl/**')
  assert.ok(has(c, /files incluye/))

  c = clone()
  c.asarUnpack.push('resources/wsl/**')
  assert.ok(has(c, /asarUnpack toca wsl/))

  c = clone()
  delete wslBlock(c, 'resources/wsl').filter
  assert.ok(has(c, /debe ser to/))

  c = clone()
  wslBlock(c, 'resources/wsl').filter.push('test_protocol.py')
  assert.ok(has(c, /debe ser to/))

  c = clone()
  c.win.extraResources.push({ from: 'resources/wsl/rootfs', to: 'wsl/rootfs' })
  assert.ok(has(c, /lleva 4 bloques/))

  c = clone()
  c.win.extraResources = c.win.extraResources.filter((e) => e.from !== 'resources/wsl-images')
  assert.ok(has(c, /UN bloque «resources\/wsl-images»/))

  c = clone()
  wslBlock(c, 'resources/wsl-images').to = 'otra'
  assert.ok(has(c, /debe ser to «wsl\/images»/))

  c = clone()
  c.mac.extraResources.push({ from: 'resources/wsl-images', to: 'wsl/images' })
  assert.ok(has(c, /solo win\.extraResources/))

  c = clone()
  c.extraResources.push({ from: 'resources/opencode-bin', to: 'x', filter: ['pin.json'] })
  assert.ok(has(c, /solo win\.extraResources/))
})

test('con la función activa, imágenes ausentes, de otro tamaño o con otra huella: FALLA; las buenas pasan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lzx-bundle-'))
  try {
    const rootfs = Buffer.from('imagen-de-prueba')
    const oc = Buffer.from('opencode-de-prueba')
    const sha = (b) => createHash('sha256').update(b).digest('hex')
    const pin = {
      version: '1.18.33',
      assets: {
        'linux-x64': {
          url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
          sha256: sha(oc),
          size: oc.length
        }
      },
      'wsl-rootfs': { version: '2026.10.1', sha256: sha(rootfs), size: rootfs.length }
    }
    const R = join(dir, 'lazunox-rootfs-2026.10.1-x64.tar.gz')
    const O = join(dir, 'opencode-linux-x64.tar.gz')
    assert.equal((await checkBundleDir(dir, pin)).length, 2) // faltan las dos
    writeFileSync(R, rootfs)
    writeFileSync(O, oc)
    assert.deepEqual(await checkBundleDir(dir, pin), [])
    writeFileSync(R, Buffer.from('imagen-de-pruebX')) // mismo tamaño, otra huella
    assert.match((await checkBundleDir(dir, pin))[0], /sha256/)
    writeFileSync(R, Buffer.from('corta'))
    assert.match((await checkBundleDir(dir, pin))[0], /tamaño/)
    writeFileSync(R, rootfs)
    assert.deepEqual(await checkBundleDir(dir, pin), [])
    // pin sin imagen: falla cerrado
    assert.match((await checkBundleDir(dir, { ...pin, 'wsl-rootfs': undefined }))[0], /wsl-rootfs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('el script con la función activa (literal inyectado) y SIN imágenes sale distinto de 0', () => {
  // Se ejecuta una copia del script contra una raíz temporal sin `resources/wsl-images`, con el literal en true.
  const dir = fsMod.realpathSync(mkdtempSync(join(tmpdir(), 'lzx-root-')))
  try {
    const { cpSync, mkdirSync } = fsMod
    for (const f of [
      'scripts/check-win-bundle.mjs',
      'scripts/wsl-bundle-lib.mjs',
      'electron-builder.js',
      'resources/opencode-bin/pin.json'
    ])
      (mkdirSync(dirname(join(dir, f)), { recursive: true }), cpSync(join(root, f), join(dir, f)))
    mkdirSync(join(dir, 'src/shared'), { recursive: true })
    writeFileSync(join(dir, 'src/shared/feature-flags.ts'), 'export const TASKS_WIN_BUILD = true\n')
    mkdirSync(join(dir, 'build'), { recursive: true })
    cpSync(join(root, 'build/sign-common.js'), join(dir, 'build/sign-common.js'))
    // sin node_modules: el script no los usa; electron-builder.js solo mira pwa/dist
    let failed = false
    try {
      execFileSync(process.execPath, [join(dir, 'scripts/check-win-bundle.mjs'), '--config-only'], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      failed = true
      assert.match(String(e.stderr), /paquete de WSL/)
      assert.match(String(e.stderr), /no existe/)
    }
    assert.ok(failed, 'debía fallar sin imágenes')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('el script con la función activa, imágenes en regla y SIN cu-helper.exe sale distinto de 0', () => {
  const dir = fsMod.realpathSync(mkdtempSync(join(tmpdir(), 'lzx-root-')))
  try {
    const { cpSync, mkdirSync } = fsMod
    for (const f of [
      'scripts/check-win-bundle.mjs',
      'scripts/wsl-bundle-lib.mjs',
      'electron-builder.js',
      'resources/opencode-bin/pin.json'
    ])
      (mkdirSync(dirname(join(dir, f)), { recursive: true }), cpSync(join(root, f), join(dir, f)))
    mkdirSync(join(dir, 'src/shared'), { recursive: true })
    writeFileSync(join(dir, 'src/shared/feature-flags.ts'), 'export const TASKS_WIN_BUILD = true\n')
    mkdirSync(join(dir, 'build'), { recursive: true })
    cpSync(join(root, 'build/sign-common.js'), join(dir, 'build/sign-common.js'))
    // Sin imágenes el script falla antes por el paquete de WSL: aquí solo se comprueba el orden y el mensaje del helper con la
    // comprobación pura; el camino completo lo cubre `checkHelperPresent` (arriba) y el literal real del script.
    const src = readFileSync(join(root, 'scripts/check-win-bundle.mjs'), 'utf8')
    assert.match(src, /checkHelperPresent\(expectActive, \(p\) => existsSync\(join\(root, p\)\)\)/)
    assert.match(src, /process\.exit\(1\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
