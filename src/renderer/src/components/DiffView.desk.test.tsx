/**
 * Caracterización de `DiffView` en escritorio frente a celular: el resaltado de palabra (`data-w`) y el gancho `data-diff`
 * solo existen en escritorio; la superficie remota conserva el marcado de siempre (con `desk:` ya quitado por `stripDesk`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiffView } from './DiffView'
import { stripDesk } from '../../../test/strip-desk'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const PATCH = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,2 @@', '-const viejo = 1', '+const nuevo = 2', ' ctx'].join('\n')

describe('DiffView en escritorio', () => {
  it('marca el contenedor con data-diff y resalta las palabras cambiadas con data-w', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<DiffView patch={PATCH} />)
    expect(html).toContain('data-diff=""')
    expect(html).toContain('data-w=""')
  })

  it('sin resaltado de palabra cuando el diff se recorta («Mostrar todo»)', () => {
    surface('darwin')
    const rows = ['@@ -1,2100 +1,2100 @@']
    for (let i = 0; i < 2100; i++) rows.push(i % 2 ? `+nuevo ${i}` : `-viejo ${i}`)
    const html = renderToStaticMarkup(<DiffView patch={rows.join('\n')} />)
    expect(html).toContain('data-diff=""')
    expect(html).not.toContain('data-w=""')
  })
})

describe('DiffView en el celular (superficie remota) no cambia', () => {
  it('no emite data-diff ni data-w y el marcado (sin desk:) queda estable', () => {
    surface('remote')
    const html = renderToStaticMarkup(<DiffView patch={PATCH} />)
    expect(html).not.toContain('data-w')
    expect(html).not.toContain('data-diff')
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<div class="overflow-auto font-mono text-[12px] leading-[1.55] "><table class="w-full border-collapse"><tbody><tr class="bg-accent-soft/60 text-muted"><td colSpan="4" class="px-3 py-0.5 max-w-0 truncate">@@ -1,2 +1,2 @@</td></tr><tr class="bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"><td class="hidden">1</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">1</td><td class="w-4 align-top select-none text-danger">-</td><td class="pr-3 whitespace-pre-wrap break-all">const viejo = 1</td></tr><tr class="bg-[color-mix(in_srgb,var(--success)_13%,transparent)]"><td class="hidden"></td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">1</td><td class="w-4 align-top select-none text-success">+</td><td class="pr-3 whitespace-pre-wrap break-all">const nuevo = 2</td></tr><tr class=""><td class="hidden">2</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">2</td><td class="w-4 align-top select-none text-subtle"> </td><td class="pr-3 whitespace-pre-wrap break-all">ctx</td></tr></tbody></table></div>"`
    )
  })

  it('con descartar bloque y sin ajuste de línea tampoco cambia', () => {
    surface('remote')
    const html = renderToStaticMarkup(<DiffView patch={PATCH} onDiscardHunk={() => undefined} wrap={false} />)
    expect(html).not.toContain('data-w')
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<div class="overflow-auto font-mono text-[12px] leading-[1.55] "><table class="w-max min-w-full border-collapse"><tbody><tr class="bg-accent-soft/60 text-muted"><td colSpan="4" class="px-3 py-0.5 "><div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate whitespace-pre">@@ -1,2 +1,2 @@</span><button type="button" class="shrink-0 rounded-md font-sans font-medium text-muted hover:bg-hover hover:text-danger focus-visible:ring-2 focus-visible:ring-accent min-h-11 px-3 text-[13px]">Descartar este bloque</button></div></td></tr><tr class="bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"><td class="hidden">1</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">1</td><td class="w-4 align-top select-none text-danger">-</td><td class="pr-3 whitespace-pre">const viejo = 1</td></tr><tr class="bg-[color-mix(in_srgb,var(--success)_13%,transparent)]"><td class="hidden"></td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">1</td><td class="w-4 align-top select-none text-success">+</td><td class="pr-3 whitespace-pre">const nuevo = 2</td></tr><tr class=""><td class="hidden">2</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">2</td><td class="w-4 align-top select-none text-subtle"> </td><td class="pr-3 whitespace-pre">ctx</td></tr></tbody></table></div>"`
    )
  })
})
