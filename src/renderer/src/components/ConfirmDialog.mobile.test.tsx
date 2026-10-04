import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmDialogHost, confirmDialog, promptDialog } from './ConfirmDialog'
import { ToastView } from './mobile/Toast'

const g = globalThis as unknown as { window?: unknown }

afterEach(() => {
  delete g.window
})

describe('ConfirmDialog en el celular (superficie remota)', () => {
  it('lleva los atributos que usa el CSS móvil: fondo, tarjeta y botones apilados', () => {
    g.window = { api: { platform: 'remote' } }
    void confirmDialog({ title: 't', message: 'm', danger: true })
    const out = renderToStaticMarkup(createElement(ConfirmDialogHost))
    expect(out).toContain('data-confirm-scrim=""')
    expect(out).toContain('data-confirm-card=""')
    expect(out).toContain('data-confirm-actions=""')
    expect(out).toContain('role="alertdialog"')
    expect(out).toContain('aria-labelledby="confirm-dialog-title"')
  })

  it('el campo del prompt pide letra de 16 px por CSS y tecla «listo»', () => {
    g.window = { api: { platform: 'remote' } }
    void promptDialog({ title: 'Nombre' })
    const out = renderToStaticMarkup(createElement(ConfirmDialogHost))
    expect(out).toContain('data-confirm-input=""')
    expect(out).toMatch(/enterkeyhint="done"/i)
  })

  it('en escritorio no hay ningún atributo móvil', () => {
    void confirmDialog({ title: 't' })
    const out = renderToStaticMarkup(createElement(ConfirmDialogHost))
    expect(out).not.toContain('data-confirm-')
  })
})

describe('Toast móvil', () => {
  it('es un estado accesible; el de error avisa con alerta', () => {
    expect(renderToStaticMarkup(createElement(ToastView, { text: 'Fijada' }))).toContain('role="status"')
    const err = renderToStaticMarkup(createElement(ToastView, { text: 'Falló', tone: 'danger' }))
    expect(err).toContain('role="alert"')
    expect(err).toContain('Falló')
  })
})
