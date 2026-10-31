// Ajustes con la barra de vidrio: pestañas por grupo y secciones del grupo abierto (solo macOS y Windows 11 con vidrio).
// Con «Sólida» (lo que usan los demás specs) Ajustes conserva el menú lateral de siempre.
// Contraste con vidrio: la ventana es transparente y el fondo real lo pone el sistema (vibrancy/Mica), así que axe, sin más,
// compondría el texto sobre blanco (falso positivo en oscuro). Aquí se pinta un fondo SÓLIDO de peor caso detrás (el color que
// dejaría el vidrio sobre un escritorio oscuro, claro o de color) y se mide `color-contrast` en todas las secciones y en ambos
// temas. GLASS_AXE_REPORT=/ruta.jsonl vuelca cada medición; GLASS_AXE_AUDIT=1 mide todos los fondos y no falla.
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const REPORT = process.env.GLASS_AXE_REPORT
const AUDIT = process.env.GLASS_AXE_AUDIT === '1'
const require = createRequire(import.meta.url)

/**
 * Fondos que puede dejar el vidrio detrás del contenido. En oscuro la vibrancy de macOS queda entre casi negro y un gris medio aun
 * sobre escritorios claros; en claro, entre gris claro y blanco. Los de color simulan un escritorio saturado visto a través del
 * material. El gate usa los extremos y un color por tema; con GLASS_AXE_AUDIT=1 se miden todos.
 */
const BACKDROPS: Record<'dark' | 'light', { color: string; gate: boolean }[]> = {
  dark: [
    { color: '#0b0b0f', gate: true },
    { color: '#4a4a52', gate: true },
    { color: '#5a1a1a', gate: true },
    { color: '#1a2a6a', gate: false },
    { color: '#1a5a2a', gate: false },
    // Sin fondo: lo que ve axe con la ventana transparente (compone sobre blanco). Solo informativo.
    { color: 'transparent', gate: false }
  ],
  light: [
    { color: '#ffffff', gate: true },
    { color: '#c8c8d0', gate: true },
    { color: '#f0a0a0', gate: true },
    { color: '#a8c0f0', gate: false },
    { color: '#a8e0b0', gate: false },
    { color: 'transparent', gate: false }
  ]
}

interface ContrastNode {
  target: string
  text: string
  ratio: number | null
  expected: number | null
  fg: string | null
  bg: string | null
  fontSize: string | null
}

