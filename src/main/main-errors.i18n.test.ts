import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang, t } from '@shared/i18n'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  protocol: {},
  BrowserWindow: class {},
  globalShortcut: {},
  screen: {}
}))

import { AccountApiError } from './account/client'
import { friendlyAccountError } from './account/service'
import { validateOpencodeBin } from './opencode/binary'
import { forbiddenFolderReason, type FolderPolicyContext } from './tasks/folder-policy'
import { ruleRejectionReason } from './tasks/rules'
import { nextRunAfter, scheduleLabel } from './scheduler/schedule'
import { withLang } from './extras/windows'
import { macOnly } from '../test/platform'

const ctx: FolderPolicyContext = {
  home: '/Users/x',
  userData: '/Users/x/Library/Application Support/OnyxCode',
  mounts: []
}

afterEach(() => setLang('es'))

describe('errores que construye main: idioma activo', () => {
  it('con es el texto es el de siempre', () => {
    expect(friendlyAccountError(new AccountApiError('unreachable', 'x'), 'f').message).toBe(
      'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
    )
    expect(t('merr.engine.noBinary')).toContain('No se encontró el binario `opencode`.')
    // folder-policy es del modo Tareas (rutas de macOS): solo se comprueba en macOS.
    if (macOnly) expect(forbiddenFolderReason('/', ctx)).toContain('No se puede usar la raíz del disco')
    expect(scheduleLabel({ kind: 'daily', time: '08:00' })).toBe('Todos los días a las 08:00')
    expect(scheduleLabel({ kind: 'weekly', day: 1, time: '09:30' })).toBe('Cada lunes a las 09:30')
    expect(t('merr.notif.routineRejected', { count: 1 })).toBe('Se rechazó 1 permiso')
    expect(t('merr.notif.routineRejected', { count: 3 })).toBe('Se rechazaron 3 permisos')
  })

  it('con en: cuenta, binario, carpetas, reglas y rutinas salen en inglés', async () => {
    setLang('en')
    expect(friendlyAccountError(new AccountApiError('unreachable', 'x'), 'f').message).toBe(
      'Couldn’t connect to the server. Check your connection and try again.'
    )
    expect(friendlyAccountError(new AccountApiError('http', 'x', 429, undefined, 120), 'f').message).toBe(
      'Too many attempts. Wait 2 min. Please try again later.'
    )
    expect(t('merr.engine.noBinary')).toMatch(/^Couldn’t find the `opencode` binary\./)
    const bin = await validateOpencodeBin('relativa/ruta')
    expect(bin).toEqual({ ok: false, error: 'The path isn’t valid.' })
    // folder-policy es del modo Tareas (rutas de macOS): solo se comprueba en macOS.
    if (macOnly) {
      expect(forbiddenFolderReason('/', ctx)).toMatch(/^You can’t use the disk root/)
      expect(forbiddenFolderReason('/Users/x/Library/Foo', ctx)).toMatch(/protected macOS location/)
      expect(forbiddenFolderReason('/Volumes', ctx)).toBe('Choose a folder inside the volume, not the list of volumes.')
      expect(forbiddenFolderReason('/Users/x/Docs', { ...ctx, allowedRoots: [] })).toBe(
        'Your organization doesn’t allow using folders in Tasks.'
      )
    }
    expect(ruleRejectionReason('bash', '*')).toBe('A bash pattern this broad can’t be remembered: it would also cover delete commands.')
    expect(scheduleLabel({ kind: 'weekly', day: 1, time: '09:30' })).toBe('Every Monday at 09:30')
    expect(scheduleLabel({ kind: 'interval', hours: 6 })).toBe('Every 6 hours')
    expect(() => nextRunAfter({ kind: 'daily', time: '99:99' }, Date.now())).toThrow('Invalid time "99:99"')
    expect(t('merr.notif.routineRejected', { count: 1 })).toBe('1 permission was rejected')
  })

  it('el tag de Control total conserva el código estable', () => {
    for (const lang of ['es', 'en'] as const) {
      setLang(lang)
      expect(`FULL_ACCESS_NOT_GRANTED: ${t('merr.task.fullNotGranted')}`).toMatch(/^FULL_ACCESS_NOT_GRANTED: /)
    }
  })

  it('withLang añade ?lang= antes del hash', () => {
    expect(withLang('quick/index.html', 'en')).toBe('quick/index.html?lang=en')
    expect(withLang('overlay/assist.html#teach', 'en')).toBe('overlay/assist.html?lang=en#teach')
    expect(withLang('overlay/pill.html?x=1', 'es')).toBe('overlay/pill.html?x=1&lang=es')
  })
})
