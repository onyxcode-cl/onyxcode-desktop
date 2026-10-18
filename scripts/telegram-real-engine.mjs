#!/usr/bin/env node
// Verificación MANUAL del puente con Telegram con el MOTOR REAL (OpenCode) y un modelo gratuito, contra el servidor de Telegram FALSO.
// No es parte de `npm test` ni de `verify` (necesita red hacia el modelo gratuito y el binario real del motor).
//
//   node scripts/telegram-real-engine.mjs [--bin /ruta/a/opencode] [--model opencode/deepseek-v4.1-flash-free] [--out DIR]
//
// Qué hace: arranca la app compilada (`out/`, ejecútala antes con `npx electron-vite build`) con un perfil y XDG TEMPORALES y
// `--use-mock-keychain`, con `LAZUNOX_TELEGRAM_API_BASE` apuntando a un servidor de Telegram falso local; vincula el chat por la
// interfaz, pide a la IA real que ejecute un comando en Code (permiso «Preguntar siempre»), comprueba que el servidor falso recibe el
// mensaje con los botones, «pulsa» Permitir por el servidor falso y espera a que el motor real continúe; después repite con la pantalla
// respondiendo primero (la carrera). Cierra todo y borra lo temporal. Semáforo de Electron: /tmp/lzx-electron.lock (mkdir atómico).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { startFakeTelegram } from '../e2e/fake-telegram/server.mjs'

const require = createRequire(import.meta.url)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : d
}
const MODEL = arg('model', 'opencode/deepseek-v4.1-flash-free')
const [PROVIDER, MODEL_ID] = MODEL.split('/')
const BIN = arg('bin', process.env.LAZUNOX_REAL_OPENCODE ?? join(repo, 'resources/opencode-bin/bin/opencode'))
const OUT = arg('out', '')
if (!existsSync(BIN)) throw new Error(`No encuentro el motor real: ${BIN} (usa --bin o LAZUNOX_REAL_OPENCODE)`)
if (!existsSync(join(repo, 'out/main/index.js'))) throw new Error('Falta out/: `npx electron-vite build`')

const TMP = '/private/tmp'
const TAG = `lazunox-tgreal-${process.pid}-`
const dirs = []
const mk = (n) => {
  const d = realpathSync(mkdtempSync(join(TMP, TAG + n)))
  dirs.push(d)
  return d
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (cond, ms, what) => {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`tiempo agotado esperando: ${what}`)
    await sleep(150)
  }
}

// Datos de mentira armados en tiempo de ejecución.
const SECRET = `${'Rt'.repeat(6)}-${'9cD'.repeat(8)}`.slice(0, 35)
const TOKEN = `${'6'.repeat(9)}:${SECRET}`
const CHAT = 515151

let app = null
let tg = null
let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  try {
    const pid = app?.process().pid
    await Promise.race([app?.close().catch(() => {}), sleep(6000)])
    if (pid) process.kill(pid, 'SIGKILL')
  } catch {
    /* ya cerrado */
  }
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
    for (const r of rows) {
      if (!r.includes(TAG) || r.includes('ps -axo')) continue
      const pid = Number(r.trim().split(/\s+/)[0])
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* ya muerto */
        }
      }
    }
  } catch {
    /* sin ps */
  }
  await tg?.stop().catch(() => {})
  await sleep(300)
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(130)))
const watchdog = setTimeout(() => cleanup().then(() => process.exit(2)), 420_000)

