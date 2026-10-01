// Medición de arranque y memoria (R3-B, F8-B38). Manual: `npm run perf:startup` (construye antes con `npm run build`).
//  1) Arranque en frío (N lanzamientos, userData nuevo): hasta el primer pintado del renderer y hasta que la barra de modos está
//     visible y el compositor de Chat habilitado («interactiva»), medido desde el inicio del proceso principal.
//  2) Memoria: 3 conversaciones largas falsas (fake-opencode) y la app abierta PERF_MINUTES (5) minutos alternando entre ellas;
//     RSS de TODO el árbol de procesos (Electron + helpers + OpenCode falso) cada 30 s, con el crecimiento entre el minuto 1 y el final.
// Variables: PERF_STARTS (5), PERF_MINUTES (5), PERF_TURNS (6 turnos por conversación), PERF_JSON=/ruta.json (guarda las cifras).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { startApp, type E2EApp } from '../lib/launch'

const STARTS = Number(process.env.PERF_STARTS ?? 5)
const MINUTES = Number(process.env.PERF_MINUTES ?? 5)
const TURNS = Number(process.env.PERF_TURNS ?? 6)
const SAMPLE_MS = 30_000
// Umbrales sugeridos (docs/VERIFICACION.md). Superarlos imprime AVISO; con PERF_STRICT=1 además falla.
const LIMITS = { firstPaintMs: 1500, interactiveMs: 2500, peakRssMb: 1200, growthPct: 10 }
const STRICT = process.env.PERF_STRICT === '1'
const over = (what: string, value: number, limit: number): void => {
  if (value <= limit) return
  console.log(`[perf:startup] AVISO: ${what} = ${value} supera el umbral sugerido (${limit})`)
  if (STRICT) throw new Error(`${what} = ${value} > ${limit}`)
}

function tree(pid: number): number[] {
  try {
    const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
    return [pid, ...kids.flatMap(tree)]
  } catch {
    return [pid]
  }
}
/** RSS (MB) de todo el árbol de procesos de la app. */
function treeRssMb(pid: number): number {
  const pids = tree(pid)
  const out = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' })
  return Math.round(out.split('\n').reduce((a, l) => a + (Number(l.trim()) || 0), 0) / 1024)
}
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!

async function startupOf(): Promise<{ firstPaintMs: number; interactiveMs: number }> {
  const t0 = Date.now()
  const app = await startApp({})
  try {
    const interactiveWall = Date.now() - t0
    const { page, electronApp } = app
    // Inicio del proceso principal (epoch ms) y primer pintado del renderer (epoch ms).
    const mainStart = await electronApp.evaluate(() => Date.now() - process.uptime() * 1000)
    const paint = await page.evaluate(async () => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      if (fcp) return performance.timeOrigin + fcp.startTime
      return await new Promise<number>((res) => {
        new PerformanceObserver((l) => res(performance.timeOrigin + l.getEntries()[0]!.startTime)).observe({
          type: 'paint',
          buffered: true
        })
      })
    })
    await page
      .getByPlaceholder('Escribe un mensaje…')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined)
    return { firstPaintMs: Math.round(paint - mainStart), interactiveMs: interactiveWall }
  } finally {
    await app.stop()
  }
}

function deltas(turn: number, n = 1500): string[] {
  return Array.from({ length: n }, (_, i) => (i % 30 === 29 ? `palabra${turn}-${i}.\n\n` : `palabra${turn}-${i} `))
}

async function chatSend(app: E2EApp, page: Page, tag: string, turn: number, first: boolean): Promise<void> {
  const text = `${tag} turno ${turn}`
  await app.fake.script({ steps: [{ type: 'text', deltas: deltas(turn), chunkDelayMs: 0 }], match: text })
  if (first) {
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
  }
  const box = page.getByPlaceholder('Escribe un mensaje…')
  await box.fill(text)
  await page.getByRole('button', { name: 'Enviar' }).click()
  await page.getByText(`palabra${turn}-1499`, { exact: false }).last().waitFor({ state: 'attached', timeout: 120_000 })
  await page.getByRole('button', { name: 'Enviar' }).waitFor({ state: 'visible', timeout: 60_000 })
}

describe('perf:startup', () => {
  it('arranque en frío', async () => {
    const runs: { firstPaintMs: number; interactiveMs: number }[] = []
    for (let i = 0; i < STARTS; i++) runs.push(await startupOf())
    const fp = runs.map((r) => r.firstPaintMs)
    const it2 = runs.map((r) => r.interactiveMs)
    const res = {
      starts: STARTS,
      firstPaintMs: { median: median(fp), max: Math.max(...fp) },
      interactiveMs: { median: median(it2), max: Math.max(...it2) }
    }
    console.log(`[perf:startup] ${JSON.stringify(res)}`)
    over('primer pintado (mediana, ms)', res.firstPaintMs.median, LIMITS.firstPaintMs)
    over('interactiva (mediana, ms)', res.interactiveMs.median, LIMITS.interactiveMs)
    if (process.env.PERF_JSON) writeFileSync(`${process.env.PERF_JSON}.startup.json`, JSON.stringify({ ...res, runs }, null, 2))
  })

  it(`memoria: 3 conversaciones largas y ${MINUTES} min abierta`, async () => {
    const app = await startApp({})
    try {
      const { page, electronApp } = app
      const pid = electronApp.process().pid!
      const tags = ['alfa', 'beta', 'gamma']
      const base = treeRssMb(pid)
      for (const tag of tags) for (let t = 1; t <= TURNS; t++) await chatSend(app, page, tag, t, t === 1)
      const afterLoad = treeRssMb(pid)
      const samples: { minute: number; rssMb: number }[] = []
      const t0 = Date.now()
      let k = 0
      while (Date.now() - t0 < MINUTES * 60_000) {
        // Alterna entre las tres conversaciones (la lista lateral muestra sus títulos «New session…»/primer mensaje).
        const items = page
          .locator('aside')
          .getByRole('button')
          .filter({ hasText: /turno 1|New session/ })
        const n = await items.count()
        if (k === 0) console.log(`[perf:startup] conversaciones en la lista lateral: ${n}`)
        if (n > 0)
          await items
            .nth(k++ % n)
            .click()
            .catch(() => undefined)
        await new Promise((r) => setTimeout(r, SAMPLE_MS))
        samples.push({ minute: Math.round(((Date.now() - t0) / 60_000) * 10) / 10, rssMb: treeRssMb(pid) })
      }
      const peak = Math.max(afterLoad, ...samples.map((s) => s.rssMb))
      const atOne = samples.find((s) => s.minute >= 1)?.rssMb ?? afterLoad
      const end = samples[samples.length - 1]?.rssMb ?? afterLoad
      const res = {
        baseMb: base,
        afterLoadMb: afterLoad,
        peakMb: peak,
        endMb: end,
        growthAfter1minPct: Math.round(((end - atOne) / atOne) * 1000) / 10,
        samples
      }
      console.log(
        `[perf:startup] memoria ${JSON.stringify({ ...res, samples: undefined })}\n${samples.map((s) => `  min ${s.minute}: ${s.rssMb} MB`).join('\n')}`
      )
      if (process.env.PERF_JSON) writeFileSync(`${process.env.PERF_JSON}.memory.json`, JSON.stringify(res, null, 2))
      over('RSS pico del árbol (MB)', peak, LIMITS.peakRssMb)
      over('crecimiento de RSS del minuto 1 al final (%)', res.growthAfter1minPct, LIMITS.growthPct)
      expect(end).toBeGreaterThan(0)
    } finally {
      await app.stop()
    }
  })
})
