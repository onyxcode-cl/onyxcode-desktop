// Control del PC en WINDOWS con el helper REAL (cu-helper.exe) sobre una ventana PROPIA de prueba (e2e/fixtures/cu-target.html).
// SOLO corre en win32 Y con LAZUNOX_CU_E2E=1 (opt-in explicito): mueve el raton real y teclea en la ventana de prueba, asi que
// necesita una sesion GRAFICA desbloqueada y sin elevar (no SSH puro: ver scripts/win/run-cu.ps1). En macOS y en Linux todo el
// archivo se salta y NO se ejecuta nada. No toca otras apps: antes de cada accion de entrada comprueba que la ventana de prueba
// tiene el foco y se detiene si no.
//
// Cubre lo que el helper puede probar sin la app integrada (la bandera computerWin sigue apagada): consultas, clic con error de
// posicion <= 2 px fisicos, teclado en un campo propio, campo de contrasena reconocido como seguro (y NUNCA rellenado),
// STOP por stdin (codigo 3 y release-input) y que sin consentimiento la entrada falla cerrada.
// Nada de esto se ha ejecutado todavia en un Windows real (docs/SEGURIDAD.md, «Control del PC en Windows»).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROOT, startApp, type E2EApp } from '../lib/launch'

const IS_WIN = process.platform === 'win32'
const OPT_IN = process.env.LAZUNOX_CU_E2E === '1'
const HELPER = process.env.LAZUNOX_CU_HELPER ?? join(ROOT, 'resources', 'computer-use', 'win', 'bin', 'cu-helper.exe')
const TARGET_URL = new URL(`file:///${join(ROOT, 'e2e', 'fixtures', 'cu-target.html').replace(/\\/g, '/')}`).toString()

interface Run {
  code: number
  out: string
  err: string
}

/** Ejecuta el helper con limite de tiempo (15 s, como el llamador real) y stdin ABIERTO (un EOF lo pararia con 3). */
function helper(args: string[], env: Record<string, string> = {}, o: { stopAfterMs?: number } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(HELPER, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const kill = setTimeout(() => child.kill(), 15_000)
    if (o.stopAfterMs !== undefined) setTimeout(() => child.stdin.write('STOP\n'), o.stopAfterMs)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(kill)
      try {
        child.stdin.end()
      } catch {
        // ya cerrado
      }
      resolve({ code: code ?? -1, out: out.trim(), err: err.trim() })
    })
  })
}
const json = <T>(r: Run): T => JSON.parse(r.out) as T