const report = {}
try {
  tg = await startFakeTelegram({ token: TOKEN })
  const userData = mk('ud-')
  const project = join(mk('proyecto-'), 'proyecto-prueba')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'LEEME.txt'), 'Carpeta de prueba del puente con Telegram.\n')
  const xdg = (n) => {
    const d = join(userData, 'xdg', n)
    mkdirSync(d, { recursive: true })
    return d
  }
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      defaultModel: { providerID: PROVIDER, modelID: MODEL_ID },
      theme: 'dark',
      recentFolders: [],
      tasksGlobalInstructions: '',
      onboarded: true,
      routinesTermsAcknowledged: true,
      language: 'es'
    })
  )
  const env = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  Object.assign(env, {
    OPENCODE_BIN: BIN,
    XDG_DATA_HOME: xdg('data'),
    XDG_CONFIG_HOME: xdg('config'),
    XDG_CACHE_HOME: xdg('cache'),
    XDG_STATE_HOME: xdg('state'),
    LAZUNOX_E2E_HEADLESS: '1',
    LAZUNOX_TELEGRAM_API_BASE: tg.url
  })
  for (let attempt = 1; attempt <= 4 && !app; attempt++) {
    try {
      app = await _electron.launch({
        executablePath: require('electron'),
        args: ['--use-mock-keychain', join(repo, 'out/main/index.js'), `--user-data-dir=${userData}`],
        cwd: repo,
        env,
        timeout: 15_000
      })
    } catch (e) {
      if (attempt === 4) throw e
      await sleep(600)
    }
  }
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.locator('nav[aria-label="Modo"]').first().waitFor({ timeout: 60_000 })
  // La pantalla «Preparando Lazunox» (si aparece) no bloquea esta prueba: se oculta.
  await page.evaluate(() =>
    document
      .querySelectorAll('div.fixed.inset-0')
      .forEach((d) => d.getAttribute('role') !== 'dialog' && d.className.includes('z-[60]') && (d.style.display = 'none'))
  )
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.setContentSize(1280, 800)
  })

  // ---- 1) Vincular por la interfaz ----
  await page
    .getByRole('button', { name: /^Ajustes/ })
    .first()
    .click()
  await sleep(500)
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Telegram/ })
    .first()
    .click()
  await page.locator('input[name="telegram-bot-key"]').fill(TOKEN)
  await page.getByRole('button', { name: 'Guardar clave' }).click()
  await page.getByText(/Clave guardada \(termina en/).waitFor({ timeout: 20_000 })
  await page.getByRole('switch', { name: 'Telegram activado' }).click()
  await page.locator('[data-telegram-code]').waitFor({ timeout: 20_000 })
  const code = (await page.locator('[data-telegram-code] .font-mono').first().innerText()).trim()
  tg.sendUser({ chatId: CHAT, text: '/start', firstName: 'Ana' })
  await waitUntil(() => tg.to(CHAT).length >= 1, 15_000, 'respuesta a /start')
  tg.sendUser({ chatId: CHAT, text: code, firstName: 'Ana' })
  await page.locator('[data-telegram-status="linked"]').waitFor({ timeout: 20_000 })
  report.vinculado = true

  // ---- 2) Code con el motor real y el modelo gratuito ----
  await page
    .getByRole('button', { name: 'Cerrar' })
    .first()
    .click({ timeout: 2000 })
    .catch(() => {})
  await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Code', exact: true }).click()
  await sleep(500)
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, project)
  await page
    .getByRole('button', { name: /Abrir carpeta/ })
    .first()
    .click()
  const trust = page.getByRole('button', { name: 'Confiar y continuar' })
  await trust.waitFor({ timeout: 20_000 })
  await trust.click()
  await sleep(1500)
  const box = page.getByRole('combobox', { name: 'Mensaje para el asistente' })
  const askBash = async (word) => {
    await box.fill(
      `Usa la herramienta bash para ejecutar exactamente este comando y nada más: echo ${word}. Cuando termine responde solo "listo".`
    )
    await box.press('Enter')
  }
  const allowBtn = page.getByRole('button', { name: 'Permitir una vez' })
  const buttonsOf = (m) => m.reply_markup.inline_keyboard.flat()
  const msgFor = (word) => tg.messages.findLast((m) => m.reply_markup && m.text.includes(word))

  // A) Permitir por Telegram.
  await askBash('hola-telegram-uno')
  await allowBtn.first().waitFor({ timeout: 120_000 })
  report.A_tarjetaEnPantalla = true
  await waitUntil(() => msgFor('hola-telegram-uno'), 30_000, 'mensaje A en Telegram')
  const mA = msgFor('hola-telegram-uno')
  report.A_botones = buttonsOf(mA).map((b) => b.text)
  tg.press({ chatId: CHAT, messageId: mA.message_id, data: buttonsOf(mA).find((b) => b.text === 'Permitir una vez').callback_data })
  await waitUntil(
    () => tg.edits.some((e) => e.message_id === mA.message_id && /Permitido una vez desde Telegram/.test(e.text)),
    30_000,
    'edición A'
  )
  await waitUntil(async () => (await allowBtn.count()) === 0, 30_000, 'la tarjeta de la pantalla desaparece')
  // El motor real continúa: el comando se ejecuta y la IA responde.
  await page.getByText('hola-telegram-uno').first().waitFor({ timeout: 90_000 })
  report.A_motorContinuo = true

  // B) La pantalla responde primero.
  await askBash('hola-telegram-dos')
  await allowBtn.first().waitFor({ timeout: 120_000 })
  await waitUntil(() => msgFor('hola-telegram-dos'), 30_000, 'mensaje B en Telegram')
  const mB = msgFor('hola-telegram-dos')
  await allowBtn.first().click()
  await waitUntil(
    () => tg.edits.some((e) => e.message_id === mB.message_id && /Respondido en el computador/.test(e.text)),
    30_000,
    'edición B'
  )
  const before = tg.callbackAnswers.length
  tg.press({ chatId: CHAT, messageId: mB.message_id, data: buttonsOf(mB)[0].callback_data })
  await waitUntil(() => tg.callbackAnswers.length > before, 15_000, 'respuesta al botón tardío')
  report.B_botonTardio = tg.callbackAnswers.at(-1).text

  // C) Rechazar por Telegram: la IA debe enterarse y no ejecutar.
  await askBash('hola-telegram-tres')
  await allowBtn.first().waitFor({ timeout: 120_000 })
  await waitUntil(() => msgFor('hola-telegram-tres'), 30_000, 'mensaje C en Telegram')
  const mC = msgFor('hola-telegram-tres')
  tg.press({ chatId: CHAT, messageId: mC.message_id, data: buttonsOf(mC).find((b) => b.text === 'Rechazar').callback_data })
  await waitUntil(
    () => tg.edits.some((e) => e.message_id === mC.message_id && /Rechazado desde Telegram/.test(e.text)),
    30_000,
    'edición C'
  )
  await waitUntil(async () => (await allowBtn.count()) === 0, 30_000, 'la tarjeta C desaparece')
  report.C_rechazado = true

  // D) Una vez dentro: el servidor del motor real contestó 404 a una respuesta repetida? (lo mide el botón tardío de B).
  // E) La clave del bot no está en claro en el perfil temporal.
  const hits = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        try {
          if (statSync(p).size < 30_000_000 && readFileSync(p).includes(SECRET)) hits.push(p.slice(userData.length))
        } catch {
          /* ilegible */
        }
      }
    }
  }
  walk(userData)
  report.E_claveEnClaroEnDisco = hits
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    await page.screenshot({ path: join(OUT, 'telegram-motor-real.png') })
  }
  console.log('VERIF-TELEGRAM-MOTOR-REAL ' + JSON.stringify({ modelo: MODEL, ...report }))
  const ok =
    report.vinculado &&
    report.A_motorContinuo &&
    report.B_botonTardio === 'Ya respondido en el computador' &&
    report.C_rechazado &&
    hits.length === 0 &&
    report.A_botones.join('|') === 'Permitir una vez|Rechazar'
  if (!ok) throw new Error('la verificación con el motor real no cumplió: ' + JSON.stringify(report))
  console.log('OK')
} catch (e) {
  console.error('FALLÓ: ' + String(e.message).split('\n')[0])
  console.error('parcial: ' + JSON.stringify(report))
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
  await cleanup()
  console.log(
    'Procesos restantes con nuestro prefijo: ' +
      (() => {
        try {
          return execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 64 << 20 })
            .split('\n')
            .filter((r) => r.includes(TAG) && !r.includes('ps -axo')).length
        } catch {
          return '?'
        }
      })()
  )
}
