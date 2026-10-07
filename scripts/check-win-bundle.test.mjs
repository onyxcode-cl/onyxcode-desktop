// Pruebas de la comprobación de empaquetado de Control del PC en Windows (plan win-C, C7). Sin red, sin Electron.
//   node --test scripts/check-win-bundle.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkComputerWinPackaging, computerWinPackExpected } from './check-win-bundle.mjs'

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

test('la regla de «activa» exige la puerta de compilación Y la variable', () => {
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '1' }, 'export const TASKS_WIN_BUILD = false'), false)
  assert.equal(computerWinPackExpected({}, 'export const TASKS_WIN_BUILD = true'), false)
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '0' }, 'export const TASKS_WIN_BUILD = true'), false)
  assert.equal(computerWinPackExpected({ LAZUNOX_COMPUTER_WIN_PACK: '1' }, 'export const TASKS_WIN_BUILD = true'), true)
})

test('config real, puerta apagada: ni helper ni agente, aunque se pida con la variable', () => {
  for (const env of [{}, { LAZUNOX_COMPUTER_WIN_PACK: '1' }]) {
    const cfg = loadConfig({ flagLiteral: 'false', env })
    assert.deepEqual(checkComputerWinPackaging(cfg, false), [])
    const all = JSON.stringify([cfg.extraResources, cfg.mac, cfg.win])
    assert.ok(!all.includes('cu-helper.exe') && !all.includes('computer.win.md'))
  }
})

test('config real, puerta encendida sin variable: sigue sin entrar', () => {
  const cfg = loadConfig({ flagLiteral: 'true' })
  assert.deepEqual(checkComputerWinPackaging(cfg, false), [])
})

test('config real, puerta encendida y variable: entran solo esos dos archivos, solo en win', () => {
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

test('el script con --config-only sale 0 con la config real', () => {
  const out = execFileSync(process.execPath, [script, '--config-only'], { encoding: 'utf8' })
  assert.match(out, /OK: empaquetado de Control del PC en Windows/)
})
