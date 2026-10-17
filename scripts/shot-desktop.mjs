#!/usr/bin/env node
// Capturas REALES de la interfaz de escritorio (Electron) con el motor falso. Ver docs/CAPTURAS-ESCRITORIO.md.
// Arranca la app compilada (`out/`, carga por lazunox://app) con un userData TEMPORAL, un OpenCode falso y datos inventados;
// captura por CDP (`Page.captureScreenshot`, 2x). No toca la app instalada, su userData, su cloudflared ni el motor real.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
const DEFAULT_OUT = WIN
  ? join(tmpdir(), 'shots-desktop')
  : '/private/tmp/claude-501/-Users-ben/0f2b5c02-144e-41f9-8c7c-156d39453861/scratchpad/shots-desktop'
const SCENARIOS = [
  // Pantalla «Preparando Lazunox» (revisión de arranque, simulada con LAZUNOX_TEST_PREFLIGHT): `preparando` = primer uso con el motor
  // listo (ArtCraft y avisos de macOS opcionales, «Más tarde»); `preparando-motor` = sin motor (lo único que bloquea).
  'preparando',
  'preparando-motor',
  // Asistente de primer uso. Arranque «sin motor» (OpenCode ausente): `onboarding` (primera pantalla con la tarjeta de atención) y
  // `onboarding-motor` (paso del motor). Arranque «motor incluido»: `onboarding-inicio` (saludo directo) y los cuatro pasos.
  'onboarding',
  'onboarding-motor',
  'onboarding-inicio',
  'onboarding-conecta',
  'onboarding-modelo',
  'onboarding-modos',
  'onboarding-final',
  'chat-vacio',
  'chat-conversacion',
  'chat-herramientas',
  'chat-pregunta',
  'chat-documento',
  'chat-archivo-ver',
  'chat-adjunto-office',
  'chat-memoria-propuesta',
  'chat-exportar',
  'code-proyecto',
  'code-diff',
  'code-terminal',
  'code-terminal-pestanas',
  'code-terminal-pestanas-ocupada',
  'code-ejecutar',
  'code-ejecutar-confirmar',
  'code-ejecutar-mensaje',
  'code-ejecutar-termina',
  'code-terminal-ia',
  'code-permiso',
  'code-pregunta',
  'code-plan',
  'code-archivo',
  'code-entorno',
  'aviso-motor',
  // El orden dentro del grupo de Tareas importa (se respeta aunque se pidan en otro): `tareas-primer-uso` va primero (antes de
  // descartar la tarjeta), `tareas-nueva` y `rutinas-vacio` antes de crear tareas o rutinas, y `tareas-buscar`/`-archivadas` tras la lista.
  'tareas-primer-uso',
  'tareas-nueva',
  'inicio-vacio',
  'tareas-lista',
  'tareas-buscar',
  'tareas-archivadas',
  'tareas-en-curso',
  'tareas-progreso',
  'tareas-progreso-plan',
  'tareas-permiso',
  'tareas-plan-sin-apps',
  'tareas-plan-sin-apps-cambio',
  'tareas-entorno',
  'tareas-permiso-neutral',
  'tareas-permiso-largo',
  'inicio-pendientes',
  'rutinas-vacio',
  'rutinas',
  'rutinas-detalle',
  'rutinas-editor',
  'rutinas-evento',
  'rutinas-bandeja',
  'rutinas-evento-e2e',
  'ajustes-general',
  'ajustes-modelos',
  'ajustes-celular',
  'ajustes-memoria',
  'ajustes-instrucciones',
  // Buscador de Ajustes (⌘F, resultados agrupados con coincidencias resaltadas) e «Importar» (vista previa de una carpeta de ejemplo
  // con secretos FALSOS armados en tiempo de ejecución: no deben aparecer en pantalla).
  'ajustes-buscar',
  'ajustes-importar',
  'ajustes-importar-hecho',
  'paleta',
  'selector-modelo',
  // Caja de escribir de Code con el menú de permisos abierto (frase por opción, actual marcada, atajos 1-5).
  'caja-menus',
  'dialogo-confirmar',
  'comparar',
  'barra-lateral-colapsada',
  // Barra lateral 2c (el árbol y sus estados). Conviene pedirlas con `--clip sidebar`.
  'barra-chat',
  'barra-chat-fijadas',
  'barra-code',
  'barra-code-hover',
  'barra-code-menu',
  'inicio-chat',
  'inicio-code',
  'code-cambios',
  'code-cambios-archivo',
  'kit' // kit de UI (app/dev/UiKit.tsx): NO va en la tanda por defecto; se pide con --scenario kit
]
const SIZES = { '1280x800': [1280, 800], '1100x750': [1100, 750], '1000x700': [1000, 700] }
// Sin --size: 1280x800 para todo y 1000x700 solo para chat y ajustes.
const SMALL_ALSO = /^(chat-|ajustes-|caja-)/
const TOTAL_TIMEOUT_MS = 330_000

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const out = resolve(arg('out') ?? DEFAULT_OUT)
const sel = arg('scenario')
const themes = arg('theme') ? [arg('theme')] : ['dark', 'light']
const sizeSel = arg('size')
// --clip sidebar: recorta cada captura al `<aside>` de la barra lateral (sufijo `-lateral`); para comparar con la maqueta.
const clipSel = arg('clip')
if (clipSel && clipSel !== 'sidebar') throw new Error('--clip sidebar')
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
// Motor incluido falso para el asistente de primer uso: igual, pero con solo el gratuito «conectado» (no cuenta como configurado).
const onbBundledDir = mk(TMP, 'bundled-onb-')
for (const f of ['opencode', 'server.mjs']) cpSync(join(repo, 'e2e/fake-opencode', f), join(onbBundledDir, f))
writeFileSync(join(onbBundledDir, 'connected.json'), JSON.stringify(['opencode']))
// «Motor incluido» falso (solo `aviso-motor`): `LAZUNOX_TEST_BUNDLED_DIR` hace de `Resources/opencode`.
const bundledDir = mk(TMP, 'bundled-')
for (const f of ['opencode', 'server.mjs']) cpSync(join(repo, 'e2e/fake-opencode', f), join(bundledDir, f))
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
  writeFileSync(
    join(dir, 'src/carrito.ts'),
    'export function total(items: { precio: number; cantidad: number }[]): number {\n  let t = 0\n  for (const i of items) t += i.precio * i.cantidad\n  return t\n}\n'
  )
  writeFileSync(join(dir, 'src/precios.ts'), 'export const IVA = 0.19\nexport const redondear = (n: number): number => Math.round(n)\n')
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "tienda-web",\n  "version": "1.0.0"\n}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'Version inicial de la tienda')
  // Cambios sin confirmar: alimentan el panel «Cambios» de Code.
  writeFileSync(
    join(dir, 'src/carrito.ts'),
    'import { IVA, redondear } from "./precios"\n\nexport function total(items: { precio: number; cantidad: number }[]): number {\n  let t = 0\n  for (const i of items) t += i.precio * i.cantidad\n  return redondear(t * (1 + IVA))\n}\n\nexport function vacio(items: unknown[]): boolean {\n  return items.length === 0\n}\n'
  )
  writeFileSync(join(dir, 'src/nuevo.ts'), 'export const ENVIO_GRATIS_DESDE = 30000\n')
}

// ---- procesos: solo los que mencionan nuestros temporales (prefijo con el pid de ESTE node) ----
function myPids() {
  try {
    const rows = WIN
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'
          ],
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
  await page
    .locator('nav[aria-label="Modo"]')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {})
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
  // El modo Tareas se muestra como «Overdrive» en escritorio.
  await MODE(page)
    .getByRole('button', { name: name === 'Tareas' ? 'Overdrive' : name, exact: true })
    .click()
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
  await electronApp.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.getParentWindow()) win.setContentSize(cw, ch)
    },
    [w, h]
  )
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: DPR, mobile: false })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
      ...(forcedColors ? [{ name: 'forced-colors', value: 'active' }] : [])
    ]
  })
  const calm = realReducedMotion
    ? 'caret-color:transparent!important;scroll-behavior:auto!important'
    : 'transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important'
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
      .evaluate(
        () => [...document.querySelectorAll(':hover')].filter((e) => !['HTML', 'BODY'].includes(e.tagName) && e.id !== 'root').length
      )
      .catch(() => 0)
    if (!left) return
  }
  notes.push('el ratón sigue sobre un elemento tras sacarlo de la ventana')
}

async function snap(ctx, name, theme, sizeKey) {
  if (ctx.hover) {
    // Escenario con hover: el ratón se queda encima del elemento (centro de su caja) mientras dura la captura.
    const b = await ctx.hover.first().boundingBox()
    if (!b) throw new Error('el elemento de hover no tiene caja')
    await ctx.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.width / 2, y: b.y + b.height / 2, buttons: 0 })
    await sleep(250)
  } else await parkMouse(ctx)
  let clip
  if (clipSel === 'sidebar') {
    const r = await ctx.page.evaluate(() => {
      const a = document.querySelector('aside').getBoundingClientRect()
      return { x: a.x, y: a.y, width: a.width, height: a.height }
    })
    clip = { ...r, scale: 1 }
  }
  const { data } = await ctx.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) })
  const file = join(out, `${name}${clip ? '-lateral' : ''}-${theme}-${sizeKey}${SFX}.png`)
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
  {
    type: 'tool',
    tool: 'read',
    input: { filePath: '/Users/demo/proyectos/tienda-web/src/carrito.ts' },
    output: 'export function total() {}\n',
    title: 'src/carrito.ts'
  },
  {
    type: 'tool',
    tool: 'grep',
    input: { pattern: 'IVA', path: 'src' },
    output: 'src/precios.ts:1:export const IVA = 0.19\n',
    title: 'IVA'
  },
  {
    type: 'tool',
    tool: 'bash',
    input: { command: 'npm test', description: 'Corre las pruebas' },
    output:
      '> tienda-web@1.0.0 test\n> vitest run\n\n ✓ carrito.test.ts (4)\n ✓ precios.test.ts (2)\n\n Test Files  2 passed (2)\n      Tests  6 passed (6)\n',
    title: 'Corre las pruebas'
  },
  {
    type: 'tool',
    tool: 'edit',
    input: { filePath: 'src/carrito.ts', oldString: 'return t', newString: 'return redondear(t * (1 + IVA))' },
    output: 'Edit applied successfully.',
    title: 'src/carrito.ts'
  },
  { type: 'text', text: 'Listo: las **6 pruebas** pasan y el total ahora incluye el IVA.' }
]

