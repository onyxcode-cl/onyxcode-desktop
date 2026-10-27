/** Selector único de alcance: ambas opciones con su descripción, carpeta obligatoria vs opcional y oculto sin Control del PC. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setI18nPlatform } from '@shared/i18n'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { ScopePicker } from './ScopePicker'

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

describe('ScopePicker (cards)', () => {
  it('ofrece «Una carpeta» (obligatoria) y «El computador completo» (carpeta opcional)', () => {
    const html = renderToStaticMarkup(<ScopePicker variant="cards" />)
    expect(html).toContain('radiogroup')
    expect(html).toContain('Una carpeta')
    expect(html).toContain('Carpeta aislada y obligatoria')
    expect(html).toContain('El computador completo')
    expect(html).toContain('la carpeta es opcional')
    expect(html).toContain('data-testid="scope-folder"')
    expect(html).toContain('data-testid="scope-computer"')
  })
  it('sin Control del PC (Windows) no hay selector de alcance', () => {
    ;(globalThis as { window?: unknown }).window = { api: { platform: 'win32', capsFlags: { tasksWin: true } } }
    setI18nPlatform('win32')
    const html = renderToStaticMarkup(<ScopePicker variant="cards" />)
    expect(html).not.toContain('radiogroup')
    expect(html).not.toContain('El computador completo')
  })
})
