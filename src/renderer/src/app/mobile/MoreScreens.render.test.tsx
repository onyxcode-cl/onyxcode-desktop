import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ConnectionCard, confirmUnlink } from './ConnectionCard'
import { SettingsHome } from './MoreScreens'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('../../components/ConfirmDialog', () => ({ confirmDialog: confirm }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
})
afterEach(() => {
  delete g.window
  confirm.mockReset()
})

describe('Ajustes: una sola pantalla apilada (rediseño PWA T4)', () => {
  it('tarjeta de conexión + un grupo «General» con filas de 52 px y sin controles que no existen', () => {
    const html = renderToStaticMarkup(createElement(SettingsHome))
    expect(count(html, /data-m="connection"/g)).toBe(1)
    expect(count(html, /data-m="list-group"/g)).toBe(1)
    expect(count(html, /<h2/g)).toBe(2) // «Tu Mac» y el overline del grupo
    expect(count(html, /<button[^>]*min-h-\[52px\]/g)).toBe(2) // General y Modelos
    expect(html).not.toContain('uppercase')
    expect(html).toContain('divide-[var(--m-hairline)]')
    for (const gone of ['Sincronizar', 'Avisar aprobaciones', 'sincronizado hace']) expect(html).not.toContain(gone)
  })
})

describe('Tarjeta de conexión', () => {
  it('estado del enlace con punto, motor, «Bloquear ahora» y «Desvincular» (peligro) de 44 px', () => {
    const html = renderToStaticMarkup(createElement(ConnectionCard))
    expect(html).toContain('Tu Mac')
    expect(html).toContain('role="status"')
    expect(html).toContain('Conectado') // sin enlace se considera en línea
    expect(html).toContain('bg-success')
    expect(html).toContain('Bloquear ahora')
    expect(count(html, /<button[^>]*min-h-11/g)).toBe(2)
    expect(count(html, /<button[^>]*text-danger/g)).toBe(1)
    expect(html).toMatch(/<button[^>]*aria-label="Desvincular este celular"[^>]*>Desvincular<\/button>/)
  })

  it('Desvincular pide la confirmación de siempre (mismo título y mensaje, en tono de peligro)', async () => {
    confirm.mockResolvedValue(true)
    const t = (k: string): string => k
    expect(await confirmUnlink(t as never)).toBe(true)
    expect(confirm).toHaveBeenCalledWith({
      title: 'mobile.phone.unlink.title',
      message: 'mobile.phone.unlink.message',
      confirmLabel: 'mobile.phone.unlink.confirm',
      danger: true
    })
  })
})
