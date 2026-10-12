import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CraftUiSnapshot } from '@shared/craft'
import { es } from '@shared/i18n/es'
import { CraftCardView, craftErrorKey } from './CraftComponentCard'

const t = (k: keyof typeof es, p?: Record<string, string | number>): string =>
  String(es[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => String(p?.[n] ?? ''))
const noop = (): void => undefined
const view = (snapshot: CraftUiSnapshot | null, o: { busy?: boolean; error?: string | null } = {}): string =>
  renderToStaticMarkup(
    <CraftCardView
      t={t as never}
      snapshot={snapshot}
      busy={o.busy ?? false}
      error={o.error ?? null}
      onInstall={noop}
      onCancel={noop}
      onRemove={noop}
    />
  )

describe('CraftCardView', () => {
  it('sin estado o no soportado (Windows) no pinta nada', () => {
    expect(view(null)).toBe('')
    expect(view({ status: { state: 'unsupported', reason: 'x' }, installing: false })).toBe('')
  })
  it('falta: muestra el tamaño en el botón', () => {
    const html = view({ status: { state: 'missing', version: '0.5.0', sizeBytes: 66_680_532 }, installing: false })
    expect(html).toContain('Presentaciones y documentos con diseño premium')
    expect(html).toContain('Instalar (≈ 67 MB)')
  })
  it('instalando: barra de progreso y botón de cancelar', () => {
    const html = view({
      status: { state: 'missing', version: '0.5.0', sizeBytes: 66_680_532 },
      installing: true,
      progress: { phase: 'download', done: 33_340_266, total: 66_680_532 }
    })
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('width:50%')
    expect(html).toContain('Cancelar instalación')
  })
  it('instalado: versión y botón de quitar', () => {
    const html = view({ status: { state: 'installed', version: '0.5.0' }, installing: false })
    expect(html).toContain('Instalado · versión 0.5.0')
    expect(html).toContain('Quitar')
  })
  it('fallo: mensaje humano y reintentar', () => {
    const html = view({ status: { state: 'missing', version: '0.5.0', sizeBytes: 1e6 }, installing: false }, { error: 'signature' })
    expect(html).toContain('La firma no es válida; no se instaló nada')
    expect(html).toContain('Reintentar')
  })
  it('errores: los conocidos reutilizan texto y el desconocido usa el propio', () => {
    expect(craftErrorKey('disk')).toBe('settings.office.error.disk')
    expect(craftErrorKey('raro')).toBe('settings.craft.error.generic')
  })
})
