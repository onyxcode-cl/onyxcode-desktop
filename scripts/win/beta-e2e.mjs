// Prueba de punta a punta de la BETA de Tareas en Windows sobre el instalador REAL (PC de pruebas, sesión gráfica NO elevada).
// Instala en C:\onyx\inst (silencioso), arranca la app instalada con un userData temporal y el puerto de depuración de Chromium, y por IPC
// (como la interfaz): acepta el consentimiento beta (armado), reinicia, prepara la distro `Lazunox-Tareas` DESDE LA IMAGEN INCLUIDA (sin red),
// espera `ready`, revoca el consentimiento y lo limpia todo (distro propia, app, instalación). NUNCA `wsl --shutdown` ni toca docker-desktop;
// se niega a correr si ya existe una distro Lazunox-Tareas. Salida: C:\onyx\cu\beta-out.txt.
// Uso: cd C:\onyx\wt; C:\onyx\node22\node.exe scripts\win\beta-e2e.mjs
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const ROOT = 'C:\\onyx'
const INST = join(ROOT, 'inst')
const UD = join(ROOT, 'tmp', 'ud-beta')
const OUT = join(ROOT, 'cu', 'beta-out.txt')
const PORT = 9333
mkdirSync(join(ROOT, 'cu'), { recursive: true })
writeFileSync(OUT, `BETA-E2E ${new Date().toISOString()}\n`)
let fails = 0
const log = (m) => appendFileSync(OUT, m + '\n')
const check = (name, ok, detail = '') => {
  log(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) fails++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wslList = () =>
  (spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'buffer' }).stdout?.toString('utf16le') ?? '')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
const killUnder = (dir) => {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}\\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps])
}
async function waitCdp(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return true
    } catch {
      /* aún no */
    }
    await sleep(800)
  }
  return false
}
let browser
async function page() {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]
  let p = ctx.pages().find((x) => !x.url().startsWith('devtools'))
  for (let i = 0; i < 20 && !p; i++) {
    await sleep(500)
    p = ctx.pages()[0]
  }
  await p.waitForLoadState('domcontentloaded')
  await p.waitForFunction(() => !!window.api?.tasks, null, { timeout: 40000 })
  return p
}
const call = (p, channel, req) => p.evaluate(([c, r]) => window.api.tasks.invoke(c, r), [channel, req])

