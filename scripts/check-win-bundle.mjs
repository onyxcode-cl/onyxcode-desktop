#!/usr/bin/env node
// Comprueba que `out/main/index.js` (lo que carga Windows al arrancar) NO contiene código de macOS:
// Seatbelt, helper de Control del PC, actualizador (ditto/swap.sh). Rollup debe dejar esos módulos en
// `out/main/chunks/*` cargados con import() dinámico solo en darwin (src/main/index.ts + platform-caps).
// Las cadenas de i18n que mencionan esas palabras (líneas `"clave": "texto"`) se ignoran.
// Además (plan win-C, C7) comprueba la CONFIGURACIÓN de empaquetado de electron-builder.js sobre Control del PC en Windows:
//   - `cu-helper.exe` y `computer.win.md` solo entran por `win.extraResources` y solo con la función activa
//     (`TASKS_WIN_BUILD` a `true` Y `LAZUNOX_COMPUTER_WIN_PACK=1`); nunca por `files`, `mac` ni el bloque común;
//   - los fuentes de Rust y `target/` no entran NUNCA (la exclusión de `files` sobre `resources/computer-use/win/**` sigue ahí
//     y ninguna entrada de extraResources apunta a esa carpeta salvo `win/bin` con el filtro exacto `cu-helper.exe`).
//   npm run build && node scripts/check-win-bundle.mjs          (ambas comprobaciones)
//   node scripts/check-win-bundle.mjs --config-only             (solo la configuración; no necesita `out/`)
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'out', 'main', 'index.js')

const WIN_SRC = 'resources/computer-use/win'
const HELPER_ENTRY = { from: `${WIN_SRC}/bin`, filter: ['cu-helper.exe'] }
const AGENT_ENTRY = { from: 'resources/opencode/agents-win', filter: ['computer.win.md'] }
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '')

/** ¿Debe estar activa la función en el paquete? Misma regla que electron-builder.js. */
export function computerWinPackExpected(env, featureFlagsSource) {
  return /export const TASKS_WIN_BUILD\s*=\s*true\b/.test(featureFlagsSource) && env.LAZUNOX_COMPUTER_WIN_PACK === '1'
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()

function main() {
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