async function scriptChat(fake) {
  await fake.script({ match: 'plan del carrito', title: 'Plan del carrito de compras', steps: [{ type: 'text', text: MD_LARGO }] })
  await fake.script({ match: 'Ejecuta las pruebas', title: 'Pruebas y corrección del IVA', steps: HERRAMIENTAS })
  await fake.script({
    match: 'receta de pan',
    title: 'Receta de pan casero',
    steps: [
      {
        type: 'text',
        text: 'Mezcla 500 g de harina, 350 ml de agua tibia, 10 g de sal y 5 g de levadura. Reposa 12 horas y hornea a 230 °C por 35 minutos.'
      }
    ]
  })
  await fake.script({
    match: 'resumen semanal',
    title: 'Resumen semanal de ventas',
    steps: [
      { type: 'text', text: 'Las ventas subieron un **12 %** frente a la semana anterior. El producto más vendido fue la polera negra.' }
    ]
  })
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
  await page
    .getByRole('button', { name: /^Ajustes/ })
    .first()
    .click()
  await sleep(400)
  if (section) {
    await page
      .getByRole('navigation', { name: /Secciones de ajustes|Ajustes/ })
      .getByRole('button', { name: section })
      .first()
      .click()
      .catch(async () => {
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

let chatBusySeeded = false
let codeTreeSeeded = false
let codeOpened = false
async function openCode(ctx) {
  const { page } = ctx
  await closeOverlays(page)
  await goMode(page, 'Code')
  if (codeOpened) return
  await stubDialog(ctx, [codeRepo])
  await page
    .getByRole('button', { name: /Abrir carpeta/ })
    .first()
    .click()
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
    // Resumen de cambios de la sesión: la lista de Code la marca «por revisar» hasta que se aceptan en el panel Cambios.
    summary: { files: 2, additions: 12, deletions: 2 },
    steps: [
      { type: 'text', text: 'Voy a **leer** el módulo y aplicar el IVA al total.' },
      {
        type: 'tool',
        tool: 'read',
        input: { filePath: `${codeRepo}/src/carrito.ts` },
        output: 'export function total() {}\n',
        title: 'src/carrito.ts'
      },
      {
        type: 'tool',
        tool: 'bash',
        input: { command: 'npm test', description: 'Corre las pruebas' },
        output: ' ✓ carrito.test.ts (4)\n Tests  4 passed (4)\n',
        title: 'Corre las pruebas'
      },
      {
        type: 'tool',
        tool: 'edit',
        input: { filePath: `${codeRepo}/src/carrito.ts` },
        output: 'Edit applied successfully.',
        title: 'src/carrito.ts',
        metadata: { diff }
      },
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
  // Acotado al contenido (`<main>`): la barra lateral tiene sus propios botones (filtros) y no deben confundirse con los del panel.
  const btn = page.getByRole('main').getByRole('button', { name, exact: true }).first()
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
  // En Control total el campo dice «Describe qué debe hacer en tu Mac…».
  const box = page.getByPlaceholder(/^Describe (la tarea que quieres delegar|qué debe hacer en tu Mac)…$/)
  await box.fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}

// Pone la app en Control total (si no lo está) y devuelve el cliente del falso de ESE servidor (sin sandbox). Lo usan los
// escenarios del plan sin apps: el paso `request-access` del falso hace el mismo POST que el MCP `computer_request_access`.
async function freshFullControl(ctx) {
  await openTasks(ctx)
  const { page } = ctx
  // Una tarjeta de plan que quedó pendiente de un escenario anterior se cancela; luego, tarea nueva (ahí está el selector de modo).
  const pend = page.getByRole('button', { name: 'Cancelar', exact: true })
  if (await pend.isVisible().catch(() => false)) await pend.click()
  await page.getByRole('button', { name: 'Nueva tarea' }).first().click()
  const full = page.getByRole('radio', { name: 'Usar todo tu Mac', exact: true })
  await vis(full, 15_000)
  if ((await full.getAttribute('aria-checked')) !== 'true') {
    await full.click()
    const consent = page.getByRole('button', { name: 'Permitir control' })
    if (await consent.isVisible().catch(() => false)) await consent.click()
    await page.getByRole('radio', { name: 'Usar todo tu Mac', exact: true, checked: true }).waitFor({ state: 'visible', timeout: 60_000 })
    await vis(page.getByPlaceholder('Describe qué debe hacer en tu Mac…'), 60_000)
  }
  const conn = await page.evaluate(async (folder) => {
    const r = await window.api.tasks.invoke('tasks:start', { folder, fullAccess: true })
    return r.ok ? r.data : { error: JSON.stringify(r).slice(0, 300) }
  }, taskFolder)
  if (!conn || conn.error) throw new Error(`tasks:start (Control total): ${conn?.error}`)
  return fakeClient(conn)
}
const planSinApps = (match, title) => ({
  match,
  title,
  steps: [
    { type: 'text', text: 'Voy a ordenar los archivos de la carpeta.' },
    {
      type: 'request-access',
      apps: [],
      reason: 'Solo trabajo con archivos',
      plan: ['Listar los archivos', 'Moverlos a subcarpetas por tipo']
    },
    { type: 'text', text: 'Listo, seguimos.' }
  ]
})
const CAMBIAR_A_CARPETA = 'Cambiar a Solo en tu carpeta'

const planTool = (todos) => ({ type: 'tool', tool: 'todowrite', input: { todos }, output: 'ok', title: 'Plan' })
async function progresoDosTurnos(ctx, conPlan) {
  const fake = await freshTasks(ctx)
  await fake.script({
    match: 'Prepara el informe',
    title: 'Preparar informe de ventas',
    steps: [
      planTool([
        { content: 'Reunir datos', status: 'completed', priority: 'high' },
        { content: 'Calcular totales', status: 'completed', priority: 'high' },
        { content: 'Redactar resumen', status: 'completed', priority: 'medium' }
      ]),
      { type: 'text', text: 'Listo, el informe de ventas quedó preparado.' }
    ]
  })
  const nuevo = [
    ...(conPlan
      ? [
          planTool([
            { content: 'Revisar la carpeta', status: 'completed', priority: 'high' },
            { content: 'Leer los tres meses', status: 'in_progress', priority: 'high' },
            { content: 'Calcular totales', status: 'pending', priority: 'medium' },
            { content: 'Armar el Excel', status: 'pending', priority: 'medium' },
            { content: 'Revisar', status: 'pending', priority: 'low' }
          ])
        ]
      : []),
    { type: 'tool', tool: 'read', input: { filePath: join(taskFolder, 'ventas_enero.csv') }, output: 'mes,total', title: 'Lee enero' },
    { type: 'tool', tool: 'read', input: { filePath: join(taskFolder, 'ventas_febrero.csv') }, output: 'mes,total', title: 'Lee febrero' },
    {
      type: 'tool',
      tool: 'read',
      input: { filePath: join(taskFolder, 'ventas_marzo.csv') },
      output: 'mes,total',
      title: 'Lee marzo',
      runMs: 120000
    }
  ]
  await fake.script({ match: 'Ahora cruza', title: 'Preparar informe de ventas', steps: nuevo })
  await sendTask(ctx.page, 'Prepara el informe de ventas del mes')
  await vis(ctx.page.getByText('el informe de ventas quedó preparado'), 45_000)
  const box = ctx.page.getByPlaceholder('Responde o pide un cambio…')
  await box.fill('Ahora cruza los datos de la carpeta')
  await ctx.page.getByRole('button', { name: 'Enviar' }).first().click()
  await vis(ctx.page.getByTestId('working-card'), 30_000)
  await sleep(2500)
}

// Dos tareas terminadas (se crean una sola vez por arranque, aunque varios escenarios las necesiten).
let taskListSeeded = false
async function seedTaskList(ctx) {
  const fake = await openTasks(ctx)
  if (taskListSeeded) return
  taskListSeeded = true
  await fake.script({
    match: 'Ordena los informes',
    title: 'Ordenar informes del trimestre',
    steps: [{ type: 'text', text: 'Ordené **12 informes** por mes en carpetas.' }]
  })
  await fake.script({
    match: 'Resume el contrato',
    title: 'Resumir contrato de arriendo',
    steps: [{ type: 'text', text: 'El contrato dura 24 meses y se reajusta por UF.' }]
  })
  for (const [t, done] of [
    ['Ordena los informes del trimestre', /Ordené/],
    ['Resume el contrato de arriendo', /24 meses/]
  ]) {
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
    const r = await page.evaluate(async (input) => JSON.stringify(await window.api.tasks.invoke('routines:save', input)).slice(0, 200), {
      name,
      prompt,
      mode,
      schedule,
      enabled,
      folder,
      model: { providerID: 'fake', modelID: 'fake-model' },
      sessionMode: 'fresh',
      onAsk: 'reject'
    })
    if (!r.includes('"ok":true')) console.error(`  [rutinas] routines:save: ${r}`)
  }
  await mk(
    'Resumen diario de ventas',
    'Resume las ventas de ayer y destaca anomalías.',
    'chat',
    { kind: 'daily', time: '08:30' },
    true,
    null
  )
  await mk(
    'Revisión semanal de dependencias',
    'Revisa dependencias desactualizadas y propone actualizaciones.',
    'code',
    { kind: 'weekly', day: 1, time: '09:00' },
    true,
    codeRepo
  )
  await mk(
    'Ordenar descargas',
    'Ordena la carpeta de descargas por tipo de archivo.',
    'tasks',
    { kind: 'interval', hours: 6 },
    false,
    taskFolder
  )
}

// Documentos de oficina de muestra (se generan al vuelo con las librerías del repo; nada binario versionado).
async function makeOfficeFixtures(dir) {
  const JSZip = require('jszip')
  const XLSX = require('xlsx')
  mkdirSync(dir, { recursive: true })
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const p = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`
  const docx = new JSZip()
  docx.file(
    'word/document.xml',
    `<w:document ${W}><w:body>${p('Informe del trimestre', 'Heading1')}${p('Las ventas del trimestre cerraron en $48,2 millones, un 12 % más que el anterior.')}${p('Detalle por mes', 'Heading2')}` +
      `<w:tbl><w:tr>${cell('Mes')}${cell('Ventas')}</w:tr><w:tr>${cell('Enero')}${cell('120')}</w:tr><w:tr>${cell('Febrero')}${cell('135')}</w:tr></w:tbl></w:body></w:document>`
  )
  docx.file('word/styles.xml', `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`)
  docx.file('docProps/app.xml', '<Properties><Pages>3</Pages></Properties>')
  writeFileSync(join(dir, 'informe-trimestre.docx'), await docx.generateAsync({ type: 'nodebuffer' }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['Mes', 'Ventas'], ['Enero', 120], ['Febrero', 135]])
  ws.B4 = { t: 'n', f: 'SUM(B2:B3)', v: 255 }
  ws['!ref'] = 'A1:B4'
  XLSX.utils.book_append_sheet(wb, ws, 'Ventas')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Zona', 'Meta'], ['Norte', 80], ['Centro', 60]]), 'Metas')
  writeFileSync(join(dir, 'ventas-2026.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  const sld = (title, bullets) =>
    `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  const pptx = new JSZip()
  pptx.file('ppt/slides/slide1.xml', sld('Resultados', ['Ventas al alza', 'Norte lidera']))
  pptx.file('ppt/slides/slide2.xml', sld('Próximos pasos', ['Abrir sucursal', 'Contratar dos personas']))
  pptx.file('ppt/slides/slide3.xml', sld('Preguntas', ['Gracias']))
  writeFileSync(join(dir, 'presentacion-resultados.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }))
  return ['informe-trimestre.docx', 'ventas-2026.xlsx', 'presentacion-resultados.pptx'].map((n) => join(dir, n))
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
  // Menú «…» de una conversación del Chat con «Copiar conversación», «Guardar como Markdown/PDF» y las opciones de exportación.
  async 'chat-exportar'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await ctx.page.getByText('Pruebas y corrección del IVA').first().click()
    await vis(ctx.page.getByText(/pruebas.*pasan/), 15_000)
    await sleep(500)
    const row = ctx.page.getByRole('treeitem', { name: /Pruebas y corrección del IVA/ })
    const openMenu = async () => {
      await row.hover()
      await sleep(250)
      await row.getByRole('button', { name: /^Opciones de/ }).click()
      await sleep(400)
    }
    // Con SHOT_EXPORT_DIR: verificación REAL de punta a punta. Se sustituye solo el diálogo nativo (que CDP no ve) por una ruta fija
    // dentro de esa carpeta; main genera de verdad el .md y el .pdf (printToPDF) y se lee el portapapeles real.
    const dir = process.env.SHOT_EXPORT_DIR
    if (dir) {
      await ctx.electronApp.evaluate(({ dialog }, d) => {
        dialog.showSaveDialog = async (...a) => ({ canceled: false, filePath: d + '/' + a[a.length - 1].defaultPath.split(/[\\/]/).pop() })
      }, dir)
      for (const label of ['Guardar como Markdown…', 'Guardar como PDF…', 'Copiar conversación']) {
        await openMenu()
        await ctx.page.getByRole('menuitem', { name: label, exact: true }).click()
        await vis(ctx.page.getByTestId('export-notice'), 20_000)
        console.log('VERIF-EXPORT ' + label + ' => ' + (await ctx.page.getByTestId('export-notice').innerText()).replace(/\s+/g, ' '))
        await sleep(600)
      }
      const clip = await ctx.electronApp.evaluate(({ clipboard }) => clipboard.readText())
      console.log('VERIF-CLIP ' + JSON.stringify(clip.slice(0, 160)))
    }
    await openMenu()
    ctx.hover = null
  },
  async 'chat-herramientas'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    await ctx.page.getByText('Pruebas y corrección del IVA').first().click()
    await vis(ctx.page.getByText(/pruebas.*pasan/), 15_000)
    // Las herramientas seguidas se pliegan en «N pasos»: se abre el grupo y luego la fila del comando.
    await ctx.page
      .getByRole('button', { name: /\d+ pasos/ })
      .first()
      .click()
    await ctx.page
      .getByRole('button', { name: /bash|npm test|Corre las pruebas/ })
      .first()
      .click()
    await sleep(500)
  },
  async 'chat-pregunta'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    await ctx.fake.script({
      match: 'presentación de ventas',
      title: 'Presentación de ventas',
      steps: [
        { type: 'text', text: 'Antes de armarla necesito saber el formato.' },
        {
          type: 'question',
          questions: [
            {
              header: 'Formato',
              question: 'Si la vas a presentar tal cual, te recomiendo el diseño libre. ¿Cuál prefieres?',
              multiple: false,
              custom: false,
              options: [
                { label: 'Editable (PowerPoint)', description: 'Un archivo .pptx que cambias después en PowerPoint.' },
                { label: 'Diseño libre (HTML/CSS)', description: 'Se ve mejor, pero el texto no se edita.' }
              ]
            }
          ]
        }
      ]
    })
    await sendChat(ctx.page, 'Hazme una presentación de ventas')
    await vis(ctx.page.getByRole('radio', { name: /Editable \(PowerPoint\)/ }), 45_000)
    await sleep(500)
  },
  // Documento generado en el Chat (bloque ```xlsx): se ve como tarjeta con miniatura, «Abrir» y «Descargar».
  async 'chat-documento'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    await ctx.fake.script({
      match: 'informe de ventas del trimestre',
      title: 'Informe de ventas',
      steps: [
        {
          type: 'text',
          text: 'Listo, armé el informe del trimestre con el total por mes y por vendedor.\n\n```xlsx\n{"sheets":[{"name":"Resumen","rows":[["Mes","Ventas"],["Enero",120],["Febrero",135]]},{"name":"Detalle","rows":[["Vendedor","Total"],["Ana",80]]},{"name":"Notas","rows":[["Nota"],["Cifras en millones"]]}]}\n```\n\nVentas totales: $48,2 millones, un 12 % más que el trimestre anterior.'
        }
      ]
    })
    await sendChat(ctx.page, 'Arma un informe de ventas del trimestre en Excel')
    await vis(ctx.page.locator('[data-doc-card]'), 45_000)
    await sleep(800)
  },
  // Archivos que la IA crea o menciona en el Chat: tarjetas con «Ver aquí», «Abrir con tu programa» y «Mostrar en la carpeta»
  // (el script solo ofrece «Mostrar en la carpeta»); se abre el resumen en Markdown en el panel lateral.
  async 'chat-archivo-ver'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    const dir = join(ctx.userData, 'chat-workspace')
    await ctx.fake.script({
      match: 'archivos del trimestre',
      title: 'Archivos del trimestre',
      steps: [
        {
          type: 'fs',
          op: 'write',
          path: 'resumen-ventas.md',
          content:
            '# Resumen de ventas\n\nEl trimestre cerró con **$48,2 millones**, un 12 % más que el anterior.\n\n| Mes | Ventas |\n| --- | --- |\n| Enero | 120 |\n| Febrero | 135 |\n\n- Norte lidera el crecimiento\n- Centro se mantiene estable\n'
        },
        {
          type: 'fs',
          op: 'write',
          path: 'grafico-ventas.svg',
          content:
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#eef2ff"/><rect x="40" y="90" width="50" height="70" fill="#4f46e5"/><rect x="120" y="60" width="50" height="100" fill="#4f46e5"/><rect x="200" y="30" width="50" height="130" fill="#4f46e5"/></svg>'
        },
        { type: 'fs', op: 'write', path: 'informe-trimestral.pdf', content: '%PDF-1.4\n' + 'x'.repeat(184_000) },
        { type: 'fs', op: 'write', path: 'preparar.sh', content: 'echo preparar\n' },
        {
          type: 'text',
          text: `Dejé estos archivos listos:\n\n- ${join(dir, 'resumen-ventas.md')}\n- ${join(dir, 'grafico-ventas.svg')}\n- ${join(dir, 'informe-trimestral.pdf')}\n- ${join(dir, 'preparar.sh')}`
        }
      ]
    })
    await sendChat(ctx.page, 'Prepárame los archivos del trimestre')
    await vis(ctx.page.locator('[data-chat-file]').first(), 45_000)
    await ctx.page.locator('[data-chat-file]').first().getByRole('button', { name: 'Ver aquí' }).click()
    await vis(ctx.page.locator('[data-chat-file-panel]'), 15_000)
    await sleep(800)
  },
  // Adjuntar Word, Excel y PowerPoint al Chat: main los convierte a texto y la tarjeta muestra tipo y cantidad (páginas/hojas/diapositivas).
  // Tras la captura envía el mensaje y comprueba en el motor falso que a la IA le llegó el contenido como TEXTO (VERIF-OFFICE).
  async 'chat-adjunto-office'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    const files = await makeOfficeFixtures(join(ctx.userData, 'office-muestras'))
    await ctx.page.locator('[data-testid="chat-file-input"]').setInputFiles(files)
    await vis(ctx.page.locator('[data-testid="chat-office-card"]').nth(2), 20_000)
    await ctx.page.getByPlaceholder('Escribe un mensaje…').fill('Resume estos tres documentos y dime qué falta para cerrar el trimestre')
    await sleep(500)
    // El `undo` corre tras todas las capturas de este escenario.
    return async () => {
      await ctx.page.getByRole('button', { name: 'Enviar' }).click()
      await sleep(2500)
      const res = await fetch(`${ctx.fake.conn.baseUrl}/__e2e/requests?path=/session&method=POST&limit=20`, {
        headers: { authorization: ctx.fake.conn.authorization }
      })
      const reqs = await res.json()
      const sent = reqs.find((r) => /prompt_async$/.test(r.path))
      const parts = sent?.body?.parts ?? []
      const texts = parts
        .filter((x) => x.type === 'file')
        .map((x) => ({ name: x.filename, mime: x.mime, text: Buffer.from(String(x.url).split(',')[1] ?? '', 'base64').toString('utf8') }))
      console.log('VERIF-OFFICE', JSON.stringify({ parts: parts.map((x) => x.type), files: texts.map((t) => ({ name: t.name, mime: t.mime, chars: t.text.length })) }))
      for (const t of texts) console.log(`VERIF-OFFICE-TEXT ${t.name}\n${t.text}\n--`)
    }
  },
  // El modelo propone «recordar esto» al final de su respuesta: tarjeta con casillas y texto editable; nada se guarda sin aprobar.
  async 'chat-memoria-propuesta'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    await ctx.fake.script({
      match: 'respuestas cortas',
      title: 'Respuestas cortas',
      steps: [
        {
          type: 'text',
          text: 'Entendido, de ahora en adelante te respondo en pocas líneas.\n\n```lazunox-memoria\n[{"alcance":"usuario","tipo":"preferencia","texto":"Prefiere respuestas cortas, de una o dos frases.","porque":"Lo pidió al empezar la conversación."},{"alcance":"usuario","tipo":"preferencia","texto":"Trabaja en diseño y no programa."}]\n```'
        }
      ]
    })
    await sendChat(ctx.page, 'Prefiero respuestas cortas, no soy programadora')
    await vis(ctx.page.locator('[data-testid="memory-proposal-card"]'), 45_000)
    await sleep(600)
  },
  async 'code-proyecto'(ctx) {
    await seedCode(ctx)
  },
  async 'code-diff'(ctx) {
    await seedCode(ctx)
    await togglePanel(ctx.page, 'Cambios')
  },
  // Espacio de trabajo de Code: lista con estados por sesión + conversación + panel «Cambios» fijo a la derecha (o en superposición si no cabe).
  async 'code-cambios'(ctx) {
    await S['barra-code'](ctx)
    await togglePanel(ctx.page, 'Cambios')
  },
  async 'code-cambios-archivo'(ctx) {
    await S['code-cambios'](ctx)
    await ctx.page.getByRole('complementary').getByText('carrito.ts').first().click()
    await sleep(900)
  },
  // Panel «Entorno» abierto en la barra de Code: equipo, carpeta del proyecto y rama.
  async 'code-entorno'(ctx) {
    await seedCode(ctx)
    await ctx.page.getByRole('main').getByRole('button', { name: 'Entorno', exact: true }).first().click()
    await vis(ctx.page.getByRole('dialog', { name: /Entorno/ }), 15_000)
    await sleep(600)
    return async () => {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
  },
  // Franja del motor: se usa un OpenCode elegido aparte (ruta en ajustes, versión 1.18.32 del falso) y la app trae otro incluido
  // (1.19.0 probado): tarjeta en lenguaje llano con «Usar el motor incluido» y «Ahora no». Grupo propio (necesita ajustes y entorno propios).
  async 'aviso-motor'(ctx) {
    const bar = ctx.page.getByRole('status').filter({ hasText: 'motor de IA instalado aparte' })
    await vis(bar, 20_000)
    await sleep(500)
  },
  async 'code-terminal'(ctx) {
    await seedCode(ctx)
    await togglePanel(ctx.page, 'Terminal')
    await sleep(800)
    await ctx.page.mouse.click(1000, 300)
    // bash/zsh en macOS; PowerShell en Windows (`export` no existe alli).
    await ctx.page.keyboard.type(
      WIN
        ? "function prompt { 'demo@tienda-web > ' }; Clear-Host; git status --short"
        : "export PS1='demo@tienda-web % '; clear; git status --short"
    )
    await ctx.page.keyboard.press('Enter')
    await sleep(1200)
  },
  // Terminal con pestañas: la primera (renombrada «servidor») deja un proceso largo en marcha y la segunda, recién abierta con «+», corre
  // otro comando a la vez; cada pestaña tiene su shell y su salida.
  async 'code-terminal-pestanas'(ctx) {
    const { page } = ctx
    await seedCode(ctx)
    await togglePanel(page, 'Terminal')
    await sleep(800)
    await page.mouse.click(1000, 300)
    await page.keyboard.type(
      WIN
        ? "function prompt { 'demo@tienda-web > ' }; Clear-Host; Write-Output 'servidor escuchando en :3000'; Start-Sleep 300"
        : "export PS1='demo@tienda-web % '; clear; echo 'servidor escuchando en :3000'; sleep 300"
    )
    await page.keyboard.press('Enter')
    await sleep(1000)
    await page.getByTestId('terminal-tab').first().getByRole('tab').dblclick()
    await page.getByRole('textbox', { name: 'Cambiar el nombre de la pestaña' }).fill('servidor')
    await page.keyboard.press('Enter')
    await sleep(300)
    await page.getByTestId('terminal-new-tab').click()
    await vis(page.getByTestId('terminal-tab').nth(1), 10_000)
    await sleep(1200)
    await page.keyboard.type(
      WIN
        ? "function prompt { 'demo@tienda-web > ' }; Clear-Host; git status --short"
        : "export PS1='demo@tienda-web % '; clear; git status --short"
    )
    await page.keyboard.press('Enter')
    await sleep(1200)
  },
  // ▶ con la pestaña seleccionada ocupada: el aviso ofrece «Usar una pestaña nueva» o «Abrir en la terminal». Se captura el aviso; el
  // guion además elige la pestaña nueva y comprueba que el segundo comando corre ahí (dos pestañas, cada una con su comando).
  async 'code-terminal-pestanas-ocupada'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'dos comandos',
      title: 'Dos comandos',
      steps: [
        {
          type: 'text',
          text: 'Primero este, que tarda:\n\n```bash\necho uno-corriendo && sleep 40\n```\n\nY luego este:\n\n```bash\necho dos-listo\n```'
        }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('dame dos comandos')
    await box.press('Enter')
    const runs = page.getByRole('button', { name: 'Ejecutar en la terminal' })
    await vis(runs.first(), 45_000)
    await runs.first().click()
    await vis(page.getByText('uno-corriendo').first(), 20_000)
    await sleep(800)
    await page.locator('[data-shell-block]').last().getByTestId('shell-run').click()
    await vis(page.getByText('La terminal está ocupada'), 15_000)
    await sleep(500)
    return async () => {
      await page.getByTestId('confirm-alt').waitFor({ state: 'visible', timeout: 5000 })
      await page.getByRole('button', { name: 'Usar una pestaña nueva' }).click()
      await vis(page.getByTestId('terminal-tab').nth(1), 10_000)
      await sleep(2500)
      console.log('VERIF-PESTANAS ' + JSON.stringify(await page.getByTestId('terminal-tab').allInnerTexts()))
      console.log('VERIF-TARJETAS ' + JSON.stringify(await page.locator('[data-shell-output]').allInnerTexts()))
      await sleep(300)
    }
  },
  // Bloques de comando de una respuesta: compactos, con ▶ y copiar; al pulsar ▶ aparece la tarjeta con la salida en vivo
  // (aquí un comando que pide contraseña: «Esperando que escribas…») y la IA ve esa salida (envío automático sin claves).
  async 'code-ejecutar'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'Instala lo necesario',
      title: 'Instalar herramientas',
      steps: [
        {
          type: 'text',
          text: 'Para instalar la herramienta corre este comando:\n\n```bash\necho "Instalando ripgrep..." && printf "[sudo] contrase\u00f1a para demo: " && sleep 25\n```\n\nY despu\u00e9s limpia la carpeta de compilaci\u00f3n:\n\n```bash\nrm -rf dist\n```'
        }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('Instala lo necesario para buscar texto')
    await box.press('Enter')
    const run = page.getByRole('button', { name: 'Ejecutar en la terminal' })
    await vis(run.first(), 45_000)
    await sleep(500)
    await run.first().click()
    await vis(page.getByText(/Esperando que escribas/).first(), 20_000)
    await sleep(1500)
    await page.locator('[data-shell-output]').first().scrollIntoViewIfNeeded({ timeout: 10_000 })
    await sleep(400)
  },
  // Mismo mensaje: el comando delicado (rm -rf) muestra la confirmación con el comando completo.
  async 'code-ejecutar-confirmar'(ctx) {
    await S['code-ejecutar'](ctx)
    await ctx.page.locator('[data-shell-block]').last().getByTestId('shell-run').click()
    await vis(ctx.page.getByText('¿Ejecutar en la terminal?'), 15_000)
    await sleep(500)
    return async () => {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
  },
  // Lo que recibe la IA: el mensaje «Ejecuté el comando y esto salió:» con la salida limpia (sin prompt ni eco).
  async 'code-ejecutar-mensaje'(ctx) {
    await S['code-ejecutar'](ctx)
    await ctx.page.getByText('Ejecuté el comando y esto salió:').last().scrollIntoViewIfNeeded()
    await ctx.page.mouse.move(800, 400)
    await ctx.page.mouse.wheel(0, 2000)
    await sleep(600)
  },
  // Regresión «el ▶ no reconoce el regreso del prompt»: terminal recién abierta, panel angosto, prompt real del shell. La tarjeta debe
  // pasar a «Terminó», con solo la salida del comando, y el mensaje a la IA no debe llevar el prompt ni «sigue en ejecución».
  async 'code-ejecutar-termina'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'dame el comando',
      title: 'Comando de prueba',
      steps: [{ type: 'text', text: 'Este es el comando:\n\n```bash\necho hola-desde-lazunox && sleep 2 && echo fin\n```' }]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('dame el comando de prueba')
    await box.press('Enter')
    const run = page.getByRole('button', { name: 'Ejecutar en la terminal' })
    await vis(run.first(), 45_000)
    await run.first().click()
    await vis(page.locator('[data-shell-output]').getByText('Terminó'), 20_000).catch(async (e) => {
      console.log(
        'VERIF-FALLO-TARJETA ' +
          JSON.stringify(
            await page
              .locator('[data-shell-output]')
              .first()
              .innerText()
              .catch(() => 'sin tarjeta')
          )
      )
      throw e
    })
    await sleep(1500)
    const card = await page.locator('[data-shell-output]').first().innerText()
    const sent = await page
      .getByText('Ejecuté el comando y esto salió:')
      .last()
      .evaluate((el) => el.closest('div')?.parentElement?.innerText ?? el.innerText)
    console.log('VERIF-TARJETA ' + JSON.stringify(card))
    console.log('VERIF-MENSAJE ' + JSON.stringify(sent))
    await sleep(400)
  },
  // Terminal con salida de un error y el botón «Preguntar a la IA sobre esto»: deja la pastilla (sin claves) en el compositor.
  async 'code-terminal-ia'(ctx) {
    await seedCode(ctx)
    await togglePanel(ctx.page, 'Terminal')
    await sleep(800)
    await ctx.page.mouse.click(1000, 300)
    await ctx.page.keyboard.type(
      WIN
        ? "function prompt { 'demo@tienda-web > ' }; Clear-Host; Write-Output 'Error: Cannot find module zod'; Write-Output 'OPENAI_API_KEY=sk-demo1234567890abcdef'"
        : "export PS1='demo@tienda-web % '; clear; echo 'Error: Cannot find module zod'; echo 'OPENAI_API_KEY=sk-demo1234567890abcdef'"
    )
    await ctx.page.keyboard.press('Enter')
    await sleep(1200)
    await ctx.page.getByRole('button', { name: 'Preguntar a la IA sobre esto' }).click()
    await vis(ctx.page.getByTestId('terminal-output-pill'), 10_000)
    await sleep(500)
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
  // «Plan» visible: tarjeta con los pasos del agente (3 de 5 listos, uno en curso con cronómetro).
  async 'code-plan'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'Arma el informe',
      title: 'Informe de ventas',
      steps: [
        { type: 'text', text: 'Voy a armar el informe paso a paso.' },
        {
          type: 'todo',
          todos: [
            { content: 'Revisar la carpeta de ventas', status: 'completed', priority: 'high' },
            { content: 'Leer los tres meses', status: 'completed', priority: 'high' },
            { content: 'Calcular totales por mes y vendedor', status: 'completed', priority: 'high' },
            { content: 'Armar el Excel con tres hojas', status: 'in_progress', priority: 'high' },
            { content: 'Revisar que los números cuadren', status: 'pending', priority: 'medium' }
          ]
        }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('Arma el informe de ventas del trimestre')
    await box.press('Enter')
    await vis(page.getByTestId('plan-card'), 45_000)
    await sleep(2500)
  },
  // Tarjetas de archivo: el turno escribe un .xlsx (herramienta `write`) y menciona un .pdf que ya existe en el proyecto.
  async 'code-archivo'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'Arma el Excel',
      title: 'Excel de ventas',
      steps: [
        { type: 'fs', op: 'write', path: 'informe-ventas.xlsx', content: 'x'.repeat(18_400) },
        { type: 'fs', op: 'write', path: 'docs/negocios_ganados_2026.pdf', content: 'x'.repeat(412_000) },
        { type: 'text', text: 'Voy a armar el Excel con los totales.' },
        {
          type: 'tool',
          tool: 'write',
          input: { filePath: join(codeRepo, 'informe-ventas.xlsx'), content: '' },
          output: 'Wrote file successfully.',
          title: 'informe-ventas.xlsx'
        },
        { type: 'text', text: `Listo. También actualicé el PDF: ${join(codeRepo, 'docs', 'negocios_ganados_2026.pdf')}` }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('Arma el Excel de ventas')
    await box.press('Enter')
    await vis(page.locator('[data-file-card]').first(), 45_000)
    await sleep(800)
  },
  async 'code-pregunta'(ctx) {
    await openCode(ctx)
    const { page, fake } = ctx
    await fake.script({
      match: 'Elige el formato',
      title: 'Elegir formato',
      steps: [
        { type: 'text', text: 'Antes de armarla necesito saber el formato.' },
        {
          type: 'question',
          questions: [
            {
              header: 'Formato',
              question: 'Si la vas a presentar tal cual, te recomiendo el diseño libre. ¿Cuál prefieres?',
              multiple: false,
              custom: false,
              options: [
                { label: 'Editable (PowerPoint)', description: 'Un archivo .pptx que cambias después en PowerPoint.' },
                { label: 'Diseño libre (HTML/CSS)', description: 'Se ve mejor, pero el texto no se edita.' }
              ]
            }
          ]
        }
      ]
    })
    const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('Elige el formato del informe')
    await box.press('Enter')
    await vis(page.getByRole('radio', { name: /Editable \(PowerPoint\)/ }), 45_000)
    await sleep(500)
  },
  async 'tareas-primer-uso'(ctx) {
    await openTasks(ctx, { keepOnboarding: true })
    await vis(ctx.page.getByRole('region', { name: 'Así funcionan las tareas' }), 30_000)
    await sleep(400)
  },
  async 'tareas-nueva'(ctx) {
    await openTasks(ctx)
    await ctx.page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await vis(ctx.page.getByPlaceholder('Describe la tarea que quieres delegar…'), 15_000)
    await sleep(500)
  },
  // Inicio de Tareas de una carpeta sin tareas (primera vez): se ve como siempre, con las sugerencias abiertas y sin bloques vacíos.
  async 'inicio-vacio'(ctx) {
    await openTasks(ctx)
    await ctx.page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await vis(ctx.page.getByPlaceholder('Describe la tarea que quieres delegar…'), 15_000)
    await vis(ctx.page.getByRole('button', { name: 'Ocultar sugerencias' }), 15_000)
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
        {
          type: 'todo',
          todos: [
            { content: 'Reunir datos de ventas', status: 'completed', priority: 'high' },
            { content: 'Calcular totales por región', status: 'in_progress', priority: 'high' },
            { content: 'Redactar resumen', status: 'pending', priority: 'medium' }
          ]
        },
        { type: 'tool', tool: 'bash', input: { command: 'ls ventas' }, output: 'enero.csv\nfebrero.csv\n', title: 'Lista ventas' },
        { type: 'delay', ms: 120000 }
      ]
    })
    await sendTask(ctx.page, 'Prepara el informe de ventas del mes')
    await vis(ctx.page.getByText('Calcular totales por región'), 45_000)
    await sleep(800)
  },
  // Turno viejo con plan completo y turno nuevo en curso: la tarjeta NO debe mostrar el plan viejo (sin plan: contadores y fases).
  async 'tareas-progreso'(ctx) {
    await progresoDosTurnos(ctx, false)
  },
  // Igual, pero el turno nuevo ya publicó su propio plan: barra segmentada con el paso en curso y la lista de pasos.
  async 'tareas-progreso-plan'(ctx) {
    await progresoDosTurnos(ctx, true)
  },
  async 'tareas-permiso'(ctx) {
    const fake = await freshTasks(ctx)
    await fake.script({
      match: 'Borra los temporales',
      title: 'Limpiar archivos temporales',
      steps: [
        { type: 'text', text: 'Necesito ejecutar un comando para limpiar.' },
        { type: 'permission', permission: 'bash', patterns: ['rm -rf temporales/*'] }
      ]
    })
    await sendTask(ctx.page, 'Borra los temporales de la carpeta')
    await vis(ctx.page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await sleep(500)
  },
  // Plan de Control total que no controla ninguna app: tarjeta con el botón «Cambiar a Solo en tu carpeta».
  async 'tareas-plan-sin-apps'(ctx) {
    const fake = await freshFullControl(ctx)
    await fake.script(planSinApps('Ordena los archivos', 'Ordenar archivos'))
    await sendTask(ctx.page, 'Ordena los archivos de la carpeta')
    await vis(ctx.page.getByRole('button', { name: CAMBIAR_A_CARPETA }), 45_000)
    await sleep(500)
  },
  // Pulsa el botón: el plan se cancela, el modo pasa a «Solo en tu carpeta» y la tarea queda lista para reenviar.
  async 'tareas-plan-sin-apps-cambio'(ctx) {
    const { page } = ctx
    const fake = await freshFullControl(ctx)
    await fake.script(planSinApps('Ordena los documentos', 'Ordenar documentos'))
    await sendTask(page, 'Ordena los documentos de la carpeta')
    await vis(page.getByRole('button', { name: CAMBIAR_A_CARPETA }), 45_000)
    await page.getByRole('button', { name: CAMBIAR_A_CARPETA }).click()
    await page.getByRole('radio', { name: 'Solo en tu carpeta', exact: true, checked: true }).waitFor({ state: 'visible', timeout: 60_000 })
    await sleep(1500)
    // La tarjeta desapareció y el campo para escribir de nuevo está disponible.
    await page.getByRole('button', { name: CAMBIAR_A_CARPETA }).waitFor({ state: 'detached', timeout: 10_000 })
    const box = page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await vis(box, 30_000)
    // El mensaje de la tarea cancelada queda en el compositor para reenviarlo.
    const val = await box.inputValue()
    if (val !== 'Ordena los documentos de la carpeta') throw new Error(`compositor sin el mensaje original: «${val}»`)
  },
  // Panel «Entorno» abierto en la cabecera de una tarea: equipo, carpeta, modo con «Cambiar» y punto de restauración.
  async 'tareas-entorno'(ctx) {
    const fake = await freshTasks(ctx)
    await fake.script({
      match: 'Resume la carpeta',
      title: 'Resumir la carpeta',
      steps: [{ type: 'text', text: 'Listo: revisé la carpeta y no hay nada pendiente.' }]
    })
    await sendTask(ctx.page, 'Resume la carpeta de informes')
    await vis(ctx.page.getByText('Listo: revisé la carpeta'), 45_000)
    await ctx.page.getByRole('main').getByRole('button', { name: 'Entorno', exact: true }).first().click()
    await vis(ctx.page.getByRole('dialog', { name: /Entorno/ }), 15_000)
    await sleep(600)
    return async () => {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
  },
  // Inicio con trabajo pendiente: una tarea con permiso y otra con pregunta esperando, más dos terminadas; tarjeta «Esperando tu aprobación» y «Retomar».
  async 'inicio-pendientes'(ctx) {
    const fake = await openTasks(ctx)
    await seedTaskList(ctx)
    await fake.script({
      match: 'Borra los temporales',
      title: 'Limpiar archivos temporales',
      steps: [
        { type: 'text', text: 'Necesito ejecutar un comando para limpiar.' },
        { type: 'permission', permission: 'bash', patterns: ['rm -rf temporales/*'] }
      ]
    })
    await sendTask(ctx.page, 'Borra los temporales de la carpeta')
    await vis(ctx.page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
    await fake.script({
      match: 'Elige el formato',
      title: 'Elegir formato del informe',
      steps: [
        { type: 'text', text: 'Antes de armarlo necesito saber el formato.' },
        {
          type: 'question',
          questions: [
            {
              header: 'Formato',
              question: '¿Cuál prefieres?',
              multiple: false,
              custom: false,
              options: [
                { label: 'Editable (PowerPoint)', description: 'Un archivo .pptx que cambias después.' },
                { label: 'Diseño libre (HTML/CSS)', description: 'Se ve mejor, pero el texto no se edita.' }
              ]
            }
          ]
        }
      ]
    })
    await sendTask(ctx.page, 'Elige el formato del informe')
    await vis(ctx.page.getByRole('radio', { name: /Editable \(PowerPoint\)/ }), 45_000)
    await ctx.page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await vis(ctx.page.getByRole('region', { name: 'Esperando tu aprobación' }), 15_000)
    await sleep(600)
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
  // Editor con la pestaña «Archivo»: disparador por carpeta (filtro, estabilización, tope por hora).
  async 'rutinas-evento'(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    await ctx.page.getByRole('button', { name: 'Nueva rutina' }).first().click()
    await vis(ctx.page.getByRole('dialog', { name: 'Nueva rutina' }), 15_000)
    await ctx.page.getByRole('button', { name: 'Archivo', exact: true }).click()
    await vis(ctx.page.getByTestId('file-trigger-fields'), 10_000)
    await ctx.page.getByLabel('Solo archivos como (opcional)').fill('*.pdf, factura-*.csv')
    await sleep(600)
    return async () => {
      await ctx.page.keyboard.press('Escape')
      await sleep(300)
    }
  },
  // Bandeja «Resultados por revisar»: ejecuta dos rutinas con el motor falso y fotografía lo que queda por revisar (más el contador del riel).
  async 'rutinas-bandeja'(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    for (const name of ['Resumen diario de ventas', 'Revisión semanal de dependencias']) {
      await ctx.page.evaluate(async (n) => {
        const list = (await window.api.tasks.invoke('routines:list')).data
        const r = list.find((x) => x.name === n)
        if (r) await window.api.tasks.invoke('routines:runNow', { id: r.id })
      }, name)
      await sleep(500)
    }
    await ctx.page.getByTestId('inbox-item').first().waitFor({ state: 'visible', timeout: 60_000 })
    await sleep(1500)
    const first = ctx.page.getByRole('button', { name: 'Ver detalle' }).first()
    await first.click()
    await sleep(600)
  },
  // Prueba de punta a punta del disparador por archivo con el motor falso y userData temporal: un archivo = una ejecución,
  // lo que aparece justo al terminar no dispara, cinco seguidos = una ejecución agrupada y el tope por hora frena la siguiente.
  async 'rutinas-evento-e2e'(ctx) {
    await seedRoutines(ctx)
    await goMode(ctx.page, 'Rutinas')
    const dir = mkdtempSync(join(homedir(), 'lazunox-shotd-evt-'))
    const inv = (ch, payload) =>
      ctx.page.evaluate(([c, p]) => window.api.tasks.invoke(c, p), [ch, payload]).then((r) => (r.ok ? r.data : Promise.reject(new Error(JSON.stringify(r)))))
    const saved = await inv('routines:save', {
      name: 'Clasificar facturas (E2E)',
      prompt: 'Resume {{archivo}}',
      mode: 'chat',
      folder: null,
      model: { providerID: 'fake', modelID: 'fake-model' },
      schedule: { kind: 'file', folder: dir, patterns: ['*.txt'], on: 'create', settleSec: 1, maxPerHour: 2 },
      enabled: true
    })
    const runs = async () => (await inv('routines:history', { id: saved.id, limit: 50 })).filter((h) => h.trigger === 'file')
    const waitRuns = async (n, ms) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        const r = await runs()
        if (r.length >= n && r.every((x) => x.status !== 'running')) return r
        await sleep(500)
      }
      return runs()
    }
    await sleep(2500) // el vigilante arranca al guardar
    writeFileSync(join(dir, 'uno.txt'), 'a')
    const r1 = await waitRuns(1, 20_000)
    writeFileSync(join(dir, 'salida-de-la-rutina.txt'), 'x') // lo que aparece justo al terminar es salida propia
    await sleep(9000)
    const r1b = await runs()
    console.log('VERIF-EVENTO-1 ' + JSON.stringify({ ejecuciones: r1.length, tras_salida_propia: r1b.length, archivos: r1[0]?.triggerFiles }))
    await sleep(6000) // pasa el margen anti-bucle
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `lote${i}.txt`), String(i))
    const r2 = await waitRuns(2, 25_000)
    console.log('VERIF-EVENTO-5 ' + JSON.stringify({ ejecuciones: r2.length, archivos_ultima: r2[0]?.triggerFiles }))
    await sleep(6000)
    writeFileSync(join(dir, 'tercero.txt'), 'z') // tope de 2 por hora alcanzado
    await sleep(9000)
    const r3 = await runs()
    const info = (await inv('routines:list')).find((x) => x.id === saved.id)
    const inbox = await inv('routines:inbox:list')
    console.log('VERIF-EVENTO-TOPE ' + JSON.stringify({ ejecuciones: r3.length, fileWatch: info.fileWatch, bandeja_pendiente: inbox.filter((i) => i.status === 'pending' && i.routineId === saved.id).length }))
    await sleep(800)
    rmSync(dir, { recursive: true, force: true })
  },
  async 'ajustes-general'(ctx) {
    await openSettings(ctx.page, 'General')
  },
  async 'ajustes-modelos'(ctx) {
    await openSettings(ctx.page, 'Modelos')
  },
  // Memoria aprobada (notas inventadas escritas en el formato del almacén, en el userData TEMPORAL): ver, buscar, editar, borrar.
  async 'ajustes-memoria'(ctx) {
    const dir = join(ctx.userData, 'memoria')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'usuario.md'),
      [
        '---',
        'alcance: usuario',
        'actualizado: 2026-10-16',
        '---',
        '# Memoria aprendida (global)',
        '',
        '## Preferencias',
        '- Prefiere respuestas cortas, de una o dos frases. <!-- m-a1b2c3d4 · 2026-10-16 -->',
        '- Escribe en español de Chile y tutea. <!-- m-a1b2c3d5 · 2026-10-15 -->',
        '',
        '## Convenciones',
        '- Los informes llevan el total por mes arriba. <!-- m-a1b2c3d6 · 2026-10-14 -->',
        '',
        '## Decisiones',
        '- Los montos van en millones de pesos. <!-- m-a1b2c3d7 · 2026-10-12 -->',
        '',
        '## Soluciones',
        ''
      ].join('\n')
    )
    await openSettings(ctx.page, 'Memoria')
    await vis(ctx.page.locator('[data-testid="memory-entry"]').first(), 15_000)
    await sleep(400)
  },
  // Instrucciones personalizadas (Chat y Code) y AGENTS.md del proyecto abierto en Code, con el texto escrito pero sin guardar.
  async 'ajustes-instrucciones'(ctx) {
    await seedCode(ctx)
    await openSettings(ctx.page, 'Instrucciones')
    const g = ctx.page.locator('[data-testid="user-instructions"]')
    await vis(g, 15_000)
    await g.fill('Respóndeme siempre en español de Chile y en una sola frase. Soy diseñadora y no sé programar.')
    await g.blur()
    await sleep(400)
    const p = ctx.page.locator('[data-testid="project-instructions-text"]')
    await vis(p, 15_000)
    await p.fill(
      '# Convenciones\n\n- Usa pnpm, no npm.\n- Las pruebas van con Vitest y viven junto al archivo.\n- No toques la carpeta `dist/`.'
    )
    await sleep(500)
  },
  // Buscador: ⌘F enfoca el campo, se escribe una palabra que está en varias secciones y se ven los resultados agrupados y resaltados.
  async 'ajustes-buscar'(ctx) {
    const { page } = ctx
    await openSettings(page, 'General')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    await sleep(300)
    const box = page.locator('[data-testid="settings-search"]')
    if (!(await box.evaluate((el) => el === document.activeElement))) throw new Error('⌘F no enfocó el buscador de Ajustes')
    await page.keyboard.type('modelo', { delay: 30 })
    await vis(page.locator('[data-testid="settings-search-panel"] [role="option"]').first(), 5000)
    const n = await page.locator('[data-testid="settings-search-panel"] [role="option"]').count()
    const marks = await page.locator('[data-testid="settings-search-panel"] mark').count()
    const sidebarList = await page.locator('aside[data-rail][data-collapsed]').count()
    console.log('VERIF-BUSCAR ' + JSON.stringify({ resultados: n, resaltados: marks, listaPlegada: sidebarList === 1 }))
    await page.keyboard.press('ArrowDown')
    await sleep(500)
  },
  async 'ajustes-importar'(ctx) {
    const { page } = ctx
    const fakeKey = ['sk', 'ant', 'api03', 'Zq8'.repeat(10)].join('-')
    const fakeToken = ['ghp', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2'].join('_')
    const proj = mk(TMP, 'import-')
    writeFileSync(join(proj, 'CLAUDE.md'), '# Convenciones\n\n- Responde siempre en español.\n- Las pruebas van con Vitest y viven junto al archivo.\n')
    writeFileSync(
      join(proj, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          buscador: { command: 'npx', args: ['-y', '@acme/search-mcp'], env: { SEARCH_API_KEY: fakeKey, MODE: 'fast' } },
          docs: { type: 'http', url: 'https://mcp.example.com/docs', headers: { Authorization: `Bearer ${fakeToken}` } },
          limpiador: { command: 'sudo', args: ['rm', '-rf', '/tmp/x'] },
          directo: { command: 'npx', args: ['-y', 'pkg', '--api-key', fakeKey] }
        }
      })
    )
    await stubDialog(ctx, [proj])
    await openSettings(page, 'Importar')
    await vis(page.locator('[data-import-pick="project-folder"]'), 15_000)
    await page.locator('[data-import-pick="project-folder"]').click()
    await vis(page.locator('[data-testid="import-preview"]'), 15_000)
    await page.locator('[data-import-item="i0"] input').check()
    await page.locator('[data-import-item="m0"] input').check()
    const text = await page.locator('[data-testid="import-section"]').innerText()
    const leaked = [fakeKey, fakeToken, 'fast'].filter((x) => text.includes(x))
    const boxes = await page.locator('[data-testid="import-preview"] input[type="checkbox"]').count()
    const discarded = await page.locator('[data-testid="import-discarded"] li').count()
    console.log('VERIF-IMPORTAR ' + JSON.stringify({ casillas: boxes, descartados: discarded, secretosEnPantalla: leaked.length }))
    if (leaked.length) throw new Error('un secreto falso apareció en pantalla')
    // Sin importar nada todavía: lo marcado se importaría al pulsar el botón (se comprueba aparte en la prueba con la app real).
    await sleep(500)
    rmSync(proj, { recursive: true, force: true })
  },
  // Importar de verdad contra la app real (userData temporal): marca CLAUDE.md y un servidor, importa y comprueba en disco que el servidor
  // quedó DESACTIVADO, que la clave falsa no está en ningún archivo y que AGENTS.md se creó.
  async 'ajustes-importar-hecho'(ctx) {
    const { page } = ctx
    const fakeKey = ['sk', 'ant', 'api03', 'Zq8'.repeat(10)].join('-')
    const proj = mk(TMP, 'import-')
    writeFileSync(join(proj, 'CLAUDE.md'), '# Convenciones\n\n- Responde siempre en español.\n')
    writeFileSync(
      join(proj, '.mcp.json'),
      JSON.stringify({ mcpServers: { buscador: { command: 'npx', args: ['-y', '@acme/search-mcp'], env: { SEARCH_API_KEY: fakeKey } } } })
    )
    await stubDialog(ctx, [proj])
    await openSettings(page, 'Importar')
    await page.locator('[data-import-pick="project-folder"]').click()
    await vis(page.locator('[data-testid="import-preview"]'), 15_000)
    await page.locator('[data-import-item="i0"] input').check()
    await page.locator('[data-import-item="m0"] input').check()
    await page.locator('[data-import-apply]').click()
    await vis(page.locator('[data-testid="import-done"]'), 15_000)
    await sleep(600)
    const cfgPath = join(ctx.userData, 'opencode', 'opencode.json')
    const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : ''
    const agents = existsSync(join(proj, 'AGENTS.md')) ? readFileSync(join(proj, 'AGENTS.md'), 'utf8') : ''
    const parsed = cfg ? JSON.parse(cfg) : {}
    const screen = await page.locator('[data-testid="import-section"]').innerText()
    const v = {
      mcpGuardado: !!parsed.mcp?.buscador,
      desactivado: parsed.mcp?.buscador?.enabled === false,
      variablePorNombre: parsed.mcp?.buscador?.environment?.SEARCH_API_KEY === '{env:SEARCH_API_KEY}',
      claveEnArchivo: cfg.includes(fakeKey) || agents.includes(fakeKey),
      claveEnPantalla: screen.includes(fakeKey),
      agentsCreado: agents.startsWith('# Convenciones')
    }
    console.log('VERIF-IMPORTAR-HECHO ' + JSON.stringify(v))
    if (!v.mcpGuardado || !v.desactivado || !v.variablePorNombre || v.claveEnArchivo || v.claveEnPantalla || !v.agentsCreado) {
      throw new Error('la importación real no cumplió las garantías: ' + JSON.stringify(v))
    }
    rmSync(proj, { recursive: true, force: true })
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
  async 'caja-menus'(ctx) {
    await seedCode(ctx)
    const { page } = ctx
    const chip = page.getByRole('button', { name: /^Modo de permisos/ })
    await vis(chip, 15_000)
    await chip.click()
    await vis(page.getByRole('menuitemradio', { name: /Automático/ }), 10_000)
    await sleep(500)
    return async () => {
      await page.keyboard.press('Escape').catch(() => {})
    }
  },
  async 'selector-modelo'(ctx) {
    await closeOverlays(ctx.page)
    await newChat(ctx.page)
    await ctx.page
      .getByRole('button', { name: /Fake Model/ })
      .first()
      .click()
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
      await page
        .getByRole('dialog', { name: '¿Lanzar la comparación?' })
        .getByRole('button', { name: /Cancelar/ })
        .click()
        .catch(() => {})
    }
  },
  async comparar(ctx) {
    const { page, fake } = ctx
    await closeOverlays(page)
    await fake.script({
      scripts: [
        {
          forModel: MODELS[0].id,
          steps: [
            {
              type: 'text',
              text: 'Para pelar tomates: hazles un corte en cruz, sumérgelos **30 segundos** en agua hirviendo y pásalos a agua con hielo. La piel sale sola.'
            }
          ]
        },
        {
          forModel: MODELS[1].id,
          steps: [
            { type: 'reasoning', text: 'Pensando en el método más simple.' },
            {
              type: 'text',
              text: 'Escalda los tomates:\n\n1. Corte en cruz\n2. 1 minuto en agua hirviendo\n3. Agua fría\n\nLa piel se desprende fácil.'
            }
          ]
        }
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
  // ---- Barra lateral 2c ----
  // Chat: una conversación activa, una trabajando (el guion no termina) y el resto listas; todas bajo «Sin proyecto».
  async 'barra-chat'(ctx) {
    await seedChats(ctx)
    await closeOverlays(ctx.page)
    await goMode(ctx.page, 'Chat')
    if (!chatBusySeeded) {
      chatBusySeeded = true
      await ctx.fake.script({
        match: 'Prepara el informe mensual',
        title: 'Preparar informe mensual',
        steps: [
          { type: 'text', text: 'Reúno los datos del mes.' },
          { type: 'delay', ms: 120000 }
        ]
      })
      await newChat(ctx.page)
      await sendChat(ctx.page, 'Prepara el informe mensual de ventas')
      await sleep(1500)
    }
    await ctx.page
      .getByRole('treeitem', { name: /Plan del carrito de compras/ })
      .first()
      .click()
    await sleep(500)
  },
  // Chat con una fijada («Fijadas» arriba) y una archivada (botón con contador), y el menú «⋯» de una fila abierto (4 opciones).
  async 'barra-chat-fijadas'(ctx) {
    await S['barra-chat'](ctx)
    const { page } = ctx
    const menuOf = async (name) => {
      const row = page.getByRole('treeitem', { name })
      await row.hover()
      await sleep(250)
      await row.getByRole('button', { name: /^Opciones de/ }).click()
      await sleep(300)
    }
    const pick = async (label) => {
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await sleep(500)
    }
    if (!(await page.getByRole('group', { name: 'Fijadas' }).count())) {
      await menuOf(/Receta de pan casero/)
      await pick('Fijar')
    }
    if (!(await page.getByRole('button', { name: 'Ver las conversaciones archivadas' }).count())) {
      await menuOf(/Resumen semanal de ventas/)
      await pick('Archivar')
    }
    await menuOf(/Pruebas y corrección del IVA/)
    ctx.hover = null
  },
  // Code: proyecto con una sesión lista (activa), otra esperando aprobación y otra trabajando.
  async 'barra-code'(ctx) {
    await seedCode(ctx)
    const { page, fake } = ctx
    if (!codeTreeSeeded) {
      codeTreeSeeded = true
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
      await fake.script({
        match: 'Prepara el informe de cobertura',
        title: 'Preparar informe de cobertura',
        steps: [
          { type: 'text', text: 'Reúno la cobertura.' },
          { type: 'delay', ms: 120000 }
        ]
      })
      const ask = async (text) => {
        await page
          .getByRole('button', { name: /^Nueva sesión/ })
          .first()
          .click()
        await sleep(500)
        const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
        await box.fill(text)
        await box.press('Enter')
      }
      // Las sesiones nuevas del falso conservan el título por defecto: se renombran por la propia interfaz (doble clic en la fila).
      const rename = async (row, title) => {
        await row.dblclick()
        const input = page.locator('aside input').first()
        await input.fill(title)
        await input.press('Enter')
        await sleep(300)
      }
      await ask('Instala las dependencias del proyecto')
      await vis(page.getByRole('button', { name: 'Permitir una vez' }), 45_000)
      await rename(page.getByRole('treeitem', { name: /esperando/ }), 'Instalar dependencias')
      await ask('Prepara el informe de cobertura')
      await sleep(1500)
      await rename(page.getByRole('treeitem', { name: /trabajando/ }), 'Preparar informe de cobertura')
    }
    await page
      .getByRole('treeitem', { name: /Agregar IVA al carrito/ })
      .first()
      .click()
    await sleep(600)
  },
  async 'barra-code-hover'(ctx) {
    await S['barra-code'](ctx)
    ctx.hover = ctx.page.getByRole('treeitem', { name: /Preparar informe de cobertura/ })
  },
  async 'barra-code-menu'(ctx) {
    await S['barra-code'](ctx)
    const row = ctx.page.getByRole('treeitem', { name: /Preparar informe de cobertura/ })
    await row.hover()
    await sleep(250)
    await row.getByRole('button', { name: /^Acciones de/ }).click()
    await sleep(350)
    ctx.hover = null
  },
  // Inicio de Chat con conversaciones: una respondiendo arriba, «Retomar» con las recientes y las ideas plegadas.
  async 'inicio-chat'(ctx) {
    await S['barra-chat'](ctx)
    await newChat(ctx.page)
    await sleep(700)
  },
  // Inicio de Code con sesiones: la que espera aprobación arriba, «Retomar» y las ideas plegadas (sesión nueva abierta, vacía).
  async 'inicio-code'(ctx) {
    await S['barra-code'](ctx)
    await ctx.page
      .getByRole('button', { name: /^Nueva sesión/ })
      .first()
      .click()
    await sleep(900)
  },
  // Asistente de primer uso: `onbTo(n)` avanza o retrocede hasta «Paso n de m» (n = 0 es la primera pantalla, la bienvenida).
  async preparando(ctx) {
    await vis(ctx.page.getByTestId('preflight-screen'), 30_000)
    await sleep(600)
  },
  async 'preparando-motor'(ctx) {
    await vis(ctx.page.getByTestId('preflight-screen'), 30_000)
    await sleep(600)
  },
  async onboarding(ctx) {
    await onbTo(ctx, 0)
  },
  async 'onboarding-motor'(ctx) {
    await onbTo(ctx, 1)
  },
  async 'onboarding-inicio'(ctx) {
    await onbTo(ctx, 0)
  },
  async 'onboarding-conecta'(ctx) {
    await onbTo(ctx, 1 + ONB_OFFSET)
  },
  async 'onboarding-modelo'(ctx) {
    await onbTo(ctx, 2 + ONB_OFFSET)
  },
  async 'onboarding-modos'(ctx) {
    await onbTo(ctx, 3 + ONB_OFFSET)
  },
  async 'onboarding-final'(ctx) {
    await onbTo(ctx, 4 + ONB_OFFSET)
  }
}

// `ONB_OFFSET=1` (solo para comparar con versiones anteriores del asistente, que llevaban un paso más del motor siempre).
const ONB_OFFSET = Number(process.env.ONB_OFFSET ?? 0)
// Lleva el asistente al paso `n` (0 = bienvenida). Con el motor incluido hay 4 pasos; sin motor, 5 (el 1 es el del motor).
async function onbTo(ctx, n) {
  const { page } = ctx
  await vis(page.getByRole('dialog'), 30_000)
  for (let i = 0; i < 12; i++) {
    const welcome = await page
      .locator('#welcome-title')
      .isVisible()
      .catch(() => false)
    const cur = welcome
      ? 0
      : Number(
          (
            (await page
              .locator('header p')
              .first()
              .textContent()
              .catch(() => '')) ?? ''
          ).match(/Paso\s+(\d+)\s+de/)?.[1] ?? 0
        )
    if (cur === n) break
    if (cur > n) await page.getByRole('button', { name: 'Atrás', exact: true }).click()
    else if (welcome) {
      // «Empezar» (todo bien) o «Continuar» (había algo que atender); con «Empezar» deshabilitado se espera a que termine la revisión.
      const go = page.getByRole('button', { name: /^(Empezar|Continuar)$/ }).first()
      await go.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        () => [...document.querySelectorAll('button')].some((b) => /^(Empezar|Continuar)$/.test(b.textContent ?? '') && !b.disabled),
        null,
        { timeout: 15_000 }
      )
      await go.click()
    } else await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await sleep(500)
  }
  await sleep(n === 0 ? 2200 : 500) // la bienvenida entra con animaciones escalonadas (hasta ~1,5 s)
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
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: Math.min(height, 8000),
        deviceScaleFactor: DPR,
        mobile: false
      })
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
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: { ...clip, scale: 1 }
        })
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
            const names = await ctx.page.evaluate(() =>
              [...document.querySelectorAll('button,[role=menuitem],[role=dialog],[role=alertdialog]')]
                .map(
                  (b) =>
                    (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40) +
                    (b.getAttribute('role') ? `<${b.getAttribute('role')}>` : '')
                )
                .filter(Boolean)
                .slice(0, 60)
            )
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
    ctx.hover = null
    if (undo) await undo().catch(() => {})
    await closeOverlays(ctx.page).catch(() => {})
  }
}

