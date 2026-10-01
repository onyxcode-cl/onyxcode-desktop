// Calidad T4 (F8-B29): rendimiento percibido y transcripciones. Diff enorme sin congelar la página, «Ir al final» en
// Code y Tareas, y listas de sesiones por encima de 200. Capturas con T4_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { afterAll, describe, expect, it } from 'vitest'
import type { CDPSession, Page } from 'playwright-core'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { chatDirectory, fakeApi, makeGitRepo, openCodeProject } from '../lib/fase6'
import { connectTasks, makeHomeFolder, newTaskVia, prepareFakeBin } from '../lib/lru'
import { shot } from '../lib/shots'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.T4_SHOTS_DIR
const CPU_THROTTLE = Number(process.env.E2E_PERF_THROTTLE ?? 4)
const DIFF_LINES = Number(process.env.E2E_T4_DIFF_LINES ?? 50_000)

/** Diff unificado de un archivo con `n` líneas cambiadas (mitad `+`, mitad `-`). */
function bigDiff(n: number): string {
  const rows = ['--- a/big.ts', '+++ b/big.ts', `@@ -1,${n} +1,${n} @@`]
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

describe.skipIf(!DEV)('T4: diff enorme en Code', () => {
  const app = useApp()
  let dir = ''
  afterAll(() => undefined)

  it(`un diff de ${DIFF_LINES} líneas se abre acotado, sin tareas largas, y «Mostrar todo» lo completa`, async () => {
    const a = app()
    dir = makeGitRepo()
    await openCodeProject(a, dir)
    await a.fake.script({
      match: 'diff grande',
      steps: [
        {
          type: 'tool',
          tool: 'edit',
          input: { filePath: `${dir}/big.ts`, oldString: 'a', newString: 'b' },
          metadata: { diff: bigDiff(DIFF_LINES) },
          output: 'ok'
        },
        { type: 'text', text: 'diff listo' }
      ]
    })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('diff grande')
    await box.press('Enter')
    await expectVisible(a.page.getByText('diff listo'), 60_000)
    await a.page.waitForTimeout(500)

    const cdp = await startObserver(a.page)
    const openMs = await a.page.evaluate(async () => {
      const chip = document.querySelector('button[title$="big.ts"]') as HTMLElement
      const t0 = performance.now()
      chip.click()
      for (;;) {
        if (document.querySelector('.max-h-96 table tr')) break
        await new Promise((r) => requestAnimationFrame(r))
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return Math.round(performance.now() - t0)
    })
    await a.page.waitForTimeout(1500) // deja terminar el resaltado por trozos
    const m = await readObserver(a.page, cdp)
    const rows = await a.page.locator('.max-h-96 table tr').count()
    console.log(
      `[perf-t4] diff ${DIFF_LINES} líneas: abre en ${openMs} ms (CPU x${CPU_THROTTLE}); tareas largas ${m.count} (suma ${m.total} ms, máx ${m.max} ms); filas ${rows}`
    )
    await shot(a, SHOTS, 'diff-truncado')
    expect(rows).toBeLessThanOrEqual(2100)
    await expectVisible(a.page.getByRole('button', { name: 'Mostrar todo' }))
    expect(openMs).toBeLessThan(300 * CPU_THROTTLE)
    expect(m.max).toBeLessThan(200 * CPU_THROTTLE)

    await a.page.getByRole('button', { name: 'Mostrar todo' }).click()
    await expect.poll(() => a.page.locator('.max-h-96 table tr').count(), { timeout: 60_000 }).toBeGreaterThan(DIFF_LINES * 0.9)
    await expect(a.page.getByRole('button', { name: 'Mostrar todo' }).count()).resolves.toBe(0)
  })
})

describe.skipIf(!DEV)('T4: «Ir al final» en Code', () => {
  const app = useApp()
  it('aparece al subir más de 80 px, lleva al final y «Trabajando…» es role=status', async () => {
    const a = app()
    const dir = makeGitRepo()
    await openCodeProject(a, dir)
    const largo = Array.from({ length: 120 }, (_, i) => `Párrafo ${i} de relleno para forzar scroll.`).join('\n\n')
    await a.fake.script({ match: 'respuesta larga', steps: [{ type: 'text', text: largo }] })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('respuesta larga')
    await box.press('Enter')
    await expectVisible(a.page.getByText('Párrafo 119', { exact: false }), 30_000)
    const geo = (): Promise<number> =>
      a.page.evaluate(() => {
        const sc = document.querySelector('.turn-row')!.closest('.overflow-y-auto') as HTMLElement
        return sc.scrollHeight - sc.scrollTop - sc.clientHeight
      })
    await expect.poll(geo, { timeout: 10_000 }).toBeLessThan(3)
    const btn = a.page.getByRole('button', { name: 'Ir al final' })
    expect(await btn.count()).toBe(0)
    await a.page.evaluate(() => {
      const sc = document.querySelector('.turn-row')!.closest('.overflow-y-auto') as HTMLElement
      sc.scrollTop = sc.scrollHeight - sc.clientHeight - 300
    })
    await expectVisible(btn)
    await shot(a, SHOTS, 'code-ir-al-final')
    await btn.click()
    await expect.poll(geo, { timeout: 10_000 }).toBeLessThan(3)
    await expect.poll(() => btn.count(), { timeout: 5_000 }).toBe(0)
    // «Trabajando…»: región de estado para lectores de pantalla.
    await a.fake.script({ match: 'espera', steps: [{ type: 'text', text: 'luego', delayMs: 4_000 }] })
    await box.fill('espera')
    await box.press('Enter')
    await expectVisible(a.page.getByRole('status').filter({ hasText: 'Trabajando' }), 10_000)
  })
})

describe.skipIf(!DEV)('T4: «Ir al final» en Tareas', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })
  it('aparece al subir más de 80 px y vuelve al final', async () => {
    const a = app()
    const { fake } = await connectTasks(a, folder.path)
    const largo = Array.from({ length: 120 }, (_, i) => `Línea ${i} de la tarea para forzar scroll.`).join('\n\n')
    await fake.script({ match: 'tarea larga', title: 'Tarea larga', steps: [{ type: 'text', text: largo }] })
    await newTaskVia(a.page, 'tarea larga', 'Línea 119')
    const geo = (): Promise<number> =>
      a.page.evaluate(() => {
        const sc = document.querySelector('[id^="cw-block-"]')!.closest('.overflow-y-auto') as HTMLElement
        return sc.scrollHeight - sc.scrollTop - sc.clientHeight
      })
    await expect.poll(geo, { timeout: 10_000 }).toBeLessThan(3)
    const btn = a.page.getByRole('button', { name: 'Ir al final' })
    expect(await btn.count()).toBe(0)
    await a.page.evaluate(() => {
      const sc = document.querySelector('[id^="cw-block-"]')!.closest('.overflow-y-auto') as HTMLElement
      sc.scrollTop = sc.scrollHeight - sc.clientHeight - 300
    })
    await expectVisible(btn)
    await shot(a, SHOTS, 'tareas-ir-al-final')
    await btn.click()
    await expect.poll(geo, { timeout: 10_000 }).toBeLessThan(3)
    await expect.poll(() => btn.count(), { timeout: 5_000 }).toBe(0)
  })
})

