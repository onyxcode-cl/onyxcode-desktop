// Calidad R3-A (F8-B37): rendimiento y continuidad en el renderer. Diff de 50 000 líneas en el chip de edición y en la
// tarjeta de permiso de Code (sin tareas largas), imágenes de Code que sobreviven al cambio de modo, posición de scroll
// de Chat, Code y Tareas que vuelve, aviso visible de Quick Entry y terminal sin caracteres sueltos al reenganchar.
// Capturas con R3A_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CDPSession, Page } from 'playwright-core'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { consumeErrors, makeGitRepo, openCodeProject } from '../lib/fase6'
import { connectTasks, gotoMode, makeHomeFolder, newChatVia, newTaskVia, prepareFakeBin } from '../lib/lru'
import { shot } from '../lib/shots'
import { storeCall, storeSet } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const DEV = MODE === 'dev'
const SHOTS = process.env.R3A_SHOTS_DIR
const CPU_THROTTLE = Number(process.env.E2E_PERF_THROTTLE ?? 4)
const DIFF_LINES = Number(process.env.E2E_R3A_DIFF_LINES ?? 50_000)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Diff unificado de un archivo con `n` líneas cambiadas (mitad `+`, mitad `-`). */
function bigDiff(n: number, file = 'big.ts'): string {
  const rows = [`--- a/${file}`, `+++ b/${file}`, `@@ -1,${n} +1,${n} @@`]
  for (let i = 0; i < n; i++) rows.push(i % 2 ? `+export const valor${i}: number = ${i} // nuevo` : `-export const valor${i} = ${i}`)
  return rows.join('\n')
}

async function startObserver(page: Page): Promise<CDPSession | null> {
  let cdp: CDPSession | null = null
  if (CPU_THROTTLE > 1) {
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  }
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __longObs?: PerformanceObserver }
    w.__long = []
    w.__longObs?.disconnect()
    w.__longObs = new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration)))
    w.__longObs.observe({ type: 'longtask', buffered: false })
  })
  return cdp
}

async function readObserver(page: Page, cdp: CDPSession | null): Promise<{ count: number; max: number; total: number }> {
  const r = await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __longObs: PerformanceObserver }
    w.__longObs.takeRecords().forEach((e) => w.__long.push(e.duration))
    return { count: w.__long.length, max: Math.round(Math.max(0, ...w.__long)), total: Math.round(w.__long.reduce((a, b) => a + b, 0)) }
  })
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  return r
}

/** Distancia al final y scrollTop del contenedor desplazable que contiene `marker`. */
const scrollInfo = (page: Page, marker: string): Promise<{ top: number; fromEnd: number }> =>
  page.evaluate((m) => {
    const node = Array.from(document.querySelectorAll('p, div, span')).find((e) => e.children.length === 0 && e.textContent?.includes(m))
    let el = node?.parentElement ?? null
    while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement
    if (!el) return { top: -1, fromEnd: -1 }
    return { top: Math.round(el.scrollTop), fromEnd: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) }
  }, marker)

const scrollTo = (page: Page, marker: string, fromEnd: number): Promise<void> =>
  page.evaluate(
    ([m, d]) => {
      const node = Array.from(document.querySelectorAll('p, div, span')).find(
        (e) => e.children.length === 0 && e.textContent?.includes(m as string)
      )
      let el = node?.parentElement ?? null
      while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement
      if (el) el.scrollTop = el.scrollHeight - el.clientHeight - (d as number)
    },
    [marker, fromEnd] as const
  )

