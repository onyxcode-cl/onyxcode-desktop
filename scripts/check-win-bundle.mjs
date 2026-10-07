#!/usr/bin/env node
// Comprueba que `out/main/index.js` (lo que carga Windows al arrancar) NO contiene código de macOS:
// Seatbelt, helper de Control del PC, actualizador (ditto/swap.sh). Rollup debe dejar esos módulos en
// `out/main/chunks/*` cargados con import() dinámico solo en darwin (src/main/index.ts + platform-caps).
// Las cadenas de i18n que mencionan esas palabras (líneas `"clave": "texto"`) se ignoran.
// Además (plan win-C, C7) comprueba la CONFIGURACIÓN de empaquetado de electron-builder.js sobre Control del PC en Windows:
//   - `cu-helper.exe` y `computer.win.md` solo entran por `win.extraResources` y solo con la función activa
//     (`TASKS_WIN_BUILD` a `true`; ya no hace falta `LAZUNOX_COMPUTER_WIN_PACK`) y, activa, el helper compilado debe existir; nunca por `files`, `mac` ni el bloque común;
//   - los fuentes de Rust y `target/` no entran NUNCA (la exclusión de `files` sobre `resources/computer-use/win/**` sigue ahí
//     y ninguna entrada de extraResources apunta a esa carpeta salvo `win/bin` con el filtro exacto `cu-helper.exe`).
// Y (beta opcional de Tareas en Windows, decisión del dueño 2026-10-07) el paquete de WSL:
//   - con `TASKS_WIN_BUILD` activo `win.extraResources` lleva EXACTAMENTE tres bloques: `resources/wsl` filtrado a los 5 archivos de la
//     carga → `wsl`, `pin.json` → `wsl/pin.json` y las dos imágenes → `wsl/images`; con la bandera apagada, ninguno;
//   - nada de wsl (pruebas, vectores, `rootfs/`, imágenes) entra nunca en el .asar, ni en `mac`/comunes/asarUnpack;
//   - con la función activa, las dos imágenes de `resources/wsl-images/` deben existir y coincidir (tamaño y sha256) con `pin.json`
//     (falla el empaquetado si no: `npm run stage:wsl-bundle`). Opcional `--asar <app.asar>`: comprueba el .asar ya construido.
//   npm run build && node scripts/check-win-bundle.mjs          (todas las comprobaciones)
//   node scripts/check-win-bundle.mjs --config-only             (configuración e imágenes; no necesita `out/`)
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGING_DIR, bundleFilesFromPin, checkBundleDir } from './wsl-bundle-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'out', 'main', 'index.js')

const WIN_SRC = 'resources/computer-use/win'
const HELPER_ENTRY = { from: `${WIN_SRC}/bin`, filter: ['cu-helper.exe'] }
const AGENT_ENTRY = { from: 'resources/opencode/agents-win', filter: ['computer.win.md'] }
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '')

/** ¿Debe estar activa la función en el paquete? Misma regla que electron-builder.js. */
export function computerWinPackExpected(_env, featureFlagsSource) {
  return /export const TASKS_WIN_BUILD\s*=\s*true\b/.test(featureFlagsSource)
}

/** Ruta del helper compilado (`node scripts/build-native.mjs --win-helper`; gitignored). */
export const HELPER_EXE = `${WIN_SRC}/bin/cu-helper.exe`

/** Con la función activa el helper debe existir (si no, el instalador saldría sin Control del PC). Pura: `exists` inyectado. */
export function checkHelperPresent(active, exists) {
  if (!active || exists(HELPER_EXE)) return []
  return [`falta ${HELPER_EXE} con la función activa (compílalo con: node scripts/build-native.mjs --win-helper)`]
}

/**
 * Comprueba la config de electron-builder. Devuelve la lista de problemas (vacía si todo bien). Pura.
 * @param {any} config   lo que exporta electron-builder.js
 * @param {boolean} expectActive   si la función debe estar activa en este paquete
 */