try {
  if (WIN) {
    // Sin `uptime`: uso de CPU con typeperf (1 muestra). Si typeperf falla o no se entiende, no se comprueba la carga.
    try {
      const rows = execFileSync('typeperf', ['\\Processor(_Total)\\% Processor Time', '-sc', '1'], {
        encoding: 'utf8',
        timeout: 15_000
      }).split(/\r?\n/)
      const cpu = Number((rows.find((r) => /^"\d/.test(r)) ?? '').split('","')[1]?.replace(/"/g, ''))
      if (cpu > 90) throw new Error(`CPU alta (${cpu.toFixed(0)} %): no se lanza Electron.`)
    } catch (e) {
      if (/CPU alta/.test(String(e.message))) throw e
    }
  } else {
    const load = Number(
      execFileSync('sh', ['-c', "uptime | sed 's/.*load averages*: *//' | cut -d' ' -f1 | tr -d ','"], { encoding: 'utf8' })
        .trim()
        .replace(',', '.')
    )
    if (load > 8) throw new Error(`Carga del sistema alta (${load}): no se lanza Electron.`)
  }
  seedRepo(codeRepo)
  // Tareas y Rutinas van en otro arranque: el falso numera las sesiones igual en Chat y en Tareas (ids repetidos) y la
  // interfaz mezclaría mensajes entre ambos; con ids reales (únicos) no pasa.
  const isTasks = (s) => /^(tareas-|rutinas)/.test(s)
  const isOnb = (s) => s.startsWith('onboarding')
  const isPrep = (s) => s.startsWith('preparando')
  const isAviso = (s) => s === 'aviso-motor'
  const byOrder = (a, b) => SCENARIOS.indexOf(a) - SCENARIOS.indexOf(b)
  const main = scenarios.filter((s) => !isOnb(s) && !isPrep(s) && !isAviso(s) && s !== 'kit' && !isTasks(s))
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
  if (scenarios.includes('aviso-motor')) {
    const ctx = await launch('aviso', {
      settings: { opencodeBin: FAKE_BIN },
      env: { OPENCODE_BIN: '', LAZUNOX_TEST_BUNDLED_DIR: bundledDir }
    })
    await runGroup(ctx, ['aviso-motor'])
    await stop(ctx)
  }
  if (scenarios.includes('kit')) {
    const ctx = await launch('kit')
    await runKit(ctx)
    await stop(ctx)
  }
  // Revisión de arranque simulada: cada escenario con su propio arranque (la pantalla bloquea la app, no hay más que fotografiar).
  for (const [sc, kind] of [
    ['preparando', 'primer-uso'],
    ['preparando-motor', 'sin-motor']
  ]) {
    if (!scenarios.includes(sc)) continue
    const ctx = await launch(sc, { settings: { onboarded: false }, env: { LAZUNOX_TEST_PREFLIGHT: kind } })
    await runGroup(ctx, [sc])
    await stop(ctx)
  }
  const onb = scenarios.filter(isOnb).sort(byOrder)
  // Sin motor (OpenCode ausente): la bienvenida avisa y el asistente empieza por el paso del motor.
  const onbSin = onb.filter((s) => s === 'onboarding' || s === 'onboarding-motor')
  if (onbSin.length) {
    const ctx = await launch('onb', {
      settings: { onboarded: false },
      env: { OPENCODE_BIN: join(binDir, 'no-existe', 'opencode') },
      noServer: true
    })
    await runGroup(ctx, onbSin)
    await stop(ctx)
  }
  // Motor incluido y ninguna IA conectada: saludo directo y los cuatro pasos.
  const onbCon = onb.filter((s) => !onbSin.includes(s))
  if (onbCon.length) {
    const ctx = await launch('onb2', {
      settings: { onboarded: false },
      env: { OPENCODE_BIN: '', LAZUNOX_TEST_BUNDLED_DIR: onbBundledDir },
      noServer: true
    })
    await runGroup(ctx, onbCon)
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