/** `color-contrast` de axe sobre el contenido de la ventana (violaciones y casos que axe no pudo decidir). */
async function contrast(page: Page): Promise<{
  violations: ContrastNode[]
  incomplete: { target: string; reason: string }[]
  /** Estimación propia para los `incomplete` (sin imágenes ni desenfoque). */
  estimated: { target: string; text: string; ratio: number; fontSize: string }[]
  /** Ratio mínimo medido (aprobados incluidos) en el contenido, en la cabecera de pestañas y en el buscador. */
  min: { all: number | null; tabs: number | null; search: number | null }
}> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'))
  return page.evaluate(async () => {
    type N = { target: unknown[]; html: string; any: Array<{ data?: Record<string, unknown> | null; message?: string }> }
    type R = { nodes: N[] }
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: R[]; incomplete: R[]; passes: R[] }> }
    }
    const r = await w.axe.run(document.body, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations', 'incomplete', 'passes']
    })
    const text = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').trim().slice(0, 50)
    const measured = [...r.passes, ...r.violations].flatMap((v) =>
      v.nodes.flatMap((n) => {
        const ratio = (n.any[0]?.data as { contrastRatio?: unknown } | null)?.contrastRatio
        const el = document.querySelector(n.target.join(' '))
        return typeof ratio === 'number' && ratio > 0 && el ? [{ ratio, el }] : []
      })
    )
    const minOf = (sel: string | null): number | null => {
      const xs = measured.filter((m) => !sel || m.el.closest(sel)).map((m) => m.ratio)
      return xs.length ? Math.min(...xs) : null
    }
    // Lo que axe no puede decidir (tapado en parte por el borde del panel, `select` con flecha de imagen…) se estima a mano:
    // color del texto compuesto sobre los fondos de sus ancestros, sin imágenes ni desenfoque. Solo informativo.
    const parse = (c: string): [number, number, number, number] | null => {
      let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
      m = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/)
      if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]]
      return null
    }
    const over = (top: number[], under: number[]): number[] => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
    const lum = (c: number[]): number => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const estimate = (el: Element): number | null => {
      const chain: Element[] = []
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e)
      let bg = [255, 255, 255, 1]
      for (const e of chain) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (!c) return null
        bg = over(c, bg)
      }
      const f = parse(getComputedStyle(el).color)
      if (!f) return null
      const a = lum(over(f, bg))
      const b = lum(bg)
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
    }
    const estimated = r.incomplete.flatMap((v) =>
      v.nodes.flatMap((n) => {
        const target = n.target.join(' ')
        const el = document.querySelector(target)
        const ratio = el ? estimate(el) : null
        return ratio === null || !el
          ? []
          : [{ target, text: text(target) || n.html.slice(0, 60), ratio, fontSize: getComputedStyle(el).fontSize }]
      })
    )
    return {
      estimated,
      min: { all: minOf('[data-settings-root]'), tabs: minOf('nav[data-settings-tabs]'), search: minOf('[role="search"]') },
      violations: r.violations.flatMap((v) =>
        v.nodes.map((n) => {
          const d = (n.any[0]?.data ?? {}) as Record<string, unknown>
          const target = n.target.join(' ')
          return {
            target,
            text: text(target) || n.html.slice(0, 60),
            ratio: typeof d.contrastRatio === 'number' ? d.contrastRatio : null,
            expected: typeof d.expectedContrastRatio === 'string' ? Number(d.expectedContrastRatio.replace(':1', '')) : null,
            fg: (d.fgColor as string) ?? null,
            bg: (d.bgColor as string) ?? null,
            fontSize: (d.fontSize as string) ?? null
          }
        })
      ),
      incomplete: r.incomplete.flatMap((v) =>
        v.nodes.map((n) => ({
          target: n.target.join(' '),
          reason: String((n.any[0]?.data as { messageKey?: string } | null)?.messageKey ?? '')
        }))
      )
    }
  })
}

async function setBackdrop(page: Page, color: string): Promise<void> {
  await page.evaluate((c) => {
    let s = document.getElementById('e2e-glass-backdrop')
    if (!s) {
      s = document.createElement('style')
      s.id = 'e2e-glass-backdrop'
      document.head.appendChild(s)
    }
    // Sustituye lo que pondría el sistema detrás de la ventana transparente: un fondo opaco en <html>.
    s.textContent = `html[data-glass] { background: ${c} !important; }`
  }, color)
}

