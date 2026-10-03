import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiffView, diffCellClass } from './DiffView'

const PATCH = [
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,2 +1,2 @@',
  '-const viejo = 1',
  '+const nuevo = "una línea muy larga que en el celular debe partirse"',
  ' ctx'
].join('\n')

describe('ajuste de línea del diff', () => {
  it('con ajuste parte las líneas largas; sin él las deja enteras', () => {
    expect(diffCellClass(true)).toBe('pr-3 whitespace-pre-wrap break-all')
    expect(diffCellClass(false)).toBe('pr-3 whitespace-pre')
  })
  it('por defecto ajusta (escritorio no cambia)', () => {
    const html = renderToStaticMarkup(<DiffView patch={PATCH} />)
    expect(html).toContain('whitespace-pre-wrap break-all')
    expect(html).toContain('<table class="w-full border-collapse">')
  })
  it('sin ajuste la tabla se ensancha y se desplaza', () => {
    const html = renderToStaticMarkup(<DiffView patch={PATCH} wrap={false} />)
    expect(html).not.toContain('break-all')
    expect(html).toContain('w-max min-w-full')
  })
  it('fuera del celular el botón «Descartar bloque» conserva su tamaño de escritorio y se muestran las dos columnas de números', () => {
    const html = renderToStaticMarkup(<DiffView patch={PATCH} onDiscardHunk={() => undefined} />)
    expect(html).toContain('px-1.5 py-0.5 text-[11px]')
    expect(html).not.toContain('min-h-11')
    expect(html).not.toContain('class="hidden"')
  })
})