export function checkComputerWinPackaging(config, expectActive) {
  const problems = []
  const files = (config.files ?? []).map(String)
  const sourcesExcluded = files.some(
    (f) => f.startsWith('!resources/computer-use/') && /[{,]win\/\*\*[,}]/.test(f) && /[{,]win[,}]/.test(f)
  )
  if (!sourcesExcluded)
    problems.push('files ya no excluye resources/computer-use/win y win/** (fuentes de Rust y target/ entrarían en el asar)')
  if (!files.includes('!resources/opencode/agents-win/**')) problems.push('files no excluye resources/opencode/agents-win/** del asar')
  // Un patrón positivo de `files` que reintroduzca la carpeta del helper o target/.
  for (const f of files) {
    if (!f.startsWith('!') && /computer-use|target|\.rs\b|Cargo/.test(f)) problems.push(`files incluye «${f}»`)
  }
  const unpack = (config.asarUnpack ?? []).map(String)
  for (const u of unpack) if (/computer-use/.test(u)) problems.push(`asarUnpack toca computer-use: «${u}»`)

  const where = { comun: config.extraResources ?? [], mac: config.mac?.extraResources ?? [], win: config.win?.extraResources ?? [] }
  for (const [plat, list] of Object.entries(where)) {
    for (const e of list) {
      const from = typeof e === 'string' ? e : norm(e.from)
      const filter = typeof e === 'string' ? undefined : e.filter
      const touchesWin = from === WIN_SRC || from.startsWith(`${WIN_SRC}/`)
      const isHelper = touchesWin && from === HELPER_ENTRY.from
      const isAgent = from === AGENT_ENTRY.from && JSON.stringify(filter) === JSON.stringify(AGENT_ENTRY.filter)
      const label = `${plat}.extraResources «${from}»`
      if (touchesWin && !isHelper) problems.push(`${label}: solo se permite ${HELPER_ENTRY.from} (nunca fuentes de Rust ni target/)`)
      if (isHelper) {
        if (JSON.stringify(filter) !== JSON.stringify(HELPER_ENTRY.filter))
          problems.push(`${label}: el filtro debe ser exactamente ["cu-helper.exe"]`)
        if (plat !== 'win') problems.push(`${label}: el helper de Windows solo puede ir en win.extraResources`)
        if (!expectActive) problems.push(`${label}: cu-helper.exe entra al paquete con la función apagada`)
      }
      if (from === AGENT_ENTRY.from && (filter ?? []).includes('computer.win.md')) {
        if (!isAgent) problems.push(`${label}: el filtro del agente debe ser exactamente ["computer.win.md"]`)
        if (plat !== 'win') problems.push(`${label}: computer.win.md solo puede ir en win.extraResources`)
        if (!expectActive) problems.push(`${label}: computer.win.md entra al paquete con la función apagada`)
      }
    }
  }
  if (expectActive) {
    const win = where.win.map((e) => `${norm(e.from)}|${JSON.stringify(e.filter)}`)
    if (!win.includes(`${HELPER_ENTRY.from}|${JSON.stringify(HELPER_ENTRY.filter)}`))
      problems.push('función activa pero win.extraResources no lleva cu-helper.exe')
    if (!win.includes(`${AGENT_ENTRY.from}|${JSON.stringify(AGENT_ENTRY.filter)}`))
      problems.push('función activa pero win.extraResources no lleva computer.win.md')
  }
  return problems
}

/** ¿Debe llevar el paquete de WSL (imágenes incluidas)? Misma regla que `wslBundlePack` de electron-builder.js: solo la puerta. */
export function wslBundlePackExpected(featureFlagsSource) {
  return /export const TASKS_WIN_BUILD\s*=\s*true\b/.test(featureFlagsSource)
}

const WSL_PAYLOAD_FILTER = ['launcher.py', 'landlock.py', 'mux.py', 'protocol.py', 'wsl.conf']
const isWslEntry = (e) => {
  if (typeof e === 'string') return /wsl|pin\.json/.test(e)
  const from = norm(e.from ?? '')
  const to = norm(e.to ?? '')
  return /(^|\/)wsl(-images)?($|\/)/.test(from) || to === 'wsl' || to.startsWith('wsl/') || (e.filter ?? []).includes('pin.json')
}

/** Los tres bloques que debe llevar `win.extraResources` con la función activa (la imagen se llama según el pin). */
export function expectedWslBlocks(pin) {
  const [rootfs, opencode] = bundleFilesFromPin(pin).files
  return [
    { from: 'resources/wsl', to: 'wsl', filter: WSL_PAYLOAD_FILTER },
    { from: 'resources/opencode-bin', to: 'wsl', filter: ['pin.json'] },
    { from: 'resources/wsl-images', to: 'wsl/images', filter: [rootfs.name, opencode.name] }
  ]
}

/**
 * Comprueba en la config de electron-builder el paquete de WSL. Devuelve la lista de problemas. Pura.
 * @param {any} config
 * @param {boolean} expectActive
 * @param {any} pin   contenido de pin.json (solo hace falta con la función activa, para el nombre de la imagen)
 */
export function checkWslBundlePackaging(config, expectActive, pin) {
  const problems = []
  const files = (config.files ?? []).map(String)
  for (const need of ['!resources/wsl/**', '!resources/wsl-images/**'])
    if (!files.includes(need)) problems.push(`files ya no excluye ${need.slice(1)} (entraría en el .asar)`)
  for (const f of files)
    if (!f.startsWith('!') && /wsl|pin\.json/i.test(f)) problems.push(`files incluye «${f}» (nada de wsl va en el .asar)`)
  for (const u of config.asarUnpack ?? []) if (/wsl/i.test(String(u))) problems.push(`asarUnpack toca wsl: «${u}»`)
  for (const [plat, list] of [
    ['comun', config.extraResources ?? []],
    ['mac', config.mac?.extraResources ?? []]
  ])
    for (const e of list)
      if (isWslEntry(e)) problems.push(`${plat}.extraResources lleva recursos de WSL (solo win.extraResources): ${JSON.stringify(e)}`)

  const winWsl = (config.win?.extraResources ?? []).filter(isWslEntry)
  if (!expectActive) {
    if (winWsl.length) problems.push('win.extraResources lleva recursos de WSL con la función apagada')
    return problems
  }
  let want
  try {
    want = expectedWslBlocks(pin)
  } catch (e) {
    problems.push(String(e.message))
    return problems
  }
  for (const w of want) {
    const same = winWsl.filter((e) => typeof e === 'object' && norm(e.from) === w.from)
    if (same.length !== 1) problems.push(`función activa: win.extraResources debe llevar UN bloque «${w.from}» (hay ${same.length})`)
    else if (norm(same[0].to) !== w.to || JSON.stringify(same[0].filter) !== JSON.stringify(w.filter))
      problems.push(`win.extraResources «${w.from}»: debe ser to «${w.to}» y filter ${JSON.stringify(w.filter)}`)
  }
  if (winWsl.length !== want.length)
    problems.push(`función activa: win.extraResources lleva ${winWsl.length} bloques de WSL, deben ser ${want.length}`)
  return problems
}

