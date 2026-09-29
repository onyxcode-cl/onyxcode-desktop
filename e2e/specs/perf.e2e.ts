// Rendimiento del streaming (F7-B43..B46): un guion de 2000 deltas en un chat medido con `PerformanceObserver`
// (`longtask`, >50 ms) y comprobaciones de que `content-visibility` no rompe el pegado al final ni el scroll.
// Las cifras medidas antes/después de los cambios están en CHANGELOG-FASE7.md (F7-B47).
import { afterAll, describe, expect, it } from 'vitest'
import type { CDPSession, Page } from 'playwright-core'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { newChatAndSend } from '../lib/fase6'
import { connectCowork, makeHomeFolder, newTaskVia, prepareFakeBin, storeAssistantText } from '../lib/lru'
import { hook, storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'

/**
 * Umbrales durante los 2000 deltas con la CPU del renderer ralentizada x4 (ver F7-B47 para lo medido). Con los cambios:
 * 13-20 tareas largas, suma 0,9-1,7 s, máx ≈ 220 ms. Sin ellos (afeff4f): solo 3-4 tareas «largas» pero de 75-91 s cada
 * una (la página se congela ~97 s), por eso se acota la SUMA y el MÁXIMO además del número. Sobrescribibles para medir.
 */
const MAX_LONGTASKS = Number(process.env.E2E_PERF_MAX_LONGTASKS ?? 40)
const MAX_LONGTASK_TOTAL_MS = Number(process.env.E2E_PERF_MAX_TOTAL_MS ?? 3000)
const MAX_LONGTASK_MS = Number(process.env.E2E_PERF_MAX_MS ?? 800)

/** 2000 trozos: prosa, párrafos y un bloque ```ts en mitad (lo que más cuesta re-resaltar en cada delta). */
function buildDeltas(n = 2000): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    if (i === 800) out.push('\n\n```ts\n')
    else if (i > 800 && i < 830) out.push(`const valor${i}: number = ${i} // comentario ${i}\n`)
    else if (i === 830) out.push('```\n\n')
    else out.push(i % 25 === 24 ? `palabra${i}.\n\n` : `palabra${i} `)
  }
  return out
}

/** Factor de ralentización de CPU del renderer (CDP `Emulation.setCPUThrottlingRate`): hace medible el coste en una máquina rápida. */
const CPU_THROTTLE = Number(process.env.E2E_PERF_THROTTLE ?? 4)

let throttled: CDPSession | null = null

async function startObserver(page: Page): Promise<void> {
  if (CPU_THROTTLE > 1) {
    throttled = await page.context().newCDPSession(page)
    await throttled.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  }
  await page.evaluate(() => {
    const w = window as unknown as { __long?: { start: number; duration: number }[]; __longObs?: PerformanceObserver }
    w.__long = []
    w.__longObs?.disconnect()
    w.__longObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long!.push({ start: e.startTime, duration: e.duration })
    })
    w.__longObs.observe({ type: 'longtask', buffered: false })
  })
}

async function readObserver(page: Page): Promise<{ count: number; total: number; max: number }> {
  const res = await page.evaluate(() => {
    const w = window as unknown as { __long: { duration: number }[]; __longObs: PerformanceObserver }
    w.__longObs.takeRecords().forEach((e) => w.__long.push({ duration: e.duration }))
    const d = w.__long.map((e) => e.duration)
    return { count: d.length, total: Math.round(d.reduce((a, b) => a + b, 0)), max: Math.round(Math.max(0, ...d)) }
  })
  await throttled?.send('Emulation.setCPUThrottlingRate', { rate: 1 }) // no falsear el resto del archivo
  throttled = null
  return res
}

