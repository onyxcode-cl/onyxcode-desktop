// Arranque/parada de la app Electron real con un OpenCode falso (gestionado por la propia app vía OPENCODE_BIN).
//
// Modos (E2E_MODE):
//  - dev  (defecto): renderer servido por Vite (ELECTRON_RENDERER_URL, import.meta.env.DEV=true → ganchos `__onyxE2E`).
//  - prod: sin ELECTRON_RENDERER_URL; carga por onyxcode://app con la CSP real (sin ganchos: solo humo).
// Variables: E2E_DEBUG=1 (vuelca stdout/stderr de main), E2E_VISIBLE=1 (ventana visible), E2E_RENDERER_URL (la fija global-setup), E2E_KEEP=1 (no borra userData tmp), E2E_HEADLESS no existe:
// la ventana se crea con show:false salvo que main la muestre (ready-to-show la muestra; es normal).
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { FakeClient } from './fake'

const require = createRequire(import.meta.url)
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const MODE: 'dev' | 'prod' = process.env.E2E_MODE === 'prod' ? 'prod' : 'dev'
const LAUNCH_ATTEMPTS = Number(process.env.E2E_LAUNCH_ATTEMPTS ?? 6)
const LAUNCH_TIMEOUT_MS = Number(process.env.E2E_LAUNCH_TIMEOUT_MS ?? 8_000)
const FAKE_DIR = join(ROOT, 'e2e', 'fake-opencode')
export const ARTIFACTS_DIR = join(ROOT, 'e2e', '.artifacts')

export interface AllowEntry {
  pattern: string
  reason: string
}
export interface CollectedError {
  source: 'console' | 'pageerror' | 'main'
  text: string
}

/** Patrones de stdout/stderr de main que cuentan como error. */
const MAIN_PATTERNS = [
  /\[ipc\] canales sin esquema/,
  /Pre-transform error/,
  /Internal server error/,
  /Uncaught/,
  /UnhandledPromiseRejection/
]

function loadAllowlist(): RegExp[] {
  const file = join(ROOT, 'e2e', 'allowlist.json')
  const list = JSON.parse(readFileSync(file, 'utf8')) as AllowEntry[]
  for (const e of list) if (!e.pattern || !e.reason) throw new Error(`allowlist.json: entrada sin pattern/reason: ${JSON.stringify(e)}`)
  return list.map((e) => new RegExp(e.pattern))
}

export interface LaunchOptions {
  /** Entradas de localStorage adicionales (antes de cargar la app). */
  localStorage?: Record<string, string>
  /** Variables de entorno extra para la app. */
  env?: Record<string, string>
  /** Settings adicionales sobre el mínimo (defaultModel del fake). */
  settings?: Record<string, unknown>
}

export interface E2EApp {
  mode: 'dev' | 'prod'
  electronApp: ElectronApplication
  page: Page
  fake: FakeClient
  userData: string
  errors: CollectedError[]
  /** Errores no cubiertos por la lista blanca. */
  unexpectedErrors(): CollectedError[]
  /** Falla (con captura y unknown-routes del fake adjuntos en e2e/.artifacts) si hay errores no permitidos. */
  assertClean(label: string): Promise<void>
  screenshot(name: string): Promise<string>
  stop(): Promise<void>
}

