import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { es } from '@shared/i18n/es'
import { en } from '@shared/i18n/en'
import type { VideoSnapshot } from '@shared/video'
import { VideoCardView } from './VideoCard'

const snap = (extra: Partial<VideoSnapshot> = {}): VideoSnapshot => ({
  offered: true,
  ready: false,
  missingBytes: 196_558_939,
  installing: false,
  items: [{ id: 'chrome', state: 'missing', version: '158.0.8127.36' }],
  ...extra
})
const noop = (): void => undefined
const view = (s: VideoSnapshot | null, lang: typeof es | typeof en = es): string =>
  renderToStaticMarkup(
    <VideoCardView
      snapshot={s}
      busy={false}
      error={null}
      onInstall={noop}
      onCancel={noop}
      onRemove={noop}
      t={(k, p) => String(lang[k]).replace(/\{(\w+)\}/g, (_, n) => String(p?.[n] ?? ''))}
    />
  )
describe('tarjeta de piezas de video', () => {
  it('ofrece tamaño y avisos de procedencia/licencia en ambos idiomas', () => {
    expect(view(snap())).toContain('Instalar piezas de video (≈ 197 MB)')
    for (const lang of [es, en]) {
      const html = view(snap(), lang)
      expect(html).toContain('Chrome for Testing')
      expect(html).toContain('GPL')
      expect(html).toContain(lang['settings.video.source'])
      expect(html).toContain(lang['settings.video.license'])
    }
    expect(view(null)).toBe('')
    expect(view(snap({ offered: false }))).toBe('')
  })
  it('muestra progreso, fase npm indeterminada, Cancelar y Quitar', () => {
    const html = view(snap({ installing: true, progress: { phase: 'download', done: 50, total: 100 } }))
    expect(html).toContain('width:50%')
    expect(html).toContain('Cancelar')
    expect(view(snap({ installing: true, progress: { phase: 'npm' } }))).not.toContain('aria-valuenow')
    const installed = view(snap({ ready: true, items: [{ id: 'chrome', state: 'installed', version: '158.0.8127.36' }] }))
    expect(installed).toContain('Quitar')
    expect(installed).not.toContain('Instalar piezas')
  })
})
