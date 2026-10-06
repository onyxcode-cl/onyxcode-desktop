#!/usr/bin/env node
// Capturas REALES de la interfaz de escritorio (Electron) con el motor falso. Ver docs/CAPTURAS-ESCRITORIO.md.
// Arranca la app compilada (`out/`, carga por lazunox://app) con un userData TEMPORAL, un OpenCode falso y datos inventados;
// captura por CDP (`Page.captureScreenshot`, 2x). No toca la app instalada, su userData, su cloudflared ni el motor real.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIN = process.platform === 'win32'
// macOS: /private/tmp (como siempre; Tareas rechaza carpetas de sistema y tmpdir() de macOS cuelga de /var/folders). Windows: tmpdir().
const TMP = WIN ? tmpdir() : '/private/tmp'
const DEFAULT_OUT = WIN ? join(tmpdir(), 'shots-desktop') : '/private/tmp/claude-501/-Users-ben/0f2b5c02-144e-41f9-8c7c-156d39453861/scratchpad/shots-desktop'
const SCENARIOS = [
  'onboarding', 'onboarding-inicio', 'chat-vacio', 'chat-conversacion', 'chat-herramientas', 'code-proyecto', 'code-diff', 'code-terminal',
  'code-permiso',
  // El orden dentro del grupo de Tareas importa (se respeta aunque se pidan en otro): `tareas-primer-uso` va primero (antes de
  // descartar la tarjeta), `tareas-nueva` y `rutinas-vacio` antes de crear tareas o rutinas, y `tareas-buscar`/`-archivadas` tras la lista.
  'tareas-primer-uso', 'tareas-nueva', 'tareas-lista', 'tareas-buscar', 'tareas-archivadas', 'tareas-en-curso', 'tareas-permiso', 'tareas-permiso-neutral', 'tareas-permiso-largo',
  'rutinas-vacio', 'rutinas', 'rutinas-detalle', 'rutinas-editor', 'ajustes-general', 'ajustes-modelos', 'ajustes-celular',
  'paleta', 'selector-modelo', 'dialogo-confirmar', 'comparar', 'barra-lateral-colapsada',
  'kit' // kit de UI (app/dev/UiKit.tsx): NO va en la tanda por defecto; se pide con --scenario kit
]
const SIZES = { '1280x800': [1280, 800], '1000x700': [1000, 700] }
// Sin --size: 1280x800 para todo y 1000x700 solo para chat y ajustes.
const SMALL_ALSO = /^(chat-|ajustes-)/
const TOTAL_TIMEOUT_MS = 330_000

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const out = resolve(arg('out') ?? DEFAULT_OUT)
const sel = arg('scenario')
const themes = arg('theme') ? [arg('theme')] : ['dark', 'light']
const sizeSel = arg('size')
// --forced-colors: emula `forced-colors: active` (alto contraste) por CDP; --dsf <factor>: escala del dispositivo (por defecto 2).
const forcedColors = process.argv.includes('--forced-colors')
const dsfArg = arg('dsf')
const DPR = dsfArg === undefined ? 2 : Number(dsfArg)
if (!(DPR >= 0.5 && DPR <= 4)) throw new Error('--dsf <factor entre 0.5 y 4>')
// Sufijos de salida: `-win` en Windows (no se mezclan con las de Mac), `-fc` con alto contraste y `-dsf<n>` con otra escala.
const SFX = `${WIN ? '-win' : ''}${forcedColors ? '-fc' : ''}${dsfArg === undefined ? '' : `-dsf${dsfArg}`}`
// --reduced-motion: prueba la regla REAL de prefers-reduced-motion (no inyecta el estilo que apaga animaciones; sin la bandera
// se emula igual `reduce` pero además se apagan todas, para capturas deterministas).
const realReducedMotion = process.argv.includes('--reduced-motion')
const selList = sel ? sel.split(',') : null
for (const x of selList ?? []) if (!SCENARIOS.includes(x)) throw new Error(`escenario desconocido: ${x} (${SCENARIOS.join('|')})`)
if (arg('theme') && !['dark', 'light'].includes(arg('theme'))) throw new Error('--theme dark|light')
if (sizeSel && !SIZES[sizeSel]) throw new Error(`--size ${Object.keys(SIZES).join('|')}`)
const scenarios = selList ?? SCENARIOS.filter((s) => s !== 'kit')
const sizesFor = (sc) => (sizeSel ? [sizeSel] : SMALL_ALSO.test(sc) ? ['1280x800', '1000x700'] : ['1280x800'])
mkdirSync(out, { recursive: true })

if (!existsSync(join(repo, 'out/main/index.js'))) throw new Error('Falta out/: compila antes con `npx electron-vite build`.')

// ---- carpetas temporales (todas con prefijo propio: la limpieza solo toca lo suyo) ----
const TAG = `lazunox-shotd-${process.pid}-`
const tmpDirs = []
const mk = (base, name) => {
  const d = realpathSync(mkdtempSync(join(base, TAG + name)))
  tmpDirs.push(d)
  return d
}
const binDir = mk(TMP, 'bin-') // el sandbox de Tareas no puede leer userData: el falso va fuera
for (const f of ['opencode', 'server.mjs']) cpSync(join(repo, 'e2e/fake-opencode', f), join(binDir, f))
// Windows no ejecuta el script sh ni un .cmd directo: la app lanza el falso `.mjs` con node (src/main/opencode/test-launcher.ts).
const FAKE_BIN = join(binDir, WIN ? 'server.mjs' : 'opencode')
const home = homedir()
// Tareas rechaza carpetas de sistema (/private, /tmp): su carpeta tiene que colgar del home.
const taskFolder = join(mk(home, 'tareas-'), 'Informes')
mkdirSync(taskFolder, { recursive: true })
const codeRepo = join(mk(TMP, 'repo-'), 'tienda-web')
mkdirSync(codeRepo, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'ignore' })