describe.skipIf(!DEV)('T4: más de 200 sesiones en Chat', () => {
  const app = useApp()
  const N = 250
  it('«Cargar más» muestra todas y el filtro encuentra las de más allá de 200', async () => {
    const a = app()
    const dir = await chatDirectory(a)
    for (let i = 0; i < N; i += 25) {
      await Promise.all(
        Array.from({ length: 25 }, (_, k) =>
          fakeApi(a, 'POST', '/session', dir, { title: `sesion-fantasma-${String(i + k).padStart(3, '0')}` })
        )
      )
    }
    await a.page.reload()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    const rows = a.page.getByText(/^sesion-fantasma-\d{3}$/)
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(200)
    const more = a.page.getByRole('button', { name: 'Cargar más' })
    await expectVisible(more)
    await more.scrollIntoViewIfNeeded()
    await shot(a, SHOTS, 'chat-cargar-mas')
    await more.click()
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(N)
    expect(await more.count()).toBe(0)
  })

  it('el filtro carga todas por sí solo', async () => {
    const a = app()
    await a.page.reload()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    const rows = a.page.getByText(/^sesion-fantasma-\d{3}$/)
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(200)
    await expect(a.page.getByText('sesion-fantasma-000', { exact: true }).count()).resolves.toBe(0)
    await a.page
      .getByRole('textbox', { name: /Buscar/ })
      .first()
      .fill('fantasma-000')
    await expectVisible(a.page.getByText('sesion-fantasma-000', { exact: true }), 20_000)
  })
})
