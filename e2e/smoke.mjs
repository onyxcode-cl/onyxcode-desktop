#!/usr/bin/env node
// test:smoke — arranca la app REAL con `electron-vite dev` (no build) y falla ante errores de arranque
// o de render. Atrapa lo que typecheck/tests/build no ven (p. ej. `export { x }` antes del `import` de x:
// el transform de Vite/Babel en dev lanza "Pre-transform error / Internal server error" y la vista queda vacía).
//
// Aislamiento (nunca toca el userData real ni el puerto 5173 de un `npm run dev` abierto):
//  - userData en un tmp (`--user-data-dir=<tmp>/userData`), con `settings.json` mínimo escrito ANTES de arrancar
//    (así `migrateLegacyUserData` no mueve datos de ~/Library/Application Support/{Lapis,OpenDesk}); si no puede
//    garantizarlo, ABORTA. XDG_* y HOME de datos de OpenCode en el tmp; OPENCODE_BIN = OpenCode falso (e2e/fake-opencode).
//  - depuración remota en un puerto libre (`--remote-debugging-port`, pasado tras `--` a Electron). El dev server de
//    Vite no fija `strictPort`: si 5173 está ocupado toma el siguiente libre (electron-vite exporta ELECTRON_RENDERER_URL).
//  - proceso lanzado `detached` y cerrado con SIGTERM al grupo (luego SIGKILL); el tmp se borra siempre.
//
// Flujo: espera `#root` con hijos → recorre Chat/Code/Tareas/Rutinas → Ajustes y cada sección → vuelve. En cada paso
// falla si hay: patrones de error en stdout/stderr, `Runtime.exceptionThrown`, `console.error`/`Log` error fuera de
// `e2e/smoke-allowlist.json` (entradas {pattern (regex), reason}), overlay de error de Vite o el fallback del
// ErrorBoundary ("Algo salió mal"). Tope global: 90 s. Salida 1 con el detalle si algo falla.
//
// PRUEBAS DE REGRESIÓN (hechas, no commitear):
//  (1) En features/code/impl/ProjectPicker.tsx se puso `export { baseName }` ANTES del `import { baseName, ... }`:
//      `npm run test:smoke` sale con 1 señalando ProjectPicker.tsx (Pre-transform error, al visitar Code); revertido, pasa.
//  (2) `SMOKE_FAULT=chat npm run test:smoke` activa localStorage['onyx.e2e']='1', recarga y llama
//      `window.__onyxE2E.throwIn('chat')`: el smoke debe fallar detectando el fallback del ErrorBoundary.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT_MS = 90_000
const SETTLE_MS = 1500
const t0 = Date.now()
const secs = () => ((Date.now() - t0) / 1000).toFixed(1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`[smoke ${secs()}s] ${m}`)

const OUT_PATTERNS = [
  /Pre-transform error/,
  /Internal server error/,
  /\[vite\].*error/i,
  /Uncaught/,
  /\[ipc\] canales sin esquema/
]
const FALLBACK_TEXT = 'Algo salió mal'
const allowlist = JSON.parse(readFileSync(join(root, 'e2e/smoke-allowlist.json'), 'utf8')).map((e) => {
  if (!e.pattern || !e.reason) throw new Error('smoke-allowlist.json: cada entrada necesita pattern y reason')
  return new RegExp(e.pattern)
})

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })

// ───────── tmp aislado ─────────
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-smoke-')))
const userData = join(tmp, 'userData')
let child = null
let cleaned = false