describe.skipIf(!IS_WIN || !OPT_IN)('Control del PC en Windows (helper real, ventana de prueba propia)', () => {
  let app: E2EApp
  let target: Page
  let tmp: string
  const consent = (): Record<string, string> => ({ COMPUTER_WIN_CONSENT: '1', CU_TEMP_DIR: tmp })

  /** Centro de un elemento de la pagina en pixeles FISICOS del escritorio. */
  async function physicalCenter(selector: string): Promise<{ x: number; y: number }> {
    const rect = await target.evaluate((sel) => {
      const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, selector)
    return app.electronApp.evaluate(({ BrowserWindow, screen }, a) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('cu-target.html'))!
      const c = w.getContentBounds()
      const p = screen.dipToScreenPoint({ x: Math.round(c.x + a.x), y: Math.round(c.y + a.y) })
      return { x: p.x, y: p.y }
    }, rect)
  }

  /** La ventana de prueba debe tener el foco antes de cualquier entrada real: si no, no se envia nada. */
  async function requireFocus(): Promise<void> {
    const ok = await app.electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('cu-target.html'))
      if (!w) return false
      w.show()
      w.focus()
      return w.isFocused()
    })
    expect(ok, 'la ventana de prueba no tiene el foco: no se envia entrada real').toBe(true)
  }

  beforeAll(async () => {
    expect(
      existsSync(HELPER),
      `falta cu-helper.exe en ${HELPER} (compilalo con build-native --win-helper o define LAZUNOX_CU_HELPER)`
    ).toBe(true)
    tmp = mkdtempSync(join(tmpdir(), 'lazunox-e2e-cu-'))
    app = await startApp()
    await app.electronApp.evaluate(({ BrowserWindow }, url) => {
      const w = new BrowserWindow({
        x: 120,
        y: 120,
        width: 640,
        height: 520,
        show: true,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      void w.loadURL(url)
    }, TARGET_URL)
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && !app.electronApp.windows().some((p) => p.url().endsWith('cu-target.html'))) {
      await new Promise((r) => setTimeout(r, 200))
    }
    target = app.electronApp.windows().find((p) => p.url().endsWith('cu-target.html'))!
    expect(target).toBeTruthy()
    await target.waitForLoadState('domcontentloaded')
  })

  afterAll(async () => {
    await app?.stop()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  it('consultas basicas: version, screens, cursor y permissions (sin consentimiento)', async () => {
    const v = json<{ protocol: number; platform: string }>(await helper(['version']))
    expect(v.platform).toBe('win32')
    expect(v.protocol).toBe(1)
    const screens = json<{ width: number; height: number; scale: number; main: boolean }[]>(await helper(['screens']))
    expect(screens.filter((s) => s.main)).toHaveLength(1)
    const c = json<{ x: number; y: number }>(await helper(['cursor']))
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true)
    const p = json<{ consent: boolean; interactive: boolean; elevated: boolean }>(await helper(['permissions'], { CU_TEMP_DIR: tmp }))
    expect(p.consent).toBe(false)
    expect(p.interactive, 'ejecuta en una sesion grafica desbloqueada (no SSH)').toBe(true)
    expect(p.elevated, 'Control del PC no funciona con permisos de administrador').toBe(false)
  })

  it('sin consentimiento la entrada real falla cerrada (12) y no mueve nada', async () => {
    await requireFocus()
    const before = json<{ x: number; y: number }>(await helper(['cursor']))
    const r = await helper(['click', '10', '10'], { CU_TEMP_DIR: tmp })
    expect(r.code).toBe(12)
    expect(json<{ x: number; y: number }>(await helper(['cursor']))).toEqual(before)
    expect(await target.evaluate(() => (window as unknown as { __cu: { b1: number } }).__cu.b1)).toBe(0)
  })

  it('clic en el boton uno: lo recibe solo ese boton y el cursor queda a <= 2 px fisicos', async () => {
    await requireFocus()
    const t = await physicalCenter('#b1')
    const r = await helper(['--instant', 'click', String(t.x), String(t.y)], consent())
    expect(r.code, r.err).toBe(0)
    const cu = await target.evaluate(() => (window as unknown as { __cu: { b1: number; b2: number } }).__cu)
    expect(cu.b1).toBe(1)
    expect(cu.b2).toBe(0)
    const cur = json<{ x: number; y: number }>(await helper(['cursor']))
    expect(Math.abs(cur.x - t.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(cur.y - t.y)).toBeLessThanOrEqual(2)
  })

  it('teclado en un campo propio: acentos, enie y salto de linea', async () => {
    await requireFocus()
    const t = await physicalCenter('#txt')
    expect((await helper(['--instant', 'click', String(t.x), String(t.y)], consent())).code).toBe(0)
    const r = await helper(['--instant', 'type', 'Camión ñandú'], consent())
    expect(r.code, r.err).toBe(0)
    // El navegador procesa las teclas de forma asíncrona: el helper ya terminó pero el campo puede ir unos ms por detrás.
    await expect
      .poll(() => target.evaluate(() => (window as unknown as { __cu: { text: string } }).__cu.text), { timeout: 5_000 })
      .toBe('Camión ñandú')
  })

  it('el campo de contrasena se reconoce como seguro (y escribir falla cerrado)', async () => {
    await requireFocus()
    await target.evaluate(() => (document.getElementById('pwd') as HTMLInputElement).focus())
    const f = json<{ secure: boolean }>(await helper(['focused-secure']))
    expect(f.secure).toBe(true)
    // Con ese foco, escribir falla cerrado (9): el helper lo rechaza antes de enviar nada (la letra de prueba no es un secreto).
    expect((await helper(['--instant', 'type', 'x'], consent())).code).toBe(9)
    await target.evaluate(() => (document.getElementById('txt') as HTMLInputElement).focus())
    expect(json<{ secure: boolean }>(await helper(['focused-secure'])).secure).toBe(false)
  })

  it('STOP por stdin a mitad de una escritura: sale con 3 y release-input deja todo suelto', async () => {
    await requireFocus()
    await target.evaluate(() => (document.getElementById('txt') as HTMLInputElement).focus())
    const r = await helper(['--char-delay', '120', 'type', 'x'.repeat(60)], consent(), { stopAfterMs: 400 })
    expect(r.code).toBe(3)
    expect((await helper(['release-input'], consent())).code).toBe(0)
  })

  it('una combinacion fuera de lista no se envia (la politica vive en el MCP; el helper solo acepta canonicas)', async () => {
    const r = await helper(['key', 'cmd+c'], consent())
    expect(r.code).not.toBe(0)
  })
})