function seedRepo(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'demo@example.com')
  git(dir, 'config', 'user.name', 'Demo')
  git(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), '# Tienda web\n\nTienda de ejemplo.\n')
  writeFileSync(join(dir, 'src/carrito.ts'), 'export function total(items: { precio: number; cantidad: number }[]): number {\n  let t = 0\n  for (const i of items) t += i.precio * i.cantidad\n  return t\n}\n')
  writeFileSync(join(dir, 'src/precios.ts'), "export const IVA = 0.19\nexport const redondear = (n: number): number => Math.round(n)\n")
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "tienda-web",\n  "version": "1.0.0"\n}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'Version inicial de la tienda')
  // Cambios sin confirmar: alimentan el panel «Cambios» de Code.
  writeFileSync(join(dir, 'src/carrito.ts'), 'import { IVA, redondear } from "./precios"\n\nexport function total(items: { precio: number; cantidad: number }[]): number {\n  let t = 0\n  for (const i of items) t += i.precio * i.cantidad\n  return redondear(t * (1 + IVA))\n}\n\nexport function vacio(items: unknown[]): boolean {\n  return items.length === 0\n}\n')
  writeFileSync(join(dir, 'src/nuevo.ts'), 'export const ENVIO_GRATIS_DESDE = 30000\n')
}

// ---- procesos: solo los que mencionan nuestros temporales (prefijo con el pid de ESTE node) ----
function myPids() {
  try {
    const rows = WIN
      ? execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'],
          { encoding: 'utf8', maxBuffer: 64 << 20 }
        ).split('\n')
      : execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
    return rows
      .filter((r) => r.includes(TAG) && !r.includes('ps -axo') && !r.includes('Get-CimInstance'))
      .map((r) => Number(r.trim().split(/\s+/)[0]))
      .filter((p) => p && p !== process.pid)
  } catch {
    return []
  }
}
function killMine() {
  for (const p of myPids()) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* ya muerto */
    }
  }
}

let current = null // { electronApp, userData }
let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  try {
    const pid = current?.electronApp.process().pid
    await Promise.race([current?.electronApp.close().catch(() => {}), sleep(5000)])
    if (pid) process.kill(pid, 'SIGKILL')
  } catch {
    /* ya cerrado */
  }
  killMine()
  await sleep(300)
  killMine()
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
const watchdog = setTimeout(async () => {
  console.error('Tiempo total agotado: se cierra todo.')
  await cleanup()
  process.exit(2)
}, TOTAL_TIMEOUT_MS)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(130)))
process.on('exit', () => {
  if (!cleaned) {
    killMine()
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  }
})

// ---- arranque de la app ----
async function launch(name, { settings = {}, env = {}, noServer = false } = {}) {
  const userData = mk(TMP, `ud-${name}-`)
  const xdg = (n) => {
    const d = join(userData, 'xdg', n)
    mkdirSync(d, { recursive: true })
    return d
  }
  // settings.json ANTES de arrancar: si falta, la app migraría datos reales de versiones anteriores.
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      defaultModel: { providerID: 'fake', modelID: 'fake-model' },
      theme: 'system',
      recentFolders: [],
      tasksGlobalInstructions: '',
      onboarded: true,
      routinesTermsAcknowledged: true,
      language: 'es',
      ...settings
    })
  )
  const e = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') e[k] = v
  delete e.ELECTRON_RUN_AS_NODE
  delete e.ELECTRON_RENDERER_URL
  // En Windows la variable es `Path`: escribir `PATH` crearia una segunda y se perderia el PATH del usuario (sin git).
  const pathKey = Object.keys(e).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  e[pathKey] = [dirname(process.execPath), e[pathKey] ?? ''].join(delimiter)
  Object.assign(e, {
    OPENCODE_BIN: FAKE_BIN,
    XDG_DATA_HOME: xdg('data'),
    XDG_CONFIG_HOME: xdg('config'),
    XDG_CACHE_HOME: xdg('cache'),
    XDG_STATE_HOME: xdg('state'),
    FAKE_OPENCODE_HEARTBEAT_MS: '0',
    LAZUNOX_E2E_HEADLESS: '1', // sin ventana visible ni icono en el Dock
    ...env
  })
  let electronApp
  let lastErr
  for (let attempt = 1; attempt <= 5 && !electronApp; attempt++) {
    try {
      electronApp = await _electron.launch({
        executablePath: require('electron'),
        args: ['--use-mock-keychain', join(repo, 'out/main/index.js'), `--user-data-dir=${userData}`],
        cwd: repo,
        env: e,
        timeout: 10_000
      })
    } catch (err) {
      lastErr = err
      killMine()
      await sleep(500)
    }
  }
  if (!electronApp) throw lastErr
  current = { electronApp, userData }
  const page = await electronApp.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.locator('nav[aria-label="Modo"]').first().waitFor({ timeout: 60_000 }).catch(() => {})
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const ctx = { electronApp, page, cdp, userData, fake: null }
  if (!noServer) ctx.fake = await connectFake(page)
  return ctx
}