function descendants(pid: number): number[] {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    const kids = out.split('\n').filter(Boolean).map(Number)
    return kids.flatMap((k) => [k, ...descendants(k)])
  } catch {
    return []
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Mata cualquier proceso cuyo argv mencione el userData tmp (Electron, helpers y el falso, que va en su propio grupo). */
function killByUserData(userData: string): void {
  try {
    execFileSync('pkill', ['-KILL', '-f', userData])
  } catch {
    /* pkill sale 1 si no hay coincidencias */
  }
}

// Registro global para limpiar aunque el proceso del test muera.
const live = new Set<E2EApp>()
let hooked = false
function hookExit(): void {
  if (hooked) return
  hooked = true
  const sweep = (): void => {
    for (const a of live) {
      try {
        const pid = a.electronApp.process().pid
        if (pid) for (const p of [pid, ...descendants(pid)]) process.kill(p, 'SIGKILL')
      } catch {
        /* ya muerto */
      }
      killByUserData(a.userData)
      if (process.env.E2E_KEEP !== '1') rmSync(a.userData, { recursive: true, force: true })
    }
  }
  process.on('exit', sweep)
  for (const s of ['SIGINT', 'SIGTERM'] as const)
    process.on(s, () => {
      sweep()
      process.exit(130)
    })
}

export async function startApp(opts: LaunchOptions = {}): Promise<E2EApp> {
  hookExit()
  const allow = loadAllowlist()
  // realpath: /var → /private/var en macOS; el falso decide `isMain` comparando import.meta.url con argv[1] sin resolver symlinks.
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-')))
  const xdg = (n: string): string => {
    const d = join(userData, 'xdg', n)
    mkdirSync(d, { recursive: true })
    return d
  }
  // settings.json ANTES de arrancar: si falta, `migrateLegacyUserData` movería datos reales de Lapis/OpenDesk.
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      defaultModel: { providerID: 'fake', modelID: 'fake-model' },
      theme: 'system',
      recentFolders: [],
      coworkGlobalInstructions: '',
      ...opts.settings
    })
  )

  // Copia del falso fuera de ~/Documents: el sidecar corre «desvinculado de TCC» (disclaim) y macOS le niega
  // leer scripts dentro de carpetas protegidas (sh: Operation not permitted, code=126).
  const fakeDir = join(userData, 'fake-opencode')
  mkdirSync(fakeDir, { recursive: true })
  for (const f of ['opencode', 'server.mjs']) cpSync(join(FAKE_DIR, f), join(fakeDir, f))

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  env.PATH = [dirname(process.execPath), env.PATH ?? ''].join(':')
  Object.assign(env, {
    OPENCODE_BIN: join(fakeDir, 'opencode'),
    XDG_DATA_HOME: xdg('data'),
    XDG_CONFIG_HOME: xdg('config'),
    XDG_CACHE_HOME: xdg('cache'),
    XDG_STATE_HOME: xdg('state'),
    OPENCODE_SIDECAR_LOG: '1',
    FAKE_OPENCODE_HEARTBEAT_MS: '0',
    // Sin ventanas visibles ni icono extra en el Dock (main/e2e-headless.ts). E2E_VISIBLE=1 lo desactiva.
    ...(process.env.E2E_VISIBLE === '1' ? {} : { ONYXCODE_E2E_HEADLESS: '1' }),
    ...opts.env
  })
  if (MODE === 'dev') {
    const url = process.env.E2E_RENDERER_URL
    if (!url) throw new Error('E2E_RENDERER_URL no definida (¿globalSetup no corrió?)')
    env.ELECTRON_RENDERER_URL = url
  }

  const errors: CollectedError[] = []
  let electronApp: ElectronApplication | undefined
  let lastErr: unknown
  // `_electron.launch` de Playwright se cuelga de forma intermitente con esta app (ventanas creadas mientras
  // Playwright se adjunta: `_waitForAllPagesToBeInitialized`); un intento sano tarda <3 s. Se reintenta con
  // timeout corto en vez de esperar el timeout completo.
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS && !electronApp; attempt++) {
    try {
      electronApp = await _electron.launch({
        executablePath: require('electron') as string,
        args: [join(ROOT, 'out/main/index.js'), `--user-data-dir=${userData}`],
        cwd: ROOT,
        env,
        timeout: LAUNCH_TIMEOUT_MS
      })
    } catch (err) {
      lastErr = err
      console.warn(`[e2e] electron.launch intento ${attempt}/${LAUNCH_ATTEMPTS} falló (${String(err).split('\n')[0]})`)
      killByUserData(userData)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!electronApp) {
    if (process.env.E2E_KEEP !== '1') rmSync(userData, { recursive: true, force: true })
    throw lastErr
  }
  const launched: ElectronApplication = electronApp

  const cleanup = async (): Promise<void> => {
    const pid = launched.process().pid
    const kids = pid ? descendants(pid) : []
    await Promise.race([launched.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))])
    for (const p of [...(pid ? [pid] : []), ...kids]) if (alive(p)) try { process.kill(p, 'SIGKILL') } catch { /* */ }
    killByUserData(userData)
    if (process.env.E2E_KEEP !== '1') rmSync(userData, { recursive: true, force: true })
  }

  try {
    // stdout/stderr de main, por líneas.
    for (const stream of [launched.process().stdout, launched.process().stderr]) {
      let buf = ''
      stream?.on('data', (d: Buffer) => {
        if (process.env.E2E_DEBUG === '1') process.stderr.write(`[main] ${d.toString()}`)
        buf += d.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) if (MAIN_PATTERNS.some((p) => p.test(line))) errors.push({ source: 'main', text: line })
      })
    }
    const watched = new WeakSet<Page>()
    const watch = (p: Page): void => {
      if (watched.has(p)) return
      watched.add(p)
      p.on('console', (m) => {
        if (m.type() === 'error') errors.push({ source: 'console', text: `${m.text()} (${m.location().url}:${m.location().lineNumber})` })
      })
      p.on('pageerror', (e) => errors.push({ source: 'pageerror', text: e.stack ?? e.message }))
    }
    launched.on('window', watch)
    launched.windows().forEach(watch) // la ventana puede existir ya al volver de launch

    const page = await launched.firstWindow({ timeout: 60_000 })
    await page.waitForLoadState('domcontentloaded')
    if (MODE === 'dev') {
      // Ganchos: flag + reinicio de carga para que main.tsx lo lea. Los errores previos a esto no se recogen.
      const ls = { 'onyx.e2e': '1', ...opts.localStorage }
      await page.evaluate((entries) => {
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
      }, ls)
      errors.length = 0
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean((window as unknown as { __onyxE2E?: object }).__onyxE2E), undefined, { timeout: 60_000 })
    } else if (opts.localStorage) {
      await page.evaluate((entries) => {
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
      }, opts.localStorage)
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    await page.locator('nav[aria-label="Modo"]').waitFor({ timeout: 60_000 })

    // Conexión al fake tal como la ve el renderer (IPC real; sirve también en prod, sin ganchos).
    const conn = await page.evaluate(async () => {
      const w = window as unknown as { api: { invoke: (c: string) => Promise<{ ok: boolean; data: { baseUrl: string; authorization: string } }> } }
      for (let i = 0; i < 300; i++) {
        const r = await w.api.invoke('opencode:connection')
        if (r.ok && r.data) return r.data
        await new Promise((res) => setTimeout(res, 200))
      }
      throw new Error('opencode:connection sin respuesta')
    })
    const fake = new FakeClient(conn)
    await fake.status() // verifica auth y que es el falso

    const unexpectedErrors = (): CollectedError[] => errors.filter((e) => !allow.some((re) => re.test(e.text)))
    const screenshot = async (name: string): Promise<string> => {
      mkdirSync(ARTIFACTS_DIR, { recursive: true })
      const file = join(ARTIFACTS_DIR, `${name.replace(/[^\w.-]+/g, '_')}.png`)
      await page.screenshot({ path: file }).catch(() => undefined)
      return file
    }
    const app: E2EApp = {
      mode: MODE,
      electronApp: launched,
      page,
      fake,
      userData,
      errors,
      unexpectedErrors,
      async assertClean(label) {
        const bad = unexpectedErrors()
        if (!bad.length) return
        const shot = await screenshot(label)
        const unknown = await fake.unknownRoutes().catch(() => [])
        const detail = { errors: bad, unknownRoutes: unknown }
        writeFileSync(join(ARTIFACTS_DIR, `${label.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(detail, null, 2))
        throw new Error(
          `Errores no permitidos (${bad.length}) en "${label}" (captura: ${shot}; unknown-routes: ${unknown.length}):\n` +
            bad.map((e) => `  [${e.source}] ${e.text}`).join('\n')
        )
      },
      screenshot,
      async stop() {
        live.delete(app)
        await cleanup()
      }
    }
    live.add(app)
    return app
  } catch (err) {
    await cleanup()
    throw err
  }
}

/** Fija el tope LRU de sesiones (`localStorage['onyx.lru.max']`) y recarga la ventana. Solo modo dev. */
export async function withLru(app: E2EApp, n: number): Promise<void> {
  await app.page.evaluate((v) => localStorage.setItem('onyx.lru.max', String(v)), n)
  await app.page.reload({ waitUntil: 'domcontentloaded' })
  await app.page.waitForFunction(() => Boolean((window as unknown as { __onyxE2E?: object }).__onyxE2E), undefined, { timeout: 60_000 })
  await app.page.locator('nav[aria-label="Modo"]').waitFor()
}