describe.skipIf(!DEV)('rendimiento del streaming', () => {
  const app = useApp()

  it('2000 deltas: texto final EXACTO y pocas tareas largas (CPU x4)', async () => {
    const a = app()
    const deltas = buildDeltas()
    const expected = deltas.join('')
    await startObserver(a.page)
    const t0 = Date.now()

    const sid = await newChatAndSend(a, 'perf 2000 deltas', { steps: [{ type: 'text', deltas, chunkDelayMs: 1 }], match: 'perf 2000 deltas' })
    await expect
      .poll(async () => (await storeState<Record<string, string>>(a.page, 'useSessions', 'status'))[sid], { timeout: 90_000, message: 'la sesión no terminó' })
      .toBe('idle')
    const ms = Date.now() - t0
    // El último frame ya se aplicó: texto EXACTO y completo en el store (ningún delta perdido ni reordenado)...
    await expect.poll(() => storeAssistantText(a.page, sid), { timeout: 10_000 }).toBe(expected)
    // ...y pintado: el final del texto está en el DOM.
    await expectVisible(a.page.getByText('palabra1999', { exact: false }), 15_000)
    await a.page.waitForTimeout(500) // deja asentar las tareas de cierre
    const m = await readObserver(a.page)
    console.log(`[perf] 2000 deltas en ${ms} ms; tareas largas: ${m.count} (suma ${m.total} ms, máx ${m.max} ms); umbrales ${MAX_LONGTASKS} / ${MAX_LONGTASK_TOTAL_MS} ms / ${MAX_LONGTASK_MS} ms`)
    expect(m.count).toBeLessThanOrEqual(MAX_LONGTASKS)
    expect(m.total).toBeLessThanOrEqual(MAX_LONGTASK_TOTAL_MS)
    expect(m.max).toBeLessThanOrEqual(MAX_LONGTASK_MS)
    // El bloque ```ts se resaltó al terminar (highlight solo con el mensaje completo).
    await expectVisible(a.page.locator('pre code.hljs .hljs-keyword'), 15_000)
  })

  it('historial largo: content-visibility en las filas antiguas sin romper el pegado al final', async () => {
    const a = app()
    await a.fake.script({ steps: [{ type: 'text', text: 'Respuesta corta 0' }], match: 'turno 0' })
    const sid = await newChatAndSend(a, 'turno 0')
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    for (let i = 1; i <= 12; i++) {
      await a.fake.script({ steps: [{ type: 'text', text: `Respuesta corta ${i}\n\n${'línea de relleno. '.repeat(20 + i * 5)}` }], match: `turno ${i}` })
      await box.fill(`turno ${i}`)
      await a.page.getByRole('button', { name: 'Enviar' }).click()
      await expectVisible(a.page.getByText(`Respuesta corta ${i}`, { exact: false }), 30_000)
    }
    const geo = (): Promise<{ old: number; gap: number; top: number }> =>
      a.page.evaluate(() => {
        const row = document.querySelector('.turn-cv')
        const sc = row?.closest('.overflow-y-auto') as HTMLElement | null
        if (!sc) return { old: 0, gap: -1, top: -1 }
        return { old: document.querySelectorAll('.turn-cv').length, gap: sc.scrollHeight - sc.scrollTop - sc.clientHeight, top: sc.scrollTop }
      })
    // 13 turnos = 26 filas: las 18 más antiguas llevan la clase; el pegado al final es exacto.
    await expect.poll(async () => (await geo()).old, { timeout: 10_000 }).toBeGreaterThanOrEqual(10)
    await expect.poll(async () => (await geo()).gap, { timeout: 10_000 }).toBeLessThan(3)
    // Sube arriba del todo, espera y vuelve al final con el botón: sin saltos residuales.
    await a.page.evaluate(() => {
      const sc = document.querySelector('.turn-cv')!.closest('.overflow-y-auto') as HTMLElement
      sc.scrollTop = 0
    })
    await a.page.waitForTimeout(400)
    expect((await geo()).top).toBeLessThan(5)
    await expectVisible(a.page.getByText('turno 0', { exact: true }))
    await a.page.getByRole('button', { name: 'Ir al final' }).click()
    await expect.poll(async () => (await geo()).gap, { timeout: 10_000 }).toBeLessThan(3)
    // Reabrir la conversación (la lista se monta de cero con las alturas estimadas de lo saltado): queda pegada al final.
    await hook(a.page, 'newChat')
    await expect.poll(async () => (await geo()).old, { timeout: 10_000 }).toBe(0)
    await hook(a.page, 'openChatSession', sid)
    await expect.poll(async () => (await geo()).old, { timeout: 10_000 }).toBeGreaterThanOrEqual(10)
    await expect.poll(async () => (await geo()).gap, { timeout: 10_000 }).toBeLessThan(3)
    // Un mensaje nuevo mantiene el pegado.
    await a.fake.script({ steps: [{ type: 'text', text: 'Respuesta final larga', chunkDelayMs: 5, deltas: Array.from({ length: 60 }, (_, k) => `trozo ${k}\n\n`) }], match: 'turno final' })
    await box.fill('turno final')
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(a.page.getByText('trozo 59', { exact: false }), 30_000)
    await expect.poll(async () => (await geo()).gap, { timeout: 10_000 }).toBeLessThan(3)
  })
})

