// Arranque/parada de la app Electron real con un OpenCode falso (gestionado por la propia app vía OPENCODE_BIN).
//
// Modos (E2E_MODE):
//  - dev  (defecto): renderer servido por Vite (ELECTRON_RENDERER_URL, import.meta.env.DEV=true → ganchos `__onyxE2E`).
//  - prod: sin ELECTRON_RENDERER_URL; carga por onyxcode://app con la CSP real (sin ganchos: solo humo).
// Variables: E2E_DEBUG=1 (vuelca stdout/stderr de main), E2E_VISIBLE=1 (ventana visible), E2E_RENDERER_URL (la fija global-setup), E2E_KEEP=1 (no borra userData tmp), E2E_HEADLESS no existe:
// la ventana se crea con show:false salvo que main la muestre (ready-to-show la muestra; es normal).
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { FakeClient } from './fake'
import { alive, FAKE_BIN_NAME, killByCommandLine, killTree, PATH_SEP } from './proc'
import type { FakeAuth } from './fake-auth'

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
  /** userData a reutilizar (p. ej. reiniciar la app con el mismo estado). Por defecto, un tmp nuevo. `settings.json` solo se escribe si falta. */
  userData?: string
  /** No borra el userData al parar (quien lo pidió lo limpia). */
  keepUserData?: boolean
  /**
   * No espera al servidor de OpenCode ni al falso (p. ej. `OPENCODE_BIN` inexistente a propósito). `app.fake` falla hasta que
   * se llame a `app.connectFake()`.
   */
  noServer?: boolean
  /**
   * Cuenta: apunta la app al servidor de cuentas falso (`ONYXCODE_ACCOUNT_URL`, solo sin empaquetar) y usa el almacén de
   * sesión en claro de prueba (`ONYXCODE_TEST_PLAIN_STORE`; nunca el Llavero). Sin esta opción la cuenta queda APAGADA
   * (`ONYXCODE_ACCOUNT_DISABLED=1`) y los E2E no dependen del login.
   */
  account?: {
    fake: FakeAuth
    /** Por defecto true: siembra una sesión válida en el falso y en `userData` para que la app abra directa. false = pantalla de acceso. */
    signedIn?: boolean
    email?: string
    provider?: 'google' | 'email'
    /** Antigüedad de la última validación sembrada (ms). Por defecto 0 (ahora); >30 días deja fuera de gracia. */
    lastValidationAgoMs?: number
  }
}

export interface E2EApp {
  mode: 'dev' | 'prod'
  electronApp: ElectronApplication
  page: Page
  /** Cliente del falso; con `noServer` lanza hasta llamar a `connectFake()`. */
  readonly fake: FakeClient
  /** Conecta con el falso ya en marcha (tal como lo ve el renderer) y lo deja en `app.fake`. */
  connectFake(): Promise<FakeClient>
  keepUserData: boolean
  userData: string
  errors: CollectedError[]
  /** Errores no cubiertos por la lista blanca. */
  unexpectedErrors(): CollectedError[]
  /** Falla (con captura y unknown-routes del fake adjuntos en e2e/.artifacts) si hay errores no permitidos. */
  assertClean(label: string): Promise<void>
  screenshot(name: string): Promise<string>
  stop(): Promise<void>
}

