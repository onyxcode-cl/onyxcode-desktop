// Prueba del control remoto en LAN en Windows (PC de pruebas): arranca la app SIN empaquetar con LAZUNOX_REMOTE_WIN=1 y userData temporal, activa el servicio
// (`remote:start`), escribe en <Root>\cu\remote-url.txt SOLO host:puerto (nunca el codigo de emparejamiento) y espera la bandera de parada
// <Root>\cu\remote-stop.flag (o 120 s). Luego `remote:stop` y cierra. Pensada para ejecutarse en la sesion grafica con una regla de Firewall acotada.
// Uso: cd C:\onyx\wt; C:\onyx\node22\node.exe scripts\win\remote-lan-test.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright-core')
const electronPath = require('electron')
const cu = 'C:\\onyx\\cu'
mkdirSync(cu, { recursive: true })
const out = join(cu, 'remote-url.txt')
const flag = join(cu, 'remote-stop.flag')
rmSync(flag, { force: true })
const ud = mkdtempSync(join(tmpdir(), 'lzx-lan-'))
const env = { ...process.env, LAZUNOX_REMOTE_WIN: '1', LAZUNOX_E2E_HEADLESS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const log = (o) => writeFileSync(out, JSON.stringify(o) + '\n', { flag: 'a' })
writeFileSync(out, '')
let app
try {
  app = await _electron.launch({
    cwd: process.cwd(),
    executablePath: electronPath,
    args: ['.', `--user-data-dir=${ud}`],
    env,
    timeout: 30000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() =>
    window.api.remote.invoke('remote:start').then(
      (data) => ({ ok: true, data }),
      (e) => ({ ok: false, error: String(e?.message ?? e) })
    )
  )
  const st = r?.data ?? null
  let hostPort = null
  const raw = st?.pairing?.url ?? st?.pairing?.link ?? ''
  try {
    const u = new URL(String(raw))
    hostPort = u.host
  } catch {
    /* sin URL */
  }
  log({
    ok: r?.ok === true,
    err: r?.error ?? null,
    available: st?.available,
    unavailable: st?.unavailable ?? null,
    mode: st?.mode,
    error: st?.error ?? null,
    hostPort
  })
  const end = Date.now() + 120000
  while (Date.now() < end && !existsSync(flag)) await new Promise((res) => setTimeout(res, 1000))
  const s2 = await page.evaluate(() =>
    window.api.remote.invoke('remote:stop').then(
      (data) => ({ data }),
      () => ({ data: null })
    )
  )
  log({ stopped: s2?.data?.mode })
} catch (e) {
  log({ fatal: String(e?.message ?? e).slice(0, 300) })
} finally {
  await app?.close().catch(() => {})
  rmSync(ud, { recursive: true, force: true })
  log({ fin: true })
}
