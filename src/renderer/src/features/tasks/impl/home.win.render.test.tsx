/**
 * Inicio de Tareas en Windows (con `tasksWin` y SIN Control del PC): no hay selector de modo de acceso, ni categoría de
 * «controlar el equipo», ni consejo de Control total, ni «Vista rápida»; los textos hablan del Explorador. macOS no cambia
 * (lo fijan los snapshots de `home.desk.render.test.tsx`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setI18nPlatform } from '@shared/i18n'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { ScopePicker } from './ScopePicker'
import { Home } from './Home'
import { Onboarding } from './Onboarding'

const win = (): void => {
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'win32', capsFlags: { tasksWin: true } } }
  setI18nPlatform('win32')
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

const noop = (): void => undefined

describe('Tareas en Windows sin Control del PC', () => {
  it('no hay selector de modo de acceso', () => {
    win()
    expect(renderToStaticMarkup(<ScopePicker variant="cards" />)).not.toContain('radiogroup')
  })
  it('el inicio no ofrece la categoría de controlar el equipo ni nombra el Mac', () => {
    win()
    const html = renderToStaticMarkup(<Home onSend={async () => undefined} sendError={null} folderBusy={false} />)
    expect(html).not.toContain('radiogroup')
    expect(html).not.toMatch(/Control del (Mac|PC)/)
    expect(html).not.toContain('Control total')
    expect(html).toContain('Documentos')
  })
  it('la guía de primer uso no habla de Control total ni de su atajo', () => {
    win()
    const html = renderToStaticMarkup(<Onboarding onDismiss={noop} />)
    expect(html).not.toContain('Control total')
    expect(html).not.toMatch(/[⌘⌥⌃]/)
  })
})
describe('Tareas en macOS (referencia)', () => {
  it('el selector de modo y la categoría siguen estando', () => {
    expect(renderToStaticMarkup(<ScopePicker variant="cards" />)).toContain('radiogroup')
    expect(renderToStaticMarkup(<Home onSend={async () => undefined} sendError={null} folderBusy={false} />)).toContain('Control del Mac')
  })
})
