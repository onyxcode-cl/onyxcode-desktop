/**
 * Aviso «app bloqueada» en el hilo (P4): tres casos con texto propio (quién, por qué y pasos); el de seguridad NUNCA ofrece
 * desbloqueo; el de la persona abre Ajustes; el de la tarea no tiene botón. Variante Windows y textos en inglés.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { setI18nPlatform } from '@shared/i18n'
import { es } from '@shared/i18n/es'
import { en } from '@shared/i18n/en'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), { getState: () => mock.state })
}))

import { BlockedAppNotices } from './BlockedAppNotice'

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

const html = (kind: 'fixed' | 'user' | 'session', name = 'Foo'): string => {
  mock.state = { blockedApps: { t1: [{ bundleId: 'x', name, kind }] } }
  return renderToStaticMarkup(<BlockedAppNotices taskId="t1" />)
}

describe('aviso de app bloqueada', () => {
  it('bloqueada por la persona: dice quién, la ruta exacta y ofrece «Desbloquear…»', () => {
    const h = html('user')
    expect(h).toContain('Foo está bloqueada porque tú la bloqueaste.')
    expect(h).toContain('Ajustes › Control del Mac › Bloqueadas por ti › Quitar')
    expect(h).toContain('Desbloquear…')
  })

  it('bloqueada por seguridad: explica el porqué, no se puede desbloquear y NUNCA ofrece desbloqueo', () => {
    const h = html('fixed', '1Password')
    expect(h).toContain('1Password está bloqueada por seguridad: guarda claves y Lazunox nunca la controla.')
    expect(h).toContain('no se puede desbloquear desde la app')
    expect(h).not.toContain('<button')
    expect(h).not.toContain('Desbloquear')
    expect(h).not.toContain('Quitar')
  })

  it('denegada solo en esta tarea: texto de «pídeselo de nuevo» y sin botón', () => {
    const h = html('session')
    expect(h).toContain('Dijiste que no a Foo en esta tarea.')
    expect(h).toContain('pídeselo de nuevo al agente')
    expect(h).not.toContain('<button')
  })

  it('Windows: la ruta dice Control del PC', () => {
    ;(globalThis as { window?: unknown }).window = { api: { platform: 'win32', capsFlags: {} } }
    setI18nPlatform('win32')
    expect(html('user')).toContain('Ajustes › Control del PC › Bloqueadas por ti › Quitar')
  })

  it('sin avisos no pinta nada', () => {
    mock.state = { blockedApps: {} }
    expect(renderToStaticMarkup(<BlockedAppNotices taskId="t1" />)).toBe('')
  })

  it('inglés: los tres textos existen y el de seguridad no promete desbloqueo', () => {
    expect(en['tasksComputer.blocked.user']).toContain('Blocked by you › Remove')
    expect(en['tasksComputer.blocked.user.win']).toContain('PC control')
    expect(en['tasksComputer.blocked.session']).toContain('ask the agent again')
    expect(en['tasksComputer.blocked.fixed']).toContain('can’t be unblocked')
    expect(es['tasksComputer.blocked.fixed']).not.toMatch(/Quitar|Desbloquear/)
  })
})
