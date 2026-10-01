// axe-core inyectado desde node_modules (devDependency). Se evalúa por CDP (`page.evaluate`), que no pasa por la CSP de la página.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'

const require = createRequire(import.meta.url)
let source: string | null = null

export interface AxeViolation {
  id: string
  impact: string | null
  help: string
  nodes: { target: string; html: string }[]
}

/** Ejecuta axe sobre la página en claro y oscuro; devuelve las violaciones por esquema. */
export async function runAxe(page: Page, scope = 'body'): Promise<Record<'light' | 'dark', AxeViolation[]>> {
  source ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  const out = {} as Record<'light' | 'dark', AxeViolation[]>
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(350)
    if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(source)
    out[scheme] = await page.evaluate(async (ctx) => {
      const w = window as unknown as { axe: { run: (c: string, o: unknown) => Promise<{ violations: Array<Record<string, unknown>> }> } }
      const r = await w.axe.run(ctx, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
      return r.violations.map((v) => ({
        id: v.id as string,
        impact: (v.impact as string | null) ?? null,
        help: v.help as string,
        nodes: (v.nodes as Array<{ target: unknown[]; html: string }>)
          .slice(0, 6)
          .map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) }))
      }))
    }, scope)
  }
  await page.emulateMedia({ colorScheme: null })
  return out
}

export const SERIOUS = new Set(['serious', 'critical', 'moderate'])

export function summarize(v: Record<'light' | 'dark', AxeViolation[]>): string {
  return (['light', 'dark'] as const)
    .flatMap((s) =>
      v[s].map((x) => `[${s}] ${x.impact} ${x.id}: ${x.help}\n${x.nodes.map((n) => `    ${n.target}  ${n.html}`).join('\n')}`)
    )
    .join('\n')
}