/** Mata cualquier proceso cuyo argv mencione el userData tmp (Electron, helpers y el falso, que va en su propio grupo). */
function killByUserData(userData: string): void {
  killByCommandLine(userData)
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
        if (pid) killTree(pid)
      } catch {
        /* ya muerto */
      }
      killByUserData(a.userData)
      if (process.env.E2E_KEEP !== '1' && !a.keepUserData) rmSync(a.userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
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
  const userData = opts.userData ?? realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-')))
  const removeUserData = process.env.E2E_KEEP !== '1' && !opts.keepUserData
  const xdg = (n: string): string => {
    const d = join(userData, 'xdg', n)
    mkdirSync(d, { recursive: true })
    return d
  }
  // settings.json ANTES de arrancar: si falta, `migrateLegacyUserData` movería datos reales de Lapis/OpenDesk.
  if (!existsSync(join(userData, 'settings.json')))
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        defaultModel: { providerID: 'fake', modelID: 'fake-model' },
        theme: 'system',
        recentFolders: [],
        tasksGlobalInstructions: '',
        // Sin el asistente de primer uso (los specs existentes no lo esperan); `onboarding.e2e.ts` lo desactiva.
        onboarded: true,
        // Aviso de Rutinas ya reconocido (si no, las rutinas no se ejecutan solas y activar pide el diálogo);
        // `routines-terms.e2e.ts` lo pone en false.
        routinesTermsAcknowledged: true,
        // Los specs esperan la interfaz en español; `i18n.e2e.ts` arranca en `en`.
        language: 'es',
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
  // En Windows la variable puede llamarse `Path`: se unifica para que no haya dos claves distintas.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const pathVal = env[pathKey] ?? ''
  if (pathKey !== 'PATH') delete env[pathKey]
  env.PATH = [dirname(process.execPath), pathVal].join(PATH_SEP)
  Object.assign(env, {
    OPENCODE_BIN: join(fakeDir, FAKE_BIN_NAME),
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
  if (opts.account) {
    env.ONYXCODE_ACCOUNT_URL = opts.account.fake.url
    delete env.ONYXCODE_ACCOUNT_DISABLED
    env.ONYXCODE_TEST_PLAIN_STORE = '1'
  } else {
    // Nunca heredar una cuenta del entorno del runner: por defecto la cuenta está apagada (ACCOUNT_API ya está
    // definido en brand.ts; `ONYXCODE_ACCOUNT_DISABLED` solo se honra sin empaquetar).
    env.ONYXCODE_ACCOUNT_DISABLED = '1'
    delete env.ONYXCODE_ACCOUNT_URL
    delete env.ONYXCODE_TEST_PLAIN_STORE
  }
  if (opts.account && opts.account.signedIn !== false && !existsSync(join(userData, 'account.test.json'))) {
    const email = opts.account.email ?? 'sembrada@example.test'
    const provider = opts.account.provider ?? 'email'
    const { token } = await opts.account.fake.seed({ email, provider })
    writeFileSync(
      join(userData, 'account.test.json'),
      JSON.stringify({ token, email, provider, lastValidation: Date.now() - (opts.account.lastValidationAgoMs ?? 0) })
    )
  }
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
        args: [
          // Windows (sesión SSH sin escritorio): sin esto Chromium da las ventanas por ocultas/tapadas y descarta la entrada de CDP
          // en las vistas incrustadas (WebContentsView). Solo pruebas: la app no cambia.
          ...(process.platform === 'win32' ? ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'] : []),
          // macOS: llavero falso en memoria (como hace Playwright). Sin esto el Electron de desarrollo, que se llama como la app, pide en
          // cada arranque acceso a la clave REAL «<app> Safe Storage» del Llavero del usuario y sale el aviso «Llavero no encontrado».
          ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
          join(ROOT, 'out/main/index.js'),
          `--user-data-dir=${userData}`
        ],
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
    if (removeUserData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    throw lastErr
  }
  const launched: ElectronApplication = electronApp
  // Se guarda ahora: tras cerrarse la app (p. ej. la ventana cierra y sale en Windows) `process()` ya no se puede consultar.
  const launchedPid = launched.process().pid

  const cleanup = async (): Promise<void> => {
    const pid = launchedPid
    await Promise.race([launched.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))])
    if (pid && alive(pid)) killTree(pid)
    killByUserData(userData)
    if (removeUserData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
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
    // En Windows por SSH (sin escritorio) la pantalla virtual es de 1024x768 y Electron recorta la ventana de 1280x820 a ~1008x703:
    // el panel lateral de Code taparía los botones de la barra superior. Se restituye el tamaño de diseño (no cambia nada en la Mac).
    if (process.platform === 'win32') {
      await launched
        .evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows()) {
            const [cw] = w.getContentSize()
            if (w.getParentWindow() === null && cw >= 700 && cw < 1280 && !/quick|pill|overlay|assist|guide|record/i.test(w.webContents.getURL())) w.setContentSize(1264, 760)
          }
        })
        .catch(() => undefined)
    }
    if (MODE === 'dev') {
      // Ganchos: flag + reinicio de carga para que main.tsx lo lea. Los errores previos a esto no se recogen.
      const ls = { 'onyx.e2e': '1', 'onyx.langPref': String(opts.settings?.language ?? 'es'), ...opts.localStorage }
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
    // Con la cuenta exigida y sin sesión válida la app no se monta: se espera la pantalla de acceso (o la app, si hay sesión).
    await page
      .locator(
        opts.account
          ? 'nav[aria-label="Modo"], nav[aria-label="Mode"], [data-testid="account-gate"]'
          : 'nav[aria-label="Modo"], nav[aria-label="Mode"]'
      )
      .first()
      .waitFor({ timeout: 60_000 })

    let fake: FakeClient | null = null
    const connectFake = async (): Promise<FakeClient> => {
      fake = await connectFakeClient(page)
      return fake
    }
    if (!opts.noServer) await connectFake()

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
      get fake(): FakeClient {
        if (!fake) throw new Error('app.fake no disponible: arranque con noServer; llama a app.connectFake() primero')
        return fake
      },
      connectFake,
      keepUserData: !removeUserData,
      userData,
      errors,
      unexpectedErrors,
      async assertClean(label) {
        const bad = unexpectedErrors()
        if (!bad.length) return
        const shot = await screenshot(label)
        const unknown = (await fake?.unknownRoutes().catch(() => [])) ?? []
        const detail = { errors: bad, unknownRoutes: unknown }
        writeFileSync(join(ARTIFACTS_DIR, `${label.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(detail, null, 2))
        throw new Error(
          `Errores no permitidos (${bad.length}) en "${label}" (captura: ${shot}; unknown-routes: ${unknown.length}):\n` +
            bad.map((e) => `  [${e.source}] ${e.text}`).join('\n')
        )
      },
      screenshot,
      async stop() {
        if (!live.has(app)) return // idempotente: un spec puede parar la app antes que el afterAll del arnés
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

/** Conexión al falso tal como la ve el renderer (IPC real; sirve también en prod, sin ganchos). Verifica auth y que es el falso. */
export async function connectFakeClient(page: Page): Promise<FakeClient> {
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
  await fake.status()
  return fake
}

/** Fija el tope LRU de sesiones (`localStorage['onyx.lru.max']`) y recarga la ventana. Solo modo dev. */
export async function withLru(app: E2EApp, n: number): Promise<void> {
  await app.page.evaluate((v) => localStorage.setItem('onyx.lru.max', String(v)), n)
  await app.page.reload({ waitUntil: 'domcontentloaded' })
  await app.page.waitForFunction(() => Boolean((window as unknown as { __onyxE2E?: object }).__onyxE2E), undefined, { timeout: 60_000 })
  await app.page.locator('nav[aria-label="Modo"]').waitFor()
}