/** Archivos del .asar que NO deben estar (lista de rutas del paquete). Pura. */
export function wslLeaksInAsar(entries) {
  return entries
    .map((e) => String(e).replace(/\\/g, '/'))
    .filter(
      (e) =>
        /(^|\/)(wsl|wsl-images)(\/|$)/.test(e) ||
        /(^|\/)(test_[^/]*\.py|vectors\.json|payload-vectors\.json)$/.test(e) ||
        /rootfs-[^/]*\.tar\.gz$/.test(e)
    )
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()

async function main() {
  const flags = readFileSync(join(root, 'src', 'shared', 'feature-flags.ts'), 'utf8')
  const config = createRequire(import.meta.url)(join(root, 'electron-builder.js'))
  const expectActive = computerWinPackExpected(process.env, flags)
  const bad = checkComputerWinPackaging(config, expectActive)
  if (bad.length) {
    console.error(`electron-builder.js: empaquetado de Control del PC en Windows incorrecto (${bad.length}):\n- ${bad.join('\n- ')}`)
    process.exit(1)
  }
  console.log(
    `[check-win-bundle] OK: empaquetado de Control del PC en Windows (${expectActive ? 'función ACTIVA: helper y agente en win.extraResources' : 'función apagada: ni helper ni agente'}; sin fuentes de Rust ni target/)`
  )
  const wslActive = wslBundlePackExpected(flags)
  const pin = JSON.parse(readFileSync(join(root, 'resources', 'opencode-bin', 'pin.json'), 'utf8'))
  const wslBad = checkWslBundlePackaging(config, wslActive, pin)
  if (wslActive) wslBad.push(...(await checkBundleDir(join(root, STAGING_DIR), pin)))
  if (wslBad.length) {
    console.error(
      `paquete de WSL (Tareas en Windows) incorrecto (${wslBad.length}):\n- ${wslBad.join('\n- ')}\n(imágenes: npm run stage:wsl-bundle)`
    )
    process.exit(1)
  }
  console.log(
    `[check-win-bundle] OK: paquete de WSL (${wslActive ? 'función ACTIVA: lanzador, pin e imágenes en win.extraResources, imágenes verificadas contra el pin' : 'función apagada: nada de WSL en el instalador'}; nada de wsl en el .asar)`
  )
  const helperBad = checkHelperPresent(expectActive, (p) => existsSync(join(root, p)))
  if (helperBad.length) {
    console.error(`Control del PC en Windows: helper ausente:\n- ${helperBad.join('\n- ')}`)
    process.exit(1)
  }
  const asarArg = process.argv.indexOf('--asar')
  if (asarArg > 0) await checkAsar(process.argv[asarArg + 1])
  if (process.argv.includes('--config-only')) return
  checkOut()
}

function checkOut() {
  const FORBIDDEN = [
    'sandbox-exec',
    'cu-helper',
    'ditto',
    'swap.sh',
    'buildSandboxProfile',
    'class ComputerService',
    'class TasksManager',
    'class UpdateInstaller'
  ]
  const I18N_LINE = /^\s*"[\w.:-]+":\s*["'`]/

  const lines = readFileSync(file, 'utf8').split('\n')
  const hits = []
  lines.forEach((line, i) => {
    if (I18N_LINE.test(line)) return
    for (const word of FORBIDDEN) if (line.includes(word)) hits.push(`${i + 1}: «${word}» ${line.trim().slice(0, 120)}`)
  })
  if (hits.length) {
    console.error(`out/main/index.js contiene código de macOS (${hits.length}):\n${hits.join('\n')}`)
    process.exit(1)
  }
  console.log('[check-win-bundle] OK: out/main/index.js sin código de macOS (solo cadenas de i18n)')
}

async function checkAsar(asarPath) {
  const asar = createRequire(import.meta.url)('@electron/asar')
  const leaks = wslLeaksInAsar(asar.listPackage(resolve(asarPath)))
  if (leaks.length) {
    console.error(`${asarPath} contiene recursos de WSL (${leaks.length}):\n- ${leaks.slice(0, 20).join('\n- ')}`)
    process.exit(1)
  }
  console.log('[check-win-bundle] OK: el .asar no contiene nada de WSL (pruebas, vectores, rootfs ni imágenes)')
}
