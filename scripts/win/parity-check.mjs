// Ronda fija de paridad en Windows (W14): arranca win-unpacked SIN elevar con CDP, lee window.api.platform, window.api.capsFlags y
// tasks:sandbox:status, y lo compara con docs/PARIDAD-WINDOWS.json (esperadoEnEjecucion.win32). Codigo 0 = coincide, 1 = difiere,
// 2 = no se pudo arrancar/leer. Una sesion elevada (SSH como administrador) se informa como AVISO, no como fallo.
// Uso (en C:\onyx\wt): C:\onyx\node22\node.exe scripts\win\parity-check.mjs [--exe ruta\Lazunox.exe] [--port 9333] [--exigir-sin-admin]
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compararParidad, desenvolverEstado, formatearInforme } from './parity-lib.mjs'

const require = createRequire(import.meta.url)
const aqui = dirname(fileURLToPath(import.meta.url))
const repo = resolve(aqui, '..', '..')
const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const exe = resolve(arg('--exe', join(repo, 'dist', 'win-unpacked', 'Lazunox.exe')))
const port = Number(arg('--port', '9333'))
const exigirSinAdmin = process.argv.includes('--exigir-sin-admin')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitCdp(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return true
    } catch {
      /* aun no */
    }
    await sleep(800)
  }
  return false
}

async function main() {
  if (!existsSync(exe)) {
    console.log(`PARITY-CHECK: no existe ${exe}`)
    return 2
  }
  const tabla = JSON.parse(readFileSync(join(repo, 'docs', 'PARIDAD-WINDOWS.json'), 'utf8'))
  const { chromium } = require('playwright-core')
  const ud = mkdtempSync(join(tmpdir(), 'lazunox-parity-'))
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ onboarded: true }))
  const child = spawn(
    exe,
    ['--disable-gpu', `--remote-debugging-port=${port}`, `--remote-allow-origins=http://127.0.0.1:${port}`, `--user-data-dir=${ud}`],
    { stdio: 'ignore', windowsHide: true }
  )
  let browser
  let obs = {}
  try {
    if (!(await waitCdp(60000))) throw new Error('la app no abrio el puerto de depuracion en 60 s')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    let p
    for (let i = 0; i < 60 && !p; i++) {
      p = browser.contexts().flatMap((c) => c.pages()).find((x) => x.url().startsWith('lazunox://app/index.html'))
      if (!p) await sleep(500)
    }
    if (!p) throw new Error('no aparecio la ventana principal (lazunox://app/index.html)')
    await p.waitForFunction(() => !!window.api?.tasks, null, { timeout: 40000 })
    obs = await p.evaluate(async () => ({
      platform: window.api.platform,
      capsFlags: window.api.capsFlags,
      sandbox: await window.api.tasks.invoke('tasks:sandbox:status', {})
    }))
    obs.sandbox = desenvolverEstado(obs.sandbox)
  } catch (e) {
    obs.error = e instanceof Error ? e.message : String(e)
  } finally {
    try {
      await browser?.close()
    } catch {
      /* ya cerrado */
    }
    if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await sleep(1000)
    rmSync(ud, { recursive: true, force: true })
  }
  const res = compararParidad(tabla, obs, { exigirSinAdmin })
  console.log(formatearInforme(res))
  if (obs.error) return 2
  return res.ok ? 0 : 1
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.log(`PARITY-CHECK: error ${e instanceof Error ? e.message : e}`)
    process.exit(2)
  }
)
