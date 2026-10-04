#!/usr/bin/env node
// Capturas de la interfaz móvil de la PWA sin celular. Ver docs/CAPTURAS-MOVIL.md.
// Compila un arnés (scripts/shot-mobile/*) con el FakeLink y datos sintéticos, lo sirve en un puerto libre de 127.0.0.1 y lo
// abre en un Chromium headless de Playwright (ya descargado; no descarga nada). No toca la app instalada ni datos reales.
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, mergeConfig, loadConfigFromFile } from 'vite'
import { chromium } from 'playwright-core'

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DEFAULT_OUT = '/private/tmp/claude-501/-Users-ben/0f2b5c02-144e-41f9-8c7c-156d39453861/scratchpad/shots'
const SCENARIOS = ['lista', 'chat', 'chat-largo', 'permiso', 'ajustes', 'mas', 'bloqueo', 'vinculacion']
const LIGHT_LAYER = new Set(['bloqueo', 'vinculacion'])
const DEVICES = {
  iphone14: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  android360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, ua: 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' }
}
const TOTAL_TIMEOUT_MS = 240_000
const PROJECT = '/Users/demo/proyectos/tienda-web'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const out = resolve(arg('out') ?? DEFAULT_OUT)
const sel = arg('scenario')
const themes = arg('theme') ? [arg('theme')] : ['dark', 'light']
const devSel = arg('device')
if (sel && !SCENARIOS.includes(sel)) throw new Error(`escenario desconocido: ${sel} (${SCENARIOS.join('|')})`)
if (arg('theme') && !['dark', 'light'].includes(arg('theme'))) throw new Error('--theme dark|light')
if (devSel && !DEVICES[devSel]) throw new Error(`--device ${Object.keys(DEVICES).join('|')}`)
const scenarios = sel ? [sel] : SCENARIOS
const devices = devSel ? [devSel] : Object.keys(DEVICES)
mkdirSync(out, { recursive: true })

function findBrowser() {
  const root = join(homedir(), 'Library/Caches/ms-playwright')
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const p = join(root, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
      if (existsSync(p)) return p
    }
  }
  throw new Error('No hay Chromium headless de Playwright en ~/Library/Caches/ms-playwright (no se descarga ninguno).')
}

// ---- compilación del arnés (misma configuración que la PWA completa, otra entrada y otra salida) ----
const site = join(tmpdir(), 'onyx-shot-mobile-site')
if (!process.argv.includes('--no-build')) {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(repo, 'pwa/vite.full.config.ts'))
  const cfg = mergeConfig(loaded.config, { logLevel: 'error', build: { outDir: site, emptyOutDir: true, reportCompressedSize: false } })
  cfg.build.rollupOptions.input = { full: join(repo, 'scripts/shot-mobile/full.html'), light: join(repo, 'scripts/shot-mobile/light.html') }
  await build({ ...cfg, configFile: false })
}

// ---- servidor estático, puerto libre, solo loopback ----
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
const srv = createServer(async (req, res) => {
  try {
    const f = resolve(site, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!f.startsWith(site)) throw new Error('fuera')
    res.writeHead(200, { 'content-type': mime[extname(f)] ?? 'application/octet-stream' })
    res.end(await readFile(f))
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const base = `http://127.0.0.1:${srv.address().port}/scripts/shot-mobile`

let browser = null
let pids = []
let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  try {
    await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 5000))])
  } catch {}
  for (const p of pids) {
    try {
      process.kill(p, 0) // sigue vivo: se cierra solo ESE pid
      process.kill(p, 'SIGKILL')
    } catch {}
  }
  srv.close()
}
const watchdog = setTimeout(async () => {
  console.error('Tiempo total agotado: se cierra todo.')
  await cleanup()
  process.exit(2)
}, TOTAL_TIMEOUT_MS)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(130)))

const fail = []
const done = []
try {
  browser = await chromium.launch({ headless: true, executablePath: findBrowser(), timeout: 30_000 })
  // Playwright ya no expone el proceso: los hijos directos de ESTE node son los suyos (se matan por pid, nunca por nombre).
  try {
    pids = execFileSync('pgrep', ['-P', String(process.pid)]).toString().split('\n').filter(Boolean).map(Number)
  } catch {}
  for (const dev of devices) {
    for (const theme of themes) {
      const d = DEVICES[dev]
      const ctx = await browser.newContext({
        viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: true, hasTouch: true, userAgent: d.ua,
        colorScheme: theme, locale: 'es-CL', reducedMotion: 'reduce'
      })
      ctx.setDefaultTimeout(8000)
      for (const sc of scenarios) {
        const page = await ctx.newPage()
        const errs = []
        page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
        try {
          const cdp = await ctx.newCDPSession(page)
          await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
          if (sc === 'permiso') {
            await page.addInitScript((p) => {
              localStorage.setItem('code.trustedFolders', JSON.stringify([p]))
            }, PROJECT)
          }
          const light = LIGHT_LAYER.has(sc)
          await page.goto(`${base}/${light ? 'light' : 'full'}.html?s=${sc}&theme=${theme}`, { waitUntil: 'load', timeout: 15_000 })
          await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
          await page.waitForSelector('html[data-ready="1"]', { state: 'attached', timeout: 15_000 })
          await drive(page, sc)
          await page.waitForTimeout(400)
          const file = join(out, `${sc}-${dev}-${theme}.png`)
          await page.screenshot({ path: file, timeout: 10_000 })
          done.push(file)
          if (errs.length) console.warn(`  aviso ${sc}: ${errs[0]}`)
        } catch (e) {
          fail.push(`${sc}-${dev}-${theme}: ${String(e.message).split('\n')[0]}`)
        } finally {
          await page.close().catch(() => {})
        }
      }
      await ctx.close()
    }
  }
} finally {
  clearTimeout(watchdog)
  await cleanup()
}
for (const f of done) console.log(f)
if (fail.length) {
  console.error('FALLARON:\n' + fail.join('\n'))
  process.exitCode = 1
}

/** Lleva la interfaz al escenario tocando los controles reales (como lo haría una persona). */
async function drive(page, sc) {
  const tab = (name) => page.locator('nav button', { hasText: name }).click()
  const settle = () => page.waitForTimeout(500)
  switch (sc) {
    case 'lista':
      await page.getByText('Plan de migración de Postgres').waitFor()
      break
    case 'chat':
      await page.getByText('Plan de migración de Postgres').click()
      await page.getByText('Comparativa rápida').waitFor()
      break
    case 'chat-largo':
      await page.getByText('Optimizar consultas lentas').click()
      await page.getByText('Dos, ambos menores').waitFor()
      await settle()
      await page.evaluate(() => document.querySelectorAll('main, main *').forEach((el) => { if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight }))
      break
    case 'permiso':
      await tab('Code')
      await page.getByText('tienda-web').first().click() // proyecto reciente (el motor falso lista sus sesiones)
      await page.getByText('Arreglar total del carrito con cupón').first().click()
      await page.getByText('src/carrito/total.ts').first().waitFor()
      await settle()
      break
    case 'mas':
      await tab('Más')
      await settle()
      break
    case 'ajustes':
      await tab('Más')
      await page.getByRole('button', { name: /Ajustes/ }).first().click()
      await settle()
      break
    default:
      await settle()
  }
}