function cleanup() {
  if (cleaned) return
  cleaned = true
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
  }
}
async function finish(code) {
  cleanup()
  if (child?.pid) {
    const end = Date.now() + 8000
    while (Date.now() < end && groupAlive(child.pid)) await sleep(150)
    if (groupAlive(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {}
      await sleep(300)
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {}
  process.exit(code)
}
function groupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}
process.on('SIGINT', () => void finish(130))
process.on('SIGTERM', () => void finish(143))

let lastStep = 'arranque'
const failures = []
const fail = (kind, detail) => failures.push({ kind, detail: String(detail).slice(0, 1200) })

async function main() {
  // settings.json mínimo ANTES de arrancar (evita migrateLegacyUserData); abortar si no se garantiza.
  mkdirSync(userData, { recursive: true })
  if (!userData.startsWith(tmp + sep) || !userData.startsWith(realpathSync(tmpdir()) + sep)) throw new Error('userData fuera del tmp')
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify(
      { defaultModel: { providerID: 'fake', modelID: 'fake-model' }, theme: 'dark', recentFolders: [], tasksGlobalInstructions: '', onboarded: true, routinesTermsAcknowledged: true },
      null,
      2
    )
  )
  if (!existsSync(join(userData, 'settings.json'))) throw new Error('no se pudo escribir settings.json: aborto')

  const debugPort = await freePort()
  const fakeBin = join(root, 'e2e/fake-opencode/opencode')
  const env = {
    ...process.env,
    OPENCODE_BIN: fakeBin,
    XDG_CONFIG_HOME: join(tmp, 'xdg/config'),
    XDG_DATA_HOME: join(tmp, 'xdg/data'),
    XDG_CACHE_HOME: join(tmp, 'xdg/cache'),
    XDG_STATE_HOME: join(tmp, 'xdg/state'),
    // Sin ventanas visibles ni icono extra en el Dock (solo aplica sin empaquetar; ver src/main/e2e-headless.ts).
    ONYXCODE_E2E_HEADLESS: '1'
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL

  let out = ''
  let scanned = 0
  child = spawn('npx', ['electron-vite', 'dev', '--', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  child.on('exit', (code) => log(`electron-vite terminó (code ${code})`))
  log(`electron-vite dev lanzado (debug ${debugPort}, userData ${userData})`)

  const deadline = t0 + TIMEOUT_MS
  const timeLeft = () => deadline - Date.now()
  const outErrors = () => {
    const res = []
    const text = out.slice(scanned)
    scanned = out.length
    for (const line of text.split('\n')) if (OUT_PATTERNS.some((p) => p.test(line))) res.push(line.trim())
    return res
  }

  // Conexión CDP
  let target = null
  while (!target) {
    if (timeLeft() <= 0) throw new Error('timeout esperando la página de la app en CDP')
    if (child.exitCode !== null) throw new Error('electron-vite salió antes de abrir la ventana')
    const oe = outErrors()
    if (oe.length) {
      oe.forEach((l) => fail('stdout/stderr', l))
      throw new Error('errores en el arranque')
    }
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
      target = list.find((t) => t.type === 'page' && /index\.html|localhost:\d+\/?($|#|\?)/.test(t.url) && t.webSocketDebuggerUrl)
    } catch {}
    if (!target) await sleep(300)
  }
  log(`página CDP: ${target.url}`)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('websocket CDP falló'))
  })
  let nextId = 1
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
      return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      fail('Runtime.exceptionThrown', `${d.exception?.description ?? d.text} @ ${d.url ?? ''}:${d.lineNumber ?? ''}`)
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
      consoleErrors.push(text)
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'console-api') {
      const e = m.params.entry
      consoleErrors.push(`[${e.source}] ${e.text}${e.url ? ' ' + e.url : ''}`)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        rej(new Error(`CDP ${method}: sin respuesta en 8 s`))
      }, 8000)
      pending.set(id, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')

  if (process.env.SMOKE_FAULT) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('onyx.e2e','1')}catch(e){}` })
    await send('Page.reload')
    await sleep(500)
  }

  /** Comprueba todo lo acumulado; devuelve true si hay fallos. */
  const check = async (step) => {
    for (const l of outErrors()) fail(`stdout/stderr (${step})`, l)
    while (consoleErrors.length) {
      const t = consoleErrors.shift()
      if (!allowlist.some((re) => re.test(t))) fail(`console.error (${step})`, t)
    }
    try {
      const dom = await evalJs(`(() => {
        const alert = document.querySelector('[role="alert"]')
        const overlay = document.querySelector('vite-error-overlay')
        return { fallback: alert && alert.textContent.includes(${JSON.stringify(FALLBACK_TEXT)}) ? alert.textContent.slice(0, 300) : null,
                 overlay: overlay ? (overlay.shadowRoot?.textContent || 'vite-error-overlay').slice(0, 600) : null }
      })()`)
      if (dom.fallback) fail(`ErrorBoundary (${step})`, dom.fallback)
      if (dom.overlay) fail(`vite-error-overlay (${step})`, dom.overlay)
    } catch (e) {
      fail(`evaluate (${step})`, e.message)
    }
    return failures.length > 0
  }
  /** Espera hasta `cond` (expresión JS) o agota el tiempo; corta si aparece un fallo. */
  const waitFor = async (step, cond, ms = 15000) => {
    const end = Math.min(Date.now() + ms, deadline)
    for (;;) {
      if (await check(step)) return false
      try {
        if (await evalJs(cond)) return true
      } catch {}
      if (Date.now() > end) {
        fail(`timeout (${step})`, `condición no cumplida: ${cond}`)
        return false
      }
      await sleep(250)
    }
  }
  const clickBy = (containerSel, text, byAria) =>
    evalJs(`(() => {
      const c = document.querySelector(${JSON.stringify(containerSel)})
      const b = c && [...c.querySelectorAll('button')].find((x) => ${byAria ? `(x.getAttribute('aria-label')||'')` : `x.textContent.trim()`}.${byAria ? 'startsWith' : 'startsWith'}(${JSON.stringify(text)}))
      if (!b) return false
      b.click(); return true
    })()`)

  if (!(await waitFor('arranque', `document.querySelector('#root') && document.querySelector('#root').children.length > 0 && !!document.querySelector('nav[aria-label="Modo"]')`, 45000))) return failures
  log('#root montado')
  await sleep(SETTLE_MS)
  if (await check('arranque')) return failures

  if (process.env.SMOKE_FAULT) {
    await evalJs(`window.__onyxE2E.throwIn(${JSON.stringify(process.env.SMOKE_FAULT)})`)
    await sleep(SETTLE_MS)
    if (await check('fallo inyectado')) return failures
    fail('fallo inyectado', 'el fallo inyectado NO produjo el fallback del ErrorBoundary')
    return failures
  }

  const step = async (name, action, ready) => {
    log(name)
    lastStep = name
    if (!(await action())) {
      fail(name, 'no se encontró el elemento a pulsar')
      return false
    }
    await sleep(SETTLE_MS)
    if (ready && !(await waitFor(name, ready))) return false
    return !(await check(name))
  }

  for (const mode of ['Chat', 'Code', 'Tareas', 'Rutinas', 'Chat']) {
    const ok = await step(`modo ${mode}`, () => clickBy('nav[aria-label="Modo"]', mode), `document.querySelector('nav[aria-label="Modo"] button[aria-current="page"]')?.textContent.trim().startsWith(${JSON.stringify(mode)})`)
    if (!ok) return failures
  }
  if (!(await step('Ajustes', () => clickBy('body', 'Ajustes (', true), `!!document.querySelector('nav[aria-label="Secciones de ajustes"]')`))) return failures
  const sections = await evalJs(`[...document.querySelectorAll('nav[aria-label="Secciones de ajustes"] button')].map((b) => b.textContent.trim())`)
  if (sections.length < 5) fail('Ajustes', `pocas secciones: ${JSON.stringify(sections)}`)
  for (const s of sections) {
    const ok = await step(`Ajustes > ${s}`, () => clickBy('nav[aria-label="Secciones de ajustes"]', s), `document.querySelector('nav[aria-label="Secciones de ajustes"] button[aria-current="page"]')?.textContent.trim() === ${JSON.stringify(s)}`)
    if (!ok) return failures
  }
  if (!(await step('cerrar Ajustes', () => clickBy('body', 'Cerrar ajustes', true), `!document.querySelector('nav[aria-label="Secciones de ajustes"]')`))) return failures
  await sleep(500)
  await check('final')
  ws.close()
  return failures
}

let code = 0
const guard = setTimeout(() => {
  fail('timeout', `superados ${TIMEOUT_MS / 1000}s (último paso: ${lastStep})`)
  report()
  void finish(1)
}, TIMEOUT_MS + 5000)
function report() {
  console.error(`\ntest:smoke FALLÓ (${secs()}s): ${failures.length} problema(s)\n`)
  const seen = new Set()
  for (const f of failures) {
    const k = f.kind + f.detail
    if (seen.has(k)) continue
    seen.add(k)
    console.error(`  ✗ ${f.kind}\n    ${f.detail.split('\n').join('\n    ')}\n`)
  }
}
try {
  await main()
} catch (e) {
  fail('smoke', e?.message ?? e)
}
clearTimeout(guard)
if (failures.length) {
  report()
  code = 1
} else console.log(`test:smoke OK en ${secs()}s`)
await finish(code)