describe.skipIf(!DEV)('Ajustes con vidrio', () => {
  const app = useApp({ settings: { sidebarGlass: 'glass' } })

  it('abre con pestañas por grupo y llega a Diagnóstico por «Ayuda»', async () => {
    const { page } = app()
    const glass = await page.evaluate(() => document.documentElement.hasAttribute('data-glass'))
    // Sin vidrio disponible en el equipo (p. ej. Windows antiguo) no hay nada que probar.
    if (!glass) return
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[data-settings-tabs]')
    await expectVisible(nav)
    // Grupo «Aplicación» abierto: se ve General y no se ve Diagnóstico.
    await expectVisible(nav.getByRole('button', { name: 'General', exact: true }))
    expect(await nav.getByRole('button', { name: 'Diagnóstico', exact: true }).count()).toBe(0)
    await nav.getByRole('button', { name: 'Ayuda', exact: true }).click()
    await nav.getByRole('button', { name: 'Diagnóstico', exact: true }).click()
    await expectVisible(page.getByRole('heading', { name: 'Diagnóstico' }))
    expect(await page.locator('[data-settings-layout]').getAttribute('data-settings-layout')).toBe('list')
    // General va en rejilla.
    await nav.getByRole('button', { name: 'Aplicación', exact: true }).click()
    await nav.getByRole('button', { name: 'General', exact: true }).click()
    expect(await page.locator('[data-settings-layout]').getAttribute('data-settings-layout')).toBe('grid')
  })

  it('contraste de texto con un fondo sólido de peor caso detrás del vidrio, en todas las secciones y ambos temas', async () => {
    const { page } = app()
    if (!(await page.evaluate(() => document.documentElement.hasAttribute('data-glass')))) return
    const nav = page.locator('nav[data-settings-tabs]')
    if (!(await nav.isVisible())) await page.keyboard.press('ControlOrMeta+,')
    await expectVisible(nav)
    await page.mouse.move(1, 1)
    const groups = nav.locator(':scope > div:first-child [role="group"] > button')
    const groupNames = (await groups.allInnerTexts()).map((s) => s.trim())
    expect(groupNames.length).toBeGreaterThanOrEqual(3)
    const failures: string[] = []
    let measured = 0
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme)
      for (const g of groupNames) {
        await groups.getByText(g, { exact: true }).click()
        const sectionButtons = nav.locator(':scope > div:nth-child(2) > button')
        const names = (await sectionButtons.allInnerTexts()).map((s) => s.trim())
        for (const name of names) {
          await sectionButtons.getByText(name, { exact: true }).click()
          await page.mouse.move(1, 1)
          await page.waitForTimeout(250)
          // axe solo mide lo que está a la vista: las secciones largas se recorren por tramos de una pantalla.
          const stops = await page.evaluate(() => {
            const p = document.querySelector<HTMLElement>('[data-settings-pane]')
            if (!p) return [0]
            const out: number[] = []
            for (let y = 0; y < p.scrollHeight - p.clientHeight; y += Math.max(200, Math.floor(p.clientHeight * 0.7))) out.push(y)
            out.push(Math.max(0, p.scrollHeight - p.clientHeight))
            return [...new Set(out)]
          })
          for (const y of stops) {
            await page.evaluate((top) => document.querySelector('[data-settings-pane]')?.scrollTo({ top, behavior: 'instant' }), y)
            await page.waitForTimeout(120)
            for (const bd of BACKDROPS[scheme]) {
              if (!AUDIT && !bd.gate) continue
              await setBackdrop(page, bd.color)
              const r = await contrast(page)
              measured++
              if (REPORT)
                appendFileSync(REPORT, JSON.stringify({ scheme, backdrop: bd.color, group: g, section: name, scroll: y, ...r }) + '\n')
              for (const v of r.violations)
                failures.push(
                  `[${scheme} ${bd.color} y=${y}] ${g} › ${name}: «${v.text}» ${v.ratio}:1 (pide ${v.expected}) fg ${v.fg} bg ${v.bg}  ${v.target}`
                )
              for (const e of r.estimated)
                if (e.ratio < (parseFloat(e.fontSize) >= 24 ? 3 : 4.5))
                  failures.push(
                    `[${scheme} ${bd.color} y=${y}] ${g} › ${name}: «${e.text}» ~${e.ratio}:1 (estimado, axe no decidió)  ${e.target}`
                  )
            }
          }
          await page.evaluate(() => document.querySelector('[data-settings-pane]')?.scrollTo({ top: 0, behavior: 'instant' }))
        }
      }
    }
    await setBackdrop(page, 'transparent')
    await page.emulateMedia({ colorScheme: null })
    expect(measured).toBeGreaterThan(0)
    if (AUDIT)
      console.log(`GLASS AUDIT: ${failures.length} nodos con contraste insuficiente en ${measured} mediciones\n${failures.join('\n')}`)
    else expect(failures, failures.join('\n')).toEqual([])
  }, 600_000)
})
