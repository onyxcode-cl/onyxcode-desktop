// Pruebas de `stage-wsl-bundle.mjs` (paquete incluido de Tareas en Windows). Sin red; los archivos son sintéticos y viven en tmp.
//   node --test scripts/stage-wsl-bundle.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stageBundle } from './stage-wsl-bundle.mjs'
import { bundleFilesFromPin, checkBundleDir } from './wsl-bundle-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const ROOTFS = Buffer.from('imagen-sintetica')
const OC = Buffer.from('opencode-sintetico')
const R = 'lazunox-rootfs-2026.10.1-x64.tar.gz'
const O = 'opencode-linux-x64.tar.gz'
const PIN = {
  version: '1.18.33',
  assets: {
    'linux-x64': { url: `https://github.com/anomalyco/opencode/releases/download/v1.18.33/${O}`, sha256: sha(OC), size: OC.length }
  },
  'wsl-rootfs': { version: '2026.10.1', sha256: sha(ROOTFS), size: ROOTFS.length }
}

async function scratch(fn) {
  const base = mkdtempSync(join(tmpdir(), 'lzx-stage-'))
  const from = join(base, 'src')
  const to = join(base, 'dst')
  try {
    return await fn({ base, from, to })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}
const seed = (from, { rootfs = ROOTFS, oc = OC } = {}) => {
  execFileSync('mkdir', ['-p', from])
  writeFileSync(join(from, R), rootfs)
  writeFileSync(join(from, O), oc)
}

test('bundleFilesFromPin: nombres, tamaños y huellas del pin; falla cerrado ante un pin incompleto o ajeno', () => {
  assert.deepEqual(
    bundleFilesFromPin(PIN).files.map((f) => [f.kind, f.name]),
    [
      ['rootfs', R],
      ['opencode', O]
    ]
  )
  assert.throws(() => bundleFilesFromPin({ ...PIN, 'wsl-rootfs': undefined }), /wsl-rootfs/)
  assert.throws(() => bundleFilesFromPin({ ...PIN, assets: {} }), /linux-x64/)
  assert.throws(
    () => bundleFilesFromPin({ ...PIN, assets: { 'linux-x64': { ...PIN.assets['linux-x64'], url: 'https://evil.example/x.tar.gz' } } }),
    /oficial/
  )
  assert.throws(() => bundleFilesFromPin({ ...PIN, 'wsl-rootfs': { ...PIN['wsl-rootfs'], sha256: 'zz' } }), /sha256/)
})

test('copia los dos archivos verificados y deja el destino idéntico (sin .part)', async () => {
  await scratch(async ({ from, to }) => {
    seed(from)
    const r = await stageBundle({ pin: PIN, from, to })
    assert.deepEqual(r.staged.sort(), [O, R].sort())
    assert.deepEqual(readdirSync(to).sort(), [O, R].sort())
    assert.deepEqual(await checkBundleDir(to, PIN), [])
    // idempotente: la segunda vez no copia nada
    const again = await stageBundle({ pin: PIN, from, to })
    assert.deepEqual(again.staged, [])
    assert.equal(again.skipped.length, 2)
  })
})

test('origen con otra huella (mismo tamaño), otro tamaño o ausente: NO copia nada (ni siquiera el archivo bueno)', async () => {
  const cases = [
    ['sha', { rootfs: Buffer.from('imagen-sinteticX') }],
    ['tamaño', { oc: Buffer.from('corto') }]
  ]
  for (const [name, over] of cases) {
    await scratch(async ({ from, to }) => {
      seed(from, over)
      await assert.rejects(stageBundle({ pin: PIN, from, to }), /no se copia nada/, name)
      assert.ok(!existsSync(to) || readdirSync(to).length === 0, `${name}: el destino debe quedar vacío`)
    })
  }
  await scratch(async ({ from, to }) => {
    seed(from)
    rmSync(join(from, O))
    await assert.rejects(stageBundle({ pin: PIN, from, to }), /no existe/)
    assert.ok(!existsSync(to))
  })
})

test('un enlace simbólico como origen se rechaza', async () => {
  await scratch(async ({ base, from, to }) => {
    seed(from)
    writeFileSync(join(base, 'real'), ROOTFS)
    rmSync(join(from, R))
    symlinkSync(join(base, 'real'), join(from, R))
    await assert.rejects(stageBundle({ pin: PIN, from, to }), /no es un archivo normal/)
  })
})

test('un destino viejo o corrupto se reemplaza por la copia verificada', async () => {
  await scratch(async ({ from, to }) => {
    seed(from)
    execFileSync('mkdir', ['-p', to])
    writeFileSync(join(to, R), 'viejo')
    const r = await stageBundle({ pin: PIN, from, to })
    assert.ok(r.staged.includes(R))
    assert.deepEqual(await checkBundleDir(to, PIN), [])
  })
})

test('el CLI sale 1 con un origen malo y 0 con uno bueno (sin red)', async () => {
  await scratch(({ base, from, to }) => {
    seed(from)
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify(PIN))
    const script = join(root, 'scripts', 'stage-wsl-bundle.mjs')
    const out = execFileSync(process.execPath, [script, '--from', from, '--to', to, '--pin', pinPath], { encoding: 'utf8' })
    assert.match(out, /OK \(2 copiados/)
    writeFileSync(join(from, R), 'malo')
    let code = 0
    try {
      execFileSync(process.execPath, [script, '--from', from, '--to', join(base, 'otro'), '--pin', pinPath], {
        encoding: 'utf8',
        stdio: 'pipe'
      })
    } catch (e) {
      code = e.status
    }
    assert.equal(code, 1)
  })
})

// Con los archivos REALES de este equipo (fuera del repo) y el pin REAL: solo lectura, se salta si no están.
const REAL_SRC = process.env.LAZUNOX_WSL_STAGING_SRC ?? join(homedir(), 'Documents', 'lazunox-staging')
const realPin = JSON.parse(readFileSync(join(root, 'resources', 'opencode-bin', 'pin.json'), 'utf8'))
const realThere =
  existsSync(join(REAL_SRC, 'opencode-linux-x64.tar.gz')) && existsSync(join(REAL_SRC, 'lazunox-rootfs-2026.10.1-x64.tar.gz'))
test('archivos reales de staging coinciden con el pin real', { skip: !realThere }, async () => {
  assert.deepEqual(await checkBundleDir(REAL_SRC, realPin), [])
})