const before = wslList()
log(`distros antes: ${before.join(', ')}`)
if (before.includes('Lazunox-Tareas')) {
  log('Ya existe Lazunox-Tareas: no se toca. Aborta.')
  process.exit(4)
}
try {
  // 1. Instalación silenciosa del instalador MÁS RECIENTE
  const dist = join(ROOT, 'wt', 'dist')
  const setups = readdirSync(dist)
    .filter((f) => /^Lazunox-Setup-.*-x64\.exe$/.test(f))
    .map((f) => [f, statSync(join(dist, f)).mtimeMs])
    .sort((a, b) => a[1] - b[1])
  const setup = join(dist, setups.at(-1)[0])
  rmSync(INST, { recursive: true, force: true })
  rmSync(UD, { recursive: true, force: true })
  const ins = spawnSync(setup, ['/S', `/D=${INST}`], { timeout: 180000 })
  check(`instalacion silenciosa (${setups.at(-1)[0]})`, ins.status === 0 && existsSync(join(INST, 'Lazunox.exe')), `codigo=${ins.status}`)
  const images = join(INST, 'resources', 'wsl', 'images')
  check(
    'imagenes incluidas en la instalacion',
    existsSync(join(images, 'lazunox-rootfs-2026.10.1-x64.tar.gz')) && existsSync(join(images, 'opencode-linux-x64.tar.gz'))
  )

  // 2. Arranque con el puerto de depuración (Chromium; no es la inspección de Node)
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`]
  const launch = () => spawn(join(INST, 'Lazunox.exe'), args, { detached: true, stdio: 'ignore' }).unref()
  launch()
  const up = await waitCdp(40000)
  check('la app instalada abre el puerto de depuracion', up)
  if (!up) throw new Error('sin CDP')
  let p = await page()
  await sleep(2500)

  // 3. Consentimiento beta
  const v0 = (await call(p, 'tasks:winBeta', { action: 'view' })).data
  log(`   vista inicial: ${JSON.stringify(v0)}`)
  check('beta disponible y sin consentimiento al inicio', v0?.available === true && v0?.consent === false, '')
  await call(p, 'tasks:winBeta', { action: 'show' })
  await call(p, 'tasks:winBeta', { action: 'check' })
  const early = (await call(p, 'tasks:winBeta', { action: 'accept' })).data
  check('aceptar ANTES de los 600 ms no concede', early?.consent !== true, `consent=${early?.consent}`)
  await sleep(750)
  await call(p, 'tasks:winBeta', { action: 'check' })
  const acc = (await call(p, 'tasks:winBeta', { action: 'accept' })).data
  check('aceptar tras armarse concede y pide reiniciar', acc?.consent === true && acc?.restartRequired === true, JSON.stringify(acc))

  // 4. Reinicio de la app (relanza con los mismos argumentos)
  await call(p, 'tasks:winBeta', { action: 'restart' }).catch(() => null)
  await browser.close().catch(() => null)
  await sleep(4000)
  let up2 = await waitCdp(40000)
  if (!up2) {
    log('   la app no volvio sola con el puerto: se relanza a mano')
    launch()
    up2 = await waitCdp(40000)
  }
  check('la app vuelve tras reiniciar', up2)
  p = await page()
  await sleep(3000)
  const v1 = (await call(p, 'tasks:winBeta', { action: 'view' })).data
  check('beta activa tras el reinicio', v1?.consent === true && v1?.active === true, JSON.stringify(v1))

  // 5. Preparar la distro DESDE LA IMAGEN INCLUIDA y esperar ready
  let st = (await call(p, 'tasks:sandbox:status')).data
  log(`   estado del sandbox: ${JSON.stringify(st)}`)
  check(
    'sin distro: pide prepararla (needsSetup)',
    ['needsSetup', 'missing', 'notInstalled'].includes(st?.state) || /setup/i.test(String(st?.state)),
    String(st?.state)
  )
  const t0 = Date.now()
  const setupRes = await call(p, 'tasks:sandbox:setup')
  log(`   setup: ${JSON.stringify(setupRes).slice(0, 300)}`)
  let ready = false
  let last = ''
  for (let i = 0; i < 300 && !ready; i++) {
    st = (await call(p, 'tasks:sandbox:status', { force: true })).data
    const running = st?.setup?.running === true
    const line = `${st?.state}/${st?.detail ?? ''}/${st?.setup?.phase ?? ''}/${st?.setup?.pct ?? ''}`
    if (line !== last) {
      log(`   ${Math.round((Date.now() - t0) / 1000)} s: ${line}`)
      last = line
    }
    if (st?.state === 'ready' && !running) ready = true
    else if (!running && i > 2 && (st?.state === 'setupError' || st?.state === 'broken')) break
    else await sleep(2000)
  }
  check(
    'la distro queda ready desde la imagen incluida',
    ready,
    `${Math.round((Date.now() - t0) / 1000)} s, estado=${JSON.stringify(st).slice(0, 200)}`
  )
  const mid = wslList()
  check('aparece Lazunox-Tareas y docker-desktop sigue', mid.includes('Lazunox-Tareas') && mid.includes('docker-desktop'), mid.join(', '))

  // 6. Revocar
  await call(p, 'tasks:winBeta', { action: 'revoke' })
  const v2 = (await call(p, 'tasks:winBeta', { action: 'view' })).data
  check('revocar quita el consentimiento', v2?.consent === false, JSON.stringify(v2))
} catch (e) {
  check('sin excepciones', false, String(e?.message ?? e).slice(0, 300))
} finally {
  await browser?.close().catch(() => null)
  killUnder(INST)
  await sleep(2000)
  if (wslList().includes('Lazunox-Tareas') && !before.includes('Lazunox-Tareas')) {
    spawnSync('wsl.exe', ['--terminate', 'Lazunox-Tareas'])
    const u = spawnSync('wsl.exe', ['--unregister', 'Lazunox-Tareas'], { encoding: 'utf8' })
    log(`limpieza: unregister de la distro propia (codigo ${u.status})`)
  }
  const un = join(INST, 'Uninstall Lazunox.exe')
  if (existsSync(un)) spawnSync(un, ['/S'], { timeout: 120000 })
  for (let i = 0; i < 40 && existsSync(join(INST, 'Lazunox.exe')); i++) await sleep(2000) // el desinstalador se relanza solo
  await sleep(3000)
  rmSync(UD, { recursive: true, force: true })
  const after = wslList()
  check(
    'las demas distros intactas',
    before.slice().sort().join(',') === after.slice().sort().join(','),
    `antes=[${before}] despues=[${after}]`
  )
  check('instalacion retirada', !existsSync(join(INST, 'Lazunox.exe')))
  log(`FALLOS=${fails}`)
  process.exit(fails ? 1 : 0)
}