describe.skipIf(!DEV)('R3A: diff de 50 000 líneas en el chip de edición y el permiso de Code', () => {
  const app = useApp()
  let dir = ''
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('el chip de edición con un diff enorme no crea tareas largas y muestra +N −M exactos', async () => {
    const a = app()
    dir = makeGitRepo()
    await openCodeProject(a, dir)
    await a.fake.script({
      match: 'chip grande',
      steps: [
        {
          type: 'tool',
          tool: 'edit',
          input: { filePath: `${dir}/big.ts`, oldString: 'a', newString: 'b' },
          metadata: { diff: bigDiff(DIFF_LINES) },
          output: 'ok'
        },
        { type: 'text', text: 'chip listo' }
      ]
    })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('chip grande')
    const cdp = await startObserver(a.page)
    await box.press('Enter')
    await expectVisible(a.page.getByText('chip listo'), 60_000)
    await a.page.waitForTimeout(1000)
    const m = await readObserver(a.page, cdp)
    console.log(
      `[perf-r3a] chip de edición, diff ${DIFF_LINES} líneas: tareas largas ${m.count} (suma ${m.total} ms, máx ${m.max} ms) con CPU x${CPU_THROTTLE}`
    )
    const chip = a.page.locator('button[title$="big.ts"]')
    await expectVisible(chip)
    const text = await chip.innerText()
    expect(text).toContain(`+${DIFF_LINES / 2}`)
    expect(text).toContain(`-${DIFF_LINES / 2}`)
    await shot(a, SHOTS, 'chip-edicion-50k')
    expect(m.max).toBeLessThan(200 * CPU_THROTTLE)
  })

  it('la tarjeta de permiso con un diff enorme no crea tareas largas y se puede aprobar', async () => {
    const a = app()
    await a.fake.script({
      match: 'permiso grande',
      steps: [
        {
          type: 'permission',
          permission: 'edit',
          patterns: ['big2.ts'],
          metadata: { filepath: `${dir}/big2.ts`, diff: bigDiff(DIFF_LINES, 'big2.ts') }
        },
        { type: 'text', text: 'permiso resuelto' }
      ]
    })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('permiso grande')
    const cdp = await startObserver(a.page)
    await box.press('Enter')
    const once = a.page.getByRole('button', { name: /Permitir una vez/ })
    await expectVisible(once, 60_000)
    await a.page.waitForTimeout(1000)
    const m = await readObserver(a.page, cdp)
    console.log(
      `[perf-r3a] permiso de Code, diff ${DIFF_LINES} líneas: tareas largas ${m.count} (suma ${m.total} ms, máx ${m.max} ms) con CPU x${CPU_THROTTLE}`
    )
    await shot(a, SHOTS, 'permiso-code-50k')
    expect(m.max).toBeLessThan(200 * CPU_THROTTLE)
    await once.click()
    await expectVisible(a.page.getByText('permiso resuelto'), 30_000)
  })
})

describe.skipIf(!DEV)('R3A: las imágenes del compositor de Code sobreviven al cambio de modo', () => {
  const app = useApp()
  let dir = ''
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('se conservan por sesión, no se mezclan y se liberan al enviar', async () => {
    const a = app()
    dir = makeGitRepo()
    await openCodeProject(a, dir)
    const input = a.page.locator('input[type="file"]').first()
    await input.setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG })
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 5_000)
    await gotoMode(a.page, 'Chat')
    expect(await a.page.locator('img[alt="captura.png"]').count()).toBe(0)
    await gotoMode(a.page, 'Code')
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 5_000)
    await shot(a, SHOTS, 'code-adjunto-tras-cambiar-modo')
    // Otra sesión nueva (borrador distinto): sin imagen; al volver, la imagen sigue en la suya.
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('con imagen')
    await box.press('Enter')
    await a.fake.waitForRequest(
      (r) => r.method === 'POST' && /prompt_async$/.test(r.path) && JSON.stringify(r.body).includes('captura.png')
    )
    // Enviado: el compositor queda vacío (queda UNA imagen, la del mensaje) y tras cambiar de modo sigue sin adjunto.
    await expect.poll(() => a.page.locator('img[alt="captura.png"]').count(), { timeout: 15_000 }).toBe(1)
    await gotoMode(a.page, 'Chat')
    await gotoMode(a.page, 'Code')
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 10_000)
    await a.page.waitForTimeout(500)
    expect(await a.page.locator('img[alt="captura.png"]').count()).toBe(1)
  })
})

const OTHER_MODE = IS_WIN ? 'Code' : 'Tareas'

