import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { en } from '@shared/i18n/en'
import { es } from '@shared/i18n/es'
import type { RuntimesSnapshot } from '@shared/runtimes'
import { RuntimesCardView } from './RuntimesCard'
import { runtimesErrorKey, runtimesPct } from './runtimes-view'

const t = (k: keyof typeof es, p?: Record<string, string | number>): string =>
  String(es[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => String(p?.[n] ?? ''))
const noop = (): void => undefined
const snap = (o: Partial<RuntimesSnapshot> = {}): RuntimesSnapshot => ({
  offered: true,
  items: [
    { id: 'node', state: 'missing', version: '24.22.0' },
    { id: 'uv', state: 'missing', version: '0.13.1' }
  ],
  missingBytes: 67_329_746,
  ready: false,
  installing: false,
  ...o
})
const view = (snapshot: RuntimesSnapshot | null, o: { busy?: boolean; error?: string | null } = {}): string =>
  renderToStaticMarkup(
    <RuntimesCardView
      t={t as never}
      snapshot={snapshot}
      busy={o.busy ?? false}
      error={o.error ?? null}
      onInstall={noop}
      onCancel={noop}
      onRemove={noop}
    />
  )

describe('RuntimesCardView (Ajustes › Node.js y uv)', () => {
  it('sin estado o donde no hay conectores locales (Windows hoy) no pinta nada', () => {
    expect(view(null)).toBe('')
    expect(view(snap({ offered: false }))).toBe('')
  })
  it('faltan: botón con el tamaño y el aviso de qué se descarga y de dónde', () => {
    const html = view(snap())
    expect(html).toContain('Node.js y uv')
    expect(html).toContain('nodejs.org y github.com')
    expect(html).toContain('Instalar (≈ 67 MB)')
    expect(html).not.toContain('Quitar')
  })
  it('instalando: barra de progreso con el porcentaje real y cancelar', () => {
    const html = view(snap({ installing: true, progress: { phase: 'download', done: 33_664_873, total: 67_329_746 } }))
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('width:50%')
    expect(html).toContain('Cancelar')
    expect(runtimesPct(snap({ installing: true, progress: { phase: 'download', done: 33_664_873, total: 67_329_746 } }))).toBe(50)
    expect(runtimesPct(snap())).toBeNull()
  })
  it('listos: muestra las versiones fijadas y «Quitar»', () => {
    const html = view(
      snap({
        ready: true,
        missingBytes: 0,
        items: [
          { id: 'node', state: 'installed', version: '24.22.0' },
          { id: 'uv', state: 'installed', version: '0.13.1' }
        ]
      })
    )
    expect(html).toContain('Listo · Node.js 24.22.0 · uv 0.13.1')
    expect(html).toContain('Quitar')
    expect(html).not.toContain('Instalar (')
  })
  it('dañados: lo dice, deja quitar y reintentar', () => {
    const html = view(
      snap({
        items: [
          { id: 'node', state: 'installed', version: '24.22.0' },
          { id: 'uv', state: 'broken', version: '0.13.1' }
        ]
      })
    )
    expect(html).toContain('dañadas')
    expect(html).toContain('Quitar')
    expect(html).toContain('Instalar (')
  })
  it('un fallo muestra su motivo real y «Reintentar»', () => {
    const html = view(snap(), { error: 'hash' })
    expect(html).toContain('no coincide')
    expect(html).toContain('Reintentar')
  })
  it('F8-B198: cada causa tiene su mensaje distinto (conexión, huella, espacio, permiso, cancelado), en español e inglés', () => {
    const causas = ['offline', 'hash', 'disk', 'permission', 'cancelled'] as const
    for (const lang of [es, en]) {
      const textos = causas.map((c) => lang[runtimesErrorKey(c)])
      expect(new Set(textos).size).toBe(causas.length)
    }
    // Sin espacio y sin permiso ya no culpan a la conexión.
    expect(es[runtimesErrorKey('disk')]).not.toMatch(/conexión/)
    expect(es[runtimesErrorKey('permission')]).not.toMatch(/conexión/)
    expect(en[runtimesErrorKey('permission')]).not.toMatch(/connection/)
    expect(es[runtimesErrorKey('permission')]).toMatch(/carpeta/)
  })
  it('cada código de fallo tiene texto en español e inglés (nunca «falló» sin explicación)', () => {
    for (const code of [
      'disk',
      'permission',
      'offline',
      'hash',
      'download',
      'unsafe',
      'broken',
      'cancelled',
      'unsupported',
      'io',
      'otro',
      undefined
    ]) {
      const k = runtimesErrorKey(code)
      expect(es[k], String(code)).toBeTruthy()
      expect(en[k], String(code)).toBeTruthy()
    }
  })
})