async function stop(ctx) {
  const pid = ctx.electronApp.process().pid
  await Promise.race([ctx.electronApp.close().catch(() => {}), sleep(8000)])
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* ya cerrado */
  }
  killMine()
  current = null
}

// Cliente mínimo del control `/__e2e/*` del falso (misma auth Basic que el sidecar).
async function connectFake(page, channel = 'opencode:connection') {
  const conn = await page.evaluate(async (ch) => {
    for (let i = 0; i < 300; i++) {
      const r = await window.api.invoke(ch)
      if (r.ok && r.data) return r.data
      await new Promise((res) => setTimeout(res, 200))
    }
    throw new Error(`${ch} sin respuesta`)
  }, channel)
  return fakeClient(conn)
}
function fakeClient(conn) {
  const call = async (method, path, body) => {
    const res = await fetch(`${conn.baseUrl}/__e2e/${path}`, {
      method,
      headers: { authorization: conn.authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`fake ${method} ${path} -> ${res.status}`)
    return res.json()
  }
  return {
    conn,
    script: (b) => call('POST', 'script', b),
    emit: (b) => call('POST', 'emit', b),
    set: (b) => call('POST', 'set', b),
    reset: () => call('POST', 'reset', {})
  }
}

// ---- utilidades de interfaz ----
const MODE = (page) => page.locator('nav[aria-label="Modo"]')
const goMode = async (page, name) => {
  await MODE(page).getByRole('button', { name, exact: true }).click()
  await sleep(400)
}
const vis = (loc, timeout = 15_000) => loc.first().waitFor({ state: 'visible', timeout })
const press = (page, k) => page.keyboard.press(k)
async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await press(page, 'Escape')
    await sleep(120)
  }
}

async function stage(ctx, [w, h], theme) {
  const { cdp, electronApp, page } = ctx
  await electronApp.evaluate(({ BrowserWindow }, [cw, ch]) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.getParentWindow()) win.setContentSize(cw, ch)
  }, [w, h])
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: false })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }, ...(forcedColors ? [{ name: 'forced-colors', value: 'active' }] : [])] })
  const calm = realReducedMotion ? 'caret-color:transparent!important;scroll-behavior:auto!important' : 'transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important'
  await page.addStyleTag({ content: `*,*::before,*::after{${calm}}` }).catch(() => {})
  await parkMouse(ctx)
  await sleep(350)
}

// El ratón NO puede quedar encima de ningún elemento (un clic de un escenario deja el hover puesto): se saca de la ventana
// con un mouseMoved fuera del viewport y se comprueba que no queda ningún `:hover` salvo la raíz.
async function parkMouse(ctx) {
  for (let i = 0; i < 2; i++) {
    await ctx.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -20, y: -20, buttons: 0 }).catch(() => {})
    await sleep(60)
    const left = await ctx.page
      .evaluate(() => [...document.querySelectorAll(':hover')].filter((e) => !['HTML', 'BODY'].includes(e.tagName) && e.id !== 'root').length)
      .catch(() => 0)
    if (!left) return
  }
  notes.push('el ratón sigue sobre un elemento tras sacarlo de la ventana')
}