describe.skipIf(!DEV)('R3A: el scroll de cada conversación vuelve al cambiar de modo', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  let repo = ''
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true })
  })
  const app = useApp({ env: bin.env })
  const largo = (p: string): string => Array.from({ length: 120 }, (_, i) => `${p} ${i} de relleno para forzar scroll.`).join('\n\n')

  it('Chat: arriba vuelve a su posición; pegado al final vuelve al final', async () => {
    const a = app()
    await a.fake.script({ match: '^scroll chat$', steps: [{ type: 'text', text: largo('ChatP') }] })
    await newChatVia(a.page, 'scroll chat', 'ChatP 119')
    await expect.poll(async () => (await scrollInfo(a.page, 'ChatP 119')).fromEnd, { timeout: 10_000 }).toBeLessThan(3)
    await scrollTo(a.page, 'ChatP 119', 600)
    await a.page.waitForTimeout(300)
    const before = await scrollInfo(a.page, 'ChatP 119')
    await expectVisible(a.page.getByRole('button', { name: 'Ir al final' }))
    await gotoMode(a.page, OTHER_MODE)
    await gotoMode(a.page, 'Chat')
    await expectVisible(a.page.getByText('ChatP 119', { exact: false }))
    await a.page.waitForTimeout(500)
    const after = await scrollInfo(a.page, 'ChatP 119')
    console.log(`[r3a] Chat scrollTop antes ${before.top} después ${after.top}`)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(3)
    await expectVisible(a.page.getByRole('button', { name: 'Ir al final' }))
    await shot(a, SHOTS, 'chat-scroll-restaurado')
    // Pegado al final: vuelve al final aunque haya crecido.
    await a.page.getByRole('button', { name: 'Ir al final' }).click()
    await expect.poll(async () => (await scrollInfo(a.page, 'ChatP 119')).fromEnd, { timeout: 10_000 }).toBeLessThan(3)
    await gotoMode(a.page, OTHER_MODE)
    await gotoMode(a.page, 'Chat')
    await a.page.waitForTimeout(500)
    expect((await scrollInfo(a.page, 'ChatP 119')).fromEnd).toBeLessThan(3)
    expect(await a.page.getByRole('button', { name: 'Ir al final' }).count()).toBe(0)
  })

  it('Code: arriba vuelve a su posición', async () => {
    const a = app()
    repo = makeGitRepo()
    await openCodeProject(a, repo)
    await a.fake.script({ match: 'scroll code', steps: [{ type: 'text', text: largo('CodeP') }] })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('scroll code')
    await box.press('Enter')
    await expectVisible(a.page.getByText('CodeP 119', { exact: false }), 30_000)
    await expect.poll(async () => (await scrollInfo(a.page, 'CodeP 119')).fromEnd, { timeout: 10_000 }).toBeLessThan(3)
    await scrollTo(a.page, 'CodeP 119', 600)
    await a.page.waitForTimeout(300)
    const before = await scrollInfo(a.page, 'CodeP 119')
    await gotoMode(a.page, 'Chat')
    await gotoMode(a.page, 'Code')
    await expectVisible(a.page.getByText('CodeP 119', { exact: false }))
    await a.page.waitForTimeout(500)
    const after = await scrollInfo(a.page, 'CodeP 119')
    console.log(`[r3a] Code scrollTop antes ${before.top} después ${after.top}`)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(3)
    await expectVisible(a.page.getByRole('button', { name: 'Ir al final' }))
    await shot(a, SHOTS, 'code-scroll-restaurado')
  })

  // Windows v1: sin modo Tareas.
  it.skipIf(IS_WIN)('Tareas: arriba vuelve a su posición', async () => {
    const a = app()
    const { fake } = await connectTasks(a, folder.path)
    await fake.script({ match: 'tarea larga', title: 'Tarea larga', steps: [{ type: 'text', text: largo('TareaP') }] })
    await newTaskVia(a.page, 'tarea larga', 'TareaP 119')
    await expect.poll(async () => (await scrollInfo(a.page, 'TareaP 119')).fromEnd, { timeout: 10_000 }).toBeLessThan(3)
    await scrollTo(a.page, 'TareaP 119', 600)
    await a.page.waitForTimeout(300)
    const before = await scrollInfo(a.page, 'TareaP 119')
    await gotoMode(a.page, 'Chat')
    await gotoMode(a.page, 'Tareas')
    await expectVisible(a.page.getByText('TareaP 119', { exact: false }).first())
    await a.page.waitForTimeout(500)
    const after = await scrollInfo(a.page, 'TareaP 119')
    console.log(`[r3a] Tareas scrollTop antes ${before.top} después ${after.top}`)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(3)
    await expectVisible(a.page.getByRole('button', { name: 'Ir al final' }))
    await shot(a, SHOTS, 'tareas-scroll-restaurado')
  })
})