describe.skipIf(!DEV)('Tareas: content-visibility y salto a un mensaje antiguo', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })
  const UNICO = 'zafiro-violeta-cv'

  it('la búsqueda abre la tarea y centra el mensaje antiguo (sin saltos por alturas estimadas)', async () => {
    const a = app()
    const { fake } = await connectCowork(a, folder.path)
    await fake.script({ match: 'cv-t0', title: 'Tarea CV', steps: [{ type: 'text', text: 'Respuesta cv 0' }] })
    await newTaskVia(a.page, 'cv-t0 empieza', 'Respuesta cv 0')
    const box = a.page.getByPlaceholder('Responde o pide un cambio…')
    for (let i = 1; i <= 14; i++) {
      await fake.script({ match: `cv-t${i}`, steps: [{ type: 'text', text: `Respuesta cv ${i}\n\n${'línea de relleno. '.repeat(30 + i * 6)}` }] })
      await box.fill(i === 4 ? `cv-t4 sigue con ${UNICO}` : `cv-t${i} sigue`) // el texto buscado va en mitad del historial
      await a.page.getByRole('button', { name: 'Enviar' }).click()
      await expectVisible(a.page.getByText(`Respuesta cv ${i}`, { exact: false }).first(), 30_000)
    }
    const scrollGeo = (): Promise<{ old: number; gap: number }> =>
      a.page.evaluate(() => {
        const sc = document.querySelector('[id^="cw-block-"]')?.closest('.overflow-y-auto') as HTMLElement | null
        return { old: document.querySelectorAll('[id^="cw-block-"].turn-cv').length, gap: sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight : -1 }
      })
    await expect.poll(async () => (await scrollGeo()).old, { timeout: 10_000 }).toBeGreaterThanOrEqual(8)
    await expect.poll(async () => (await scrollGeo()).gap, { timeout: 10_000 }).toBeLessThan(3)

    // Otra tarea y búsqueda del texto único: abre la tarea antigua y hace scroll al bloque.
    await a.page.getByRole('searchbox', { name: 'Buscar tareas' }).fill(UNICO)
    await a.page.locator('ul li button').filter({ hasText: UNICO }).first().click() // el resultado de la barra lateral (no el bloque de la conversación)
    const target = a.page.locator('[id^="cw-block-"]', { hasText: UNICO })
    await expectVisible(target)
    // Tras el scroll suave el bloque queda cerca del centro del contenedor (tolerancia amplia: viewport de la ventana).
    await expect
      .poll(
        () =>
          a.page.evaluate((u) => {
            const el = [...document.querySelectorAll('[id^="cw-block-"]')].find((e) => e.textContent?.includes(u)) as HTMLElement | undefined
            const sc = el?.closest('.overflow-y-auto') as HTMLElement | null
            if (!el || !sc) return 9999
            const r = el.getBoundingClientRect()
            const c = sc.getBoundingClientRect()
            return Math.round(Math.abs(r.top + r.height / 2 - (c.top + c.height / 2)))
          }, UNICO),
        { timeout: 5_000, message: 'el bloque buscado debe quedar centrado' }
      )
      .toBeLessThan(80)
    // Mientras dura el salto no hay filas con content-visibility (alturas reales); después se reactiva.
    await expect.poll(async () => (await scrollGeo()).old, { timeout: 8_000 }).toBeGreaterThanOrEqual(8)
  })
})