async function snap(ctx, name, theme, sizeKey) {
  await parkMouse(ctx)
  const { data } = await ctx.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = join(out, `${name}-${theme}-${sizeKey}${SFX}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

// ---- guiones del motor falso ----
const MD_LARGO = `## Plan para el carrito de compras

Revisé el módulo y propongo estos cambios. Hay **tres puntos** importantes y uno *opcional*:

1. Calcular el IVA al final, no por línea.
2. Redondear una sola vez (\`Math.round\`).
3. Agregar \`vacio()\` para mostrar el estado sin productos.

| Archivo | Cambio | Riesgo |
|---|---|---|
| \`src/carrito.ts\` | IVA al total | Bajo |
| \`src/precios.ts\` | Nueva constante \`IVA\` | Bajo |
| \`src/nuevo.ts\` | Umbral de envío gratis | Medio |

\`\`\`ts
import { IVA, redondear } from './precios'

export function total(items: Item[]): number {
  const neto = items.reduce((t, i) => t + i.precio * i.cantidad, 0)
  return redondear(neto * (1 + IVA))
}
\`\`\`

> Nota: los precios se guardan en pesos chilenos, sin decimales.

- [x] Pruebas unitarias existentes
- [ ] Prueba de envío gratis

Para probarlo ejecuta \`npm test\`. Si algo falla, avísame y lo reviso.`

const HERRAMIENTAS = [
  { type: 'text', text: 'Voy a revisar el proyecto y correr las pruebas.' },
  { type: 'tool', tool: 'read', input: { filePath: '/Users/demo/proyectos/tienda-web/src/carrito.ts' }, output: 'export function total() {}\n', title: 'src/carrito.ts' },
  { type: 'tool', tool: 'grep', input: { pattern: 'IVA', path: 'src' }, output: 'src/precios.ts:1:export const IVA = 0.19\n', title: 'IVA' },
  { type: 'tool', tool: 'bash', input: { command: 'npm test', description: 'Corre las pruebas' }, output: '> tienda-web@1.0.0 test\n> vitest run\n\n ✓ carrito.test.ts (4)\n ✓ precios.test.ts (2)\n\n Test Files  2 passed (2)\n      Tests  6 passed (6)\n', title: 'Corre las pruebas' },
  { type: 'tool', tool: 'edit', input: { filePath: 'src/carrito.ts', oldString: 'return t', newString: 'return redondear(t * (1 + IVA))' }, output: 'Edit applied successfully.', title: 'src/carrito.ts' },
  { type: 'text', text: 'Listo: las **6 pruebas** pasan y el total ahora incluye el IVA.' }
]

async function scriptChat(fake) {
  await fake.script({ match: 'plan del carrito', title: 'Plan del carrito de compras', steps: [{ type: 'text', text: MD_LARGO }] })
  await fake.script({ match: 'Ejecuta las pruebas', title: 'Pruebas y corrección del IVA', steps: HERRAMIENTAS })
  await fake.script({ match: 'receta de pan', title: 'Receta de pan casero', steps: [{ type: 'text', text: 'Mezcla 500 g de harina, 350 ml de agua tibia, 10 g de sal y 5 g de levadura. Reposa 12 horas y hornea a 230 °C por 35 minutos.' }] })
  await fake.script({ match: 'resumen semanal', title: 'Resumen semanal de ventas', steps: [{ type: 'text', text: 'Las ventas subieron un **12 %** frente a la semana anterior. El producto más vendido fue la polera negra.' }] })
}

const sendChat = async (page, text) => {
  const box = page.getByPlaceholder('Escribe un mensaje…')
  await box.fill(text)
  await page.getByRole('button', { name: 'Enviar' }).click()
}
async function newChat(page) {
  await goMode(page, 'Chat')
  await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
  await sleep(300)
}

// Conversaciones de muestra (llenan la barra lateral). Se hace una sola vez por arranque.
let chatsSeeded = false
async function seedChats(ctx) {
  if (chatsSeeded) return
  chatsSeeded = true
  const { page, fake } = ctx
  await scriptChat(fake)
  for (const [msg, done] of [
    ['Dame un resumen semanal de ventas', /subieron un 12/],
    ['Anota una receta de pan casero', /Mezcla 500 g/],
    ['Ejecuta las pruebas y corrige el IVA', /pruebas.*pasan/],
    ['Hazme el plan del carrito de compras', /Plan para el carrito/]
  ]) {
    await newChat(page)
    await sendChat(page, msg)
    await vis(page.getByText(done), 30_000)
    await sleep(500)
  }
}

// ---- escenarios: cada uno deja la pantalla lista y devuelve una función de limpieza opcional ----
async function openSettings(page, section) {
  await closeOverlays(page)
  await page.getByRole('button', { name: /^Ajustes/ }).first().click()
  await sleep(400)
  if (section) {
    await page.getByRole('navigation', { name: /Secciones de ajustes|Ajustes/ }).getByRole('button', { name: section }).first().click().catch(async () => {
      await page.getByRole('button', { name: section, exact: true }).first().click()
    })
    await sleep(500)
  }
}

const stubDialog = (ctx, openPaths) =>
  ctx.electronApp.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, openPaths)

const MODELS = [
  { id: 'fake/fake-model', name: 'Fake Model' },
  { id: 'fake/fake-reasoner', name: 'Fake Reasoner' }
]

async function armCompareAndAsk(page, text) {
  await newChat(page)
  await page.getByRole('button', { name: 'Comparar modelos…' }).click()
  const launcher = page.getByRole('dialog', { name: 'Comparar modelos' })
  await vis(launcher, 10_000)
  const opt = launcher.getByRole('option', { name: new RegExp(MODELS[1].name) })
  if ((await opt.getAttribute('aria-selected')) !== 'true') await opt.click()
  await launcher.getByRole('button', { name: /^Comparar \(2\)/ }).click()
  const box = page.getByPlaceholder('Escribe un mensaje…')
  await box.fill(text)
  await box.press('Enter')
}

let codeOpened = false
async function openCode(ctx) {
  const { page } = ctx
  await closeOverlays(page)
  await goMode(page, 'Code')
  if (codeOpened) return
  await stubDialog(ctx, [codeRepo])
  await page.getByRole('button', { name: /Abrir carpeta/ }).first().click()
  const trust = page.getByRole('button', { name: 'Confiar y continuar' })
  await vis(trust, 15_000)
  await trust.click()
  await sleep(1200)
  codeOpened = true
}

let codeSeeded = false
async function seedCode(ctx) {
  await openCode(ctx)
  if (codeSeeded) return
  codeSeeded = true
  const { page, fake } = ctx
  const diff = `Index: ${codeRepo}/src/carrito.ts\n===================================================================\n--- ${codeRepo}/src/carrito.ts\n+++ ${codeRepo}/src/carrito.ts\n@@ -1,5 +1,8 @@\n-export function total(items: { precio: number; cantidad: number }[]): number {\n+import { IVA, redondear } from "./precios"\n+\n+export function total(items: { precio: number; cantidad: number }[]): number {\n   let t = 0\n   for (const i of items) t += i.precio * i.cantidad\n-  return t\n+  return redondear(t * (1 + IVA))\n }\n`
  await fake.script({
    match: 'agrega el IVA',
    title: 'Agregar IVA al carrito',
    steps: [
      { type: 'text', text: 'Voy a **leer** el módulo y aplicar el IVA al total.' },
      { type: 'tool', tool: 'read', input: { filePath: `${codeRepo}/src/carrito.ts` }, output: 'export function total() {}\n', title: 'src/carrito.ts' },
      { type: 'tool', tool: 'bash', input: { command: 'npm test', description: 'Corre las pruebas' }, output: ' ✓ carrito.test.ts (4)\n Tests  4 passed (4)\n', title: 'Corre las pruebas' },
      { type: 'tool', tool: 'edit', input: { filePath: `${codeRepo}/src/carrito.ts` }, output: 'Edit applied successfully.', title: 'src/carrito.ts', metadata: { diff } },
      { type: 'text', text: 'Hecho. `total()` ahora aplica el IVA y redondea una sola vez.\n\n```ts\nreturn redondear(t * (1 + IVA))\n```' }
    ]
  })
  const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
  await box.fill('Por favor agrega el IVA al total del carrito')
  await box.press('Enter')
  await vis(page.getByText(/ahora aplica el IVA/), 30_000)
  await sleep(600)
}

async function togglePanel(page, name) {
  const btn = page.getByRole('button', { name, exact: true }).first()
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click()
  await sleep(900)
}

let tasksConn = null
// La tarjeta de primer uso se descarta (y queda descartada) salvo que se pida conservarla para `tareas-primer-uso`.
async function dismissTasksOnboarding(page) {
  const btn = page.getByRole('button', { name: 'Entendido, no mostrar más' })
  if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {})
}
async function openTasks(ctx, { keepOnboarding = false } = {}) {
  const { page } = ctx
  await closeOverlays(page)
  await goMode(page, 'Tareas')
  if (tasksConn) {
    if (!keepOnboarding) await dismissTasksOnboarding(page)
    return tasksConn
  }
  await stubDialog(ctx, [taskFolder])
  await page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
  await page.getByRole('button', { name: 'Permitir', exact: true }).click()
  await vis(page.getByPlaceholder('Describe la tarea que quieres delegar…'), 60_000)
  const conn = await page.evaluate(async (folder) => {
    const r = await window.api.tasks.invoke('tasks:start', { folder })
    return r.ok ? r.data : { error: JSON.stringify(r).slice(0, 300) }
  }, taskFolder)
  if (!conn || conn.error) throw new Error(`tasks:start: ${conn?.error}`)
  tasksConn = fakeClient(conn)
  if (!keepOnboarding) await dismissTasksOnboarding(page)
  return tasksConn
}
async function freshTasks(ctx) {
  const fake = await openTasks(ctx)
  return fake
}
async function sendTask(page, text) {
  await page.getByRole('button', { name: 'Nueva tarea' }).first().click()
  const box = page.getByPlaceholder('Describe la tarea que quieres delegar…')
  await box.fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}

// Dos tareas terminadas (se crean una sola vez por arranque, aunque varios escenarios las necesiten).
let taskListSeeded = false
async function seedTaskList(ctx) {
  const fake = await openTasks(ctx)
  if (taskListSeeded) return
  taskListSeeded = true
  await fake.script({ match: 'Ordena los informes', title: 'Ordenar informes del trimestre', steps: [{ type: 'text', text: 'Ordené **12 informes** por mes en carpetas.' }] })
  await fake.script({ match: 'Resume el contrato', title: 'Resumir contrato de arriendo', steps: [{ type: 'text', text: 'El contrato dura 24 meses y se reajusta por UF.' }] })
  for (const [t, done] of [['Ordena los informes del trimestre', /Ordené/], ['Resume el contrato de arriendo', /24 meses/]]) {
    await sendTask(ctx.page, t)
    await vis(ctx.page.getByText(done), 45_000)
    await sleep(400)
  }
}

// Tres rutinas inventadas (se crean una sola vez por arranque; `rutinas-vacio` corre antes de que existan).
let routinesSeeded = false
async function seedRoutines(ctx) {
  const { page } = ctx
  await openTasks(ctx) // autoriza la carpeta de Tareas (las rutinas de Tareas la exigen)
  await closeOverlays(page)
  if (routinesSeeded) return
  routinesSeeded = true
  const mk = async (name, prompt, mode, schedule, enabled, folder) => {
    const r = await page.evaluate(async (input) => JSON.stringify(await window.api.tasks.invoke('routines:save', input)).slice(0, 200), { name, prompt, mode, schedule, enabled, folder, model: { providerID: 'fake', modelID: 'fake-model' }, sessionMode: 'fresh', onAsk: 'reject' })
    if (!r.includes('"ok":true')) console.error(`  [rutinas] routines:save: ${r}`)
  }
  await mk('Resumen diario de ventas', 'Resume las ventas de ayer y destaca anomalías.', 'chat', { kind: 'daily', time: '08:30' }, true, null)
  await mk('Revisión semanal de dependencias', 'Revisa dependencias desactualizadas y propone actualizaciones.', 'code', { kind: 'weekly', day: 1, time: '09:00' }, true, codeRepo)
  await mk('Ordenar descargas', 'Ordena la carpeta de descargas por tipo de archivo.', 'tasks', { kind: 'interval', hours: 6 }, false, taskFolder)
}

const S = {
  async 'chat-vacio'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
  },
  async 'chat-conversacion'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await ctx.page.getByText('Plan del carrito de compras').first().click()
    await vis(ctx.page.getByText('Plan para el carrito'), 15_000)
    await sleep(500)
  },
  async 'chat-herramientas'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await ctx.page.getByText('Pruebas y corrección del IVA').first().click()
    await vis(ctx.page.getByText(/pruebas.*pasan/), 15_000)
    // Las herramientas seguidas se pliegan en «N pasos»: se abre el grupo y luego la fila del comando.
    await ctx.page.getByRole('button', { name: /\d+ pasos/ }).first().click()
    await ctx.page.getByRole('button', { name: /bash|npm test|Corre las pruebas/ }).first().click()
    await sleep(500)
  },
  async 'code-proyecto'(ctx) {
    await seedCode(ctx)
  },
  async 'code-diff'(ctx) {
    await seedCode(ctx)
    await togglePanel(ctx.page, 'Cambios')
  },
  async 'code-terminal'(ctx) {
    await seedCode(ctx)
    await togglePanel(ctx.page, 'Terminal')
    await sleep(800)
    await ctx.page.mouse.click(1000, 300)
    await ctx.page.keyboard.type("export PS1='demo@tienda-web % '; clear; git status --short")
    await ctx.page.keyboard.press('Enter')
    await sleep(1200)
  },
  async 'code-permiso'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'Instala las dependencias',
      title: 'Instalar dependencias',
      steps: [
        { type: 'text', text: 'Necesito instalar dependencias para seguir.' },
        {
          type: 'permission',
          permission: 'bash',
          patterns: ['npm install'],
          metadata: { command: 'npm install', description: 'Instala las dependencias del proyecto.' }
        }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('Instala las dependencias del proyecto')
    await box.press('Enter')
    await vis(page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await sleep(500)
  },
  async 'tareas-primer-uso'(ctx) {
    await openTasks(ctx, { keepOnboarding: true })
    await vis(ctx.page.getByRole('region', { name: 'Así funcionan las tareas' }), 30_000)
    await sleep(400)
  },
  async 'tareas-nueva'(ctx) {
    await openTasks(ctx)
    await ctx.page.getByRole('button', { name: /^Nueva tarea/ }).first().click()
    await vis(ctx.page.getByPlaceholder('Describe la tarea que quieres delegar…'), 15_000)
    await sleep(500)
  },
  async 'tareas-lista'(ctx) {
    await seedTaskList(ctx)
  },
  async 'tareas-buscar'(ctx) {
    await seedTaskList(ctx)
    const box = ctx.page.getByRole('searchbox', { name: 'Buscar tareas' })
    await box.fill('informe')
    await sleep(700)
    return async () => {
      await box.fill('')
      await sleep(300)
    }
  },
  async 'tareas-archivadas'(ctx) {
    await seedTaskList(ctx)
    const btn = ctx.page.getByRole('button', { name: /Archivadas/ }).first()
    await btn.click()
    await sleep(700)
    return async () => {
      await btn.click()
      await sleep(300)
    }
  },
  async 'tareas-en-curso'(ctx) {
    const fake = await freshTasks(ctx)
    await fake.script({
      match: 'Prepara el informe',
      title: 'Preparar informe de ventas',
      steps: [
        { type: 'text', text: 'Empiezo reuniendo los datos del mes.' },
        { type: 'todo', todos: [{ content: 'Reunir datos de ventas', status: 'completed', priority: 'high' }, { content: 'Calcular totales por región', status: 'in_progress', priority: 'high' }, { content: 'Redactar resumen', status: 'pending', priority: 'medium' }] },
        { type: 'tool', tool: 'bash', input: { command: 'ls ventas' }, output: 'enero.csv\nfebrero.csv\n', title: 'Lista ventas' },
        { type: 'delay', ms: 120000 }
      ]
    })
    await sendTask(ctx.page, 'Prepara el informe de ventas del mes')
    await vis(ctx.page.getByText('Calcular totales por región'), 45_000)
    await sleep(800)
  },
  async 'tareas-permiso'(ctx) {
    const fake = await freshTasks(ctx)
    await fake.script({
      match: 'Borra los temporales',
      title: 'Limpiar archivos temporales',
      steps: [{ type: 'text', text: 'Necesito ejecutar un comando para limpiar.' }, { type: 'permission', permission: 'bash', patterns: ['rm -rf temporales/*'] }]
    })
    await sendTask(ctx.page, 'Borra los temporales de la carpeta')
    await vis(ctx.page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await sleep(500)
  },
  async 'tareas-permiso-neutral'(ctx) {
    const fake = await freshTasks(ctx)
    await fake.script({
      match: 'Corre las pruebas',
      title: 'Correr pruebas de la carpeta',
      steps: [
        { type: 'text', text: 'Necesito correr las pruebas del proyecto.' },
        {
          type: 'permission',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: { command: 'npm test', description: 'Corre la suite de pruebas del proyecto.' }
        }
      ]
    })
    await sendTask(ctx.page, 'Corre las pruebas del proyecto')
    await vis(ctx.page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await sleep(500)
  },
  async 'tareas-permiso-largo'(ctx) {
    const fake = await freshTasks(ctx)
    const cmd = Array.from({ length: 300 }, (_, i) => `cp informe_${String(i).padStart(3, '0')}.pdf ./respaldo/`).join('\n')
    await fake.script({
      match: 'Respalda los informes',
      title: 'Respaldar informes del mes',
      steps: [
        { type: 'text', text: 'Voy a respaldar los informes con un comando largo.' },
        { type: 'permission', permission: 'bash', metadata: { command: cmd, description: 'Copia los informes a la carpeta de respaldo.' } }
      ]
    })
    await sendTask(ctx.page, 'Respalda los informes del mes')
    await vis(ctx.page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await sleep(500)
  },
  async 'rutinas-vacio'(ctx) {
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Rutinas')
    await sleep(800)
  },
  async rutinas(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    await sleep(800)
  },
  async 'rutinas-detalle'(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    await ctx.page.getByText('Resumen diario de ventas').first().click()
    await vis(ctx.page.getByRole('button', { name: 'Cerrar detalle' }), 15_000)
    await sleep(600)
    return async () => {
      await ctx.page.getByRole('button', { name: 'Cerrar detalle' }).click()
      await sleep(300)
    }
  },
  async 'rutinas-editor'(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    await ctx.page.getByRole('button', { name: 'Nueva rutina' }).first().click()
    await vis(ctx.page.getByRole('dialog', { name: 'Nueva rutina' }), 15_000)
    await sleep(600)
    return async () => {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
  },
  async 'ajustes-general'(ctx) {
    await openSettings(ctx.page, 'General')
  },
  async 'ajustes-modelos'(ctx) {
    await openSettings(ctx.page, 'Modelos')
  },
  async 'ajustes-celular'(ctx) {
    await openSettings(ctx.page, /Celular|Móvil|Remoto/)
  },
  async paleta(ctx) {
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await press(ctx.page, 'Meta+Shift+P')
    await vis(ctx.page.getByRole('dialog'), 5000)
    await sleep(400)
  },
  async 'selector-modelo'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    await ctx.page.getByRole('button', { name: /Fake Model/ }).first().click()
    await sleep(600)
  },
  // Diálogo modal de confirmación real: «¿Lanzar la comparación?» (aviso de que el uso se multiplica).
  async 'dialogo-confirmar'(ctx) {
    const { page } = ctx
    await closeOverlays(page)
    await armCompareAndAsk(page, 'Cómo pelo tomates fácilmente')
    await vis(page.getByRole('dialog', { name: '¿Lanzar la comparación?' }), 10_000)
    await sleep(400)
    return async () => {
      await page.getByRole('dialog', { name: '¿Lanzar la comparación?' }).getByRole('button', { name: /Cancelar/ }).click().catch(() => {})
    }
  },
  async comparar(ctx) {
    const { page, fake } = ctx
    await closeOverlays(page)
    await fake.script({
      scripts: [
        { forModel: MODELS[0].id, steps: [{ type: 'text', text: 'Para pelar tomates: hazles un corte en cruz, sumérgelos **30 segundos** en agua hirviendo y pásalos a agua con hielo. La piel sale sola.' }] },
        { forModel: MODELS[1].id, steps: [{ type: 'reasoning', text: 'Pensando en el método más simple.' }, { type: 'text', text: 'Escalda los tomates:\n\n1. Corte en cruz\n2. 1 minuto en agua hirviendo\n3. Agua fría\n\nLa piel se desprende fácil.' }] }
      ]
    })
    await armCompareAndAsk(page, 'Cómo pelo tomates fácilmente')
    await page.getByRole('dialog', { name: '¿Lanzar la comparación?' }).getByRole('button', { name: 'Comparar', exact: true }).click()
    await vis(page.getByRole('region', { name: 'Fake Model' }).getByText(/pelar tomates/), 30_000)
    await vis(page.getByRole('region', { name: 'Fake Reasoner' }).getByText(/Escalda/), 30_000)
    await sleep(600)
  },
  async 'barra-lateral-colapsada'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await ctx.page.getByText('Plan del carrito de compras').first().click()
    await ctx.page.getByRole('button', { name: /Ocultar barra lateral/ }).click()
    await sleep(600)
    return async () => {
      await ctx.page.getByRole('button', { name: /Mostrar barra lateral/ }).click()
      await sleep(400)
    }
  },
  async onboarding(ctx) {
    await vis(ctx.page.getByRole('dialog'), 30_000)
    await sleep(500)
  },
  async 'onboarding-inicio'(ctx) {
    await vis(ctx.page.getByRole('dialog'), 30_000)
    // «Atrás» hasta el primer paso (sin él el botón no existe).
    for (let i = 0; i < 6; i++) {
      const back = ctx.page.getByRole('button', { name: 'Atrás', exact: true })
      if (!(await back.isVisible().catch(() => false))) break
      await back.click()
      await sleep(300)
    }
    await sleep(400)
  }
}

// ---- kit de UI: una captura por sección (tipografía, fundamentos, botones, campos), con los estados hover/foco/presionado FORZADOS
// por CDP (`CSS.forcePseudoState`) en los nodos marcados `data-kit-state`. Nombre: kit-<sección>-<tema>-1280x800.png ----
async function runKit(ctx) {
  const { page, cdp } = ctx
  await page.evaluate(() => {
    localStorage.setItem('lazunox.uikit', '1')
    location.hash = '#ui-kit'
  })
  await page.reload()
  await page.waitForSelector('[data-kit-root]', { timeout: 30_000 })
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  for (const theme of themes) {
    try {
      await stage(ctx, [1280, 800], theme)
      // El tema «sistema» se resuelve al cargar: se recarga con el medio ya emulado.
      await page.reload()
      await page.waitForSelector('[data-kit-root]', { timeout: 30_000 })
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      await stage(ctx, [1280, 800], theme)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 3000, deviceScaleFactor: DPR, mobile: false })
      await sleep(300)
      const height = await page.evaluate(() => document.querySelector('[data-kit-root]').scrollHeight)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.min(height, 8000), deviceScaleFactor: DPR, mobile: false })
      await sleep(300)
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-kit-state]' })
      for (const nodeId of nodeIds) {
        const { attributes } = await cdp.send('DOM.getAttributes', { nodeId })
        const state = attributes[attributes.indexOf('data-kit-state') + 1]
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [state] })
      }
      await sleep(200)
      const rects = await page.evaluate(() =>
        [...document.querySelectorAll('[data-kit-section]')].map((el) => {
          const r = el.getBoundingClientRect()
          return { id: el.getAttribute('data-kit-section'), x: r.x, y: r.y, width: r.width, height: r.height }
        })
      )
      for (const { id, ...clip } of rects) {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } })
        const file = join(out, `kit-${id}-${theme}-1280x800${SFX}.png`)
        writeFileSync(file, Buffer.from(data, 'base64'))
        done.push(file)
      }
    } catch (e) {
      fail.push(`kit-${theme}: ${String(e.message).split('\n')[0]}`)
    }
  }
}