describe.skipIf(!DEV)('R3A: Quick Entry avisa cuando el envío falla sin conversación', () => {
  const app = useApp()
  it('sin IA conectada: aviso visible, texto conservado en el compositor de Chat', async () => {
    const a = app()
    await gotoMode(a.page, 'Chat')
    await storeSet(a.page, 'useProviders', { providers: [], loaded: true })
    await a.electronApp.evaluate(({ BrowserWindow }) => {
      // La ventana principal (en Windows el orden de getAllWindows() no es el de la Mac).
      BrowserWindow.getAllWindows()
        .find((w) => /127\.0\.0\.1|localhost|index\.html/.test(w.webContents.getURL()) && !/quick|browser/.test(w.webContents.getURL()))!
        .webContents.send('extras:quick-prompt', { text: 'pregunta desde quick' })
    })
    const notice = a.page.getByTestId('quick-entry-notice')
    await expectVisible(notice, 10_000)
    expect(await notice.innerText()).toContain('No se pudo enviar tu mensaje rápido')
    await expect.poll(() => a.page.locator('textarea').first().inputValue(), { timeout: 5_000 }).toBe('pregunta desde quick')
    await shot(a, SHOTS, 'quick-entry-aviso')
    await notice.getByRole('button', { name: 'Cerrar aviso' }).click()
    expect(await a.page.getByTestId('quick-entry-notice').count()).toBe(0)
    consumeErrors(a, /NoAi|IA/)
  })
})

/** Filas de texto de la terminal visible (una por línea). */
const termRows = (page: Page): Promise<string[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('.xterm-rows > div')).map((r) => (r.textContent ?? '').replace(/\u00a0/g, ' ')))

describe.skipIf(!DEV)('R3A: terminal sin caracteres sueltos', () => {
  // Shell lento y determinista: `.zshrc` propio que tarda 2 s en dar el prompt (como un `.zshrc` pesado).
  const zdot = mkdtempSync(join(tmpdir(), 'onyx-e2e-zdot-'))
  writeFileSync(join(zdot, '.zshrc'), "sleep 2\nPROMPT='ONYX> '\nPROMPT_EOL_MARK='%'\n")
  const app = useApp({ env: { ZDOTDIR: zdot, SHELL: '/bin/zsh' } })
  let repo = ''
  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
    rmSync(zdot, { recursive: true, force: true })
  })

  // Windows: el caso es de zsh (`ZDOTDIR`/`.zshrc` lento); la terminal de Windows (PowerShell/ConPTY) se cubre en `pty/service.win.test.ts`.
  it.skipIf(IS_WIN)('lo escrito antes de que el shell esté listo no deja eco suelto antes del prompt y el reenganche no cambia nada (820 px oscuro)', async () => {
    const a = app()
    const { page } = a
    repo = makeGitRepo()
    await openCodeProject(a, repo)
    await storeCall(page, 'useCode', 'togglePanel', 'terminal')
    await page.locator('.xterm-helper-textarea').first().waitFor({ state: 'attached', timeout: 20_000 })
    await expect.poll(async () => (await page.evaluate(() => (window as any).api.code.pty.list())).length, { timeout: 15_000 }).toBe(1)
    // Se teclea YA, sin esperar al aviso del shell: el eco del núcleo de la primera tecla dejaba «e%» antes del prompt.
    await page.locator('.xterm').first().click()
    await page.keyboard.type('echo MARCA_R3A', { delay: 5 })
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await termRows(page)).filter((r) => r.trim() === 'MARCA_R3A').length, { timeout: 20_000 }).toBe(1)
    await expect
      .poll(async () => (await termRows(page)).some((r, i, all) => r.trim() === 'MARCA_R3A' && (all[i + 1] ?? '').includes('ONYX>')), {
        timeout: 10_000
      })
      .toBe(true)
    const clean = async (): Promise<string[]> => (await termRows(page)).map((r) => r.trimEnd()).filter((r) => r !== '')
    const base = await clean()
    console.log(`[r3a] terminal, filas iniciales: ${JSON.stringify(base)}`)
    // La primera línea es el prompt: nada de eco suelto («e%», «echo …») antes de él.
    expect(base[0]).toMatch(/^ONYX>/)
    for (let i = 0; i < 3; i++) {
      await gotoMode(page, 'Chat')
      await page.waitForTimeout(300)
      await gotoMode(page, 'Code')
      await expect.poll(() => page.locator('.xterm-rows').first().innerText(), { timeout: 10_000 }).toContain('MARCA_R3A')
      await page.waitForTimeout(600)
      expect(await clean()).toEqual(base)
    }
    await shot(a, SHOTS, 'terminal-reenganchada', [820])
  }, 120_000)
})
