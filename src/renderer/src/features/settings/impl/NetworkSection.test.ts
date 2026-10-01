import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import type { ManagedPolicy } from '@shared/ipc-tasks'
import { customHostsBlockedMessage, networkErrorMessage } from './NetworkSection'

afterEach(() => setLang('es'))

describe('networkErrorMessage', () => {
  const locked = { disableCustomHosts: true } as ManagedPolicy

  it('con la política que bloquea sitios usa el texto del renderer, sea cual sea el error', () => {
    expect(networkErrorMessage(new Error('lo que sea'), locked)).toBe(customHostsBlockedMessage())
    setLang('en')
    expect(networkErrorMessage(new Error('cualquier cosa'), locked)).toBe(
      'Your organization doesn’t allow adding sites to the sandbox network.'
    )
  })

  it('no clasifica por el texto del error: sin política conocida se muestra tal cual (main ya lo redacta en el idioma activo)', () => {
    expect(networkErrorMessage(new Error('Tu organización no permite añadir sitios'), null)).toBe(
      'Tu organización no permite añadir sitios'
    )
    expect(networkErrorMessage(new Error('Your organization policy blocks this'), { disableCustomHosts: false } as ManagedPolicy)).toBe(
      'Your organization policy blocks this'
    )
    expect(networkErrorMessage('boom', null)).toBe('boom')
  })
})