// ---- ejecución ----
const fail = []
const done = []
const notes = []

async function runGroup(ctx, names) {
  for (const sc of names) {
    const fn = S[sc]
    if (!fn) {
      fail.push(`${sc}: sin implementar`)
      continue
    }
    let ready = false
    let undo = null
    for (const sizeKey of sizesFor(sc)) {
      for (const theme of themes) {
        try {
          await stage(ctx, SIZES[sizeKey], theme)
          if (!ready) {
            undo = (await fn(ctx)) ?? null
            ready = true
            await sleep(300)
          }
          await sleep(250)
          done.push(await snap(ctx, sc, theme, sizeKey))
        } catch (e) {
          fail.push(`${sc}-${theme}-${sizeKey}: ${String(e.message).split('\n')[0]}`)
          ready = false
          try {
            const names = await ctx.page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem],[role=dialog],[role=alertdialog]')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40) + (b.getAttribute('role') ? `<${b.getAttribute('role')}>` : '')).filter(Boolean).slice(0, 60))
            console.error(`  [${sc}] controles: ${names.join(' | ')}`)
          } catch {
            /* sin lista */
          }
          // Captura del estado en que falló, para depurar (no cuenta como captura buena).
          try {
            mkdirSync(join(out, '_fallos'), { recursive: true })
            const { data } = await ctx.cdp.send('Page.captureScreenshot', { format: 'png' })
            writeFileSync(join(out, '_fallos', `${sc}-${theme}-${sizeKey}${SFX}.png`), Buffer.from(data, 'base64'))
          } catch {
            /* sin captura */
          }
        }
      }
    }
    if (undo) await undo().catch(() => {})
    await closeOverlays(ctx.page).catch(() => {})
  }
}

try {
  if (WIN) {
    // Sin `uptime`: uso de CPU con typeperf (1 muestra). Si typeperf falla o no se entiende, no se comprueba la carga.
    try {
      const rows = execFileSync('typeperf', ['\\Processor(_Total)\\% Processor Time', '-sc', '1'], { encoding: 'utf8', timeout: 15_000 }).split(/\r?\n/)
      const cpu = Number((rows.find((r) => /^"\d/.test(r)) ?? '').split('","')[1]?.replace(/"/g, ''))
      if (cpu > 90) throw new Error(`CPU alta (${cpu.toFixed(0)} %): no se lanza Electron.`)
    } catch (e) {
      if (/CPU alta/.test(String(e.message))) throw e
    }
  } else {
    const load = Number(execFileSync('sh', ['-c', "uptime | sed 's/.*load averages*: *//' | cut -d' ' -f1 | tr -d ','"], { encoding: 'utf8' }).trim().replace(',', '.'))
    if (load > 8) throw new Error(`Carga del sistema alta (${load}): no se lanza Electron.`)
  }
  seedRepo(codeRepo)
  // Tareas y Rutinas van en otro arranque: el falso numera las sesiones igual en Chat y en Tareas (ids repetidos) y la
  // interfaz mezclaría mensajes entre ambos; con ids reales (únicos) no pasa.
  const isTasks = (s) => /^(tareas-|rutinas)/.test(s)
  const isOnb = (s) => s.startsWith('onboarding')
  const byOrder = (a, b) => SCENARIOS.indexOf(a) - SCENARIOS.indexOf(b)
  const main = scenarios.filter((s) => !isOnb(s) && s !== 'kit' && !isTasks(s))
  const tasks = scenarios.filter(isTasks).sort(byOrder)
  if (main.length) {
    const ctx = await launch('main')
    await runGroup(ctx, main)
    await stop(ctx)
  }
  if (tasks.length) {
    const ctx = await launch('tareas')
    await runGroup(ctx, tasks)
    await stop(ctx)
  }
  if (scenarios.includes('kit')) {
    const ctx = await launch('kit')
    await runKit(ctx)
    await stop(ctx)
  }
  const onb = scenarios.filter(isOnb).sort(byOrder)
  if (onb.length) {
    const ctx = await launch('onb', { settings: { onboarded: false }, env: { OPENCODE_BIN: join(binDir, 'no-existe', 'opencode') }, noServer: true })
    await runGroup(ctx, onb)
    await stop(ctx)
  }
} catch (e) {
  fail.push(`fatal: ${String(e.message).split('\n')[0]}`)
} finally {
  clearTimeout(watchdog)
  await cleanup()
}
for (const f of done) console.log(f)
for (const f of fail) console.error(`FALLÓ ${f}`)
for (const n of notes) console.log(`nota: ${n}`)
console.log(`${done.length} capturas, ${fail.length} fallos. Procesos restantes: ${myPids().length}`)
process.exit(fail.length ? 1 : 0)
