import { describe, expect, it, vi } from 'vitest'
import { translate } from '@shared/i18n'
import { officeController, officeErrorKey, officeMb, type ComponentApi, type InstallResult } from './component-install'

const tEs = (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]): string => translate('es', k, p)

describe('componentes opcionales › utilidades', () => {
  it('megabytes redondeados (1 MB = 1e6 bytes)', () => {
    expect(officeMb(212_400_000)).toBe(212)
    expect(officeMb(212_600_000)).toBe(213)
    expect(officeMb(-5)).toBe(0)
  })

  it.each([
    ['disk', 'No hay espacio suficiente'],
    ['hash', 'no coincide'],
    ['size', 'no coincide'],
    ['signature', 'La firma no es válida'],
    ['download', 'revisa tu conexión'],
    ['cancelled', 'Instalación cancelada'],
    ['mount', 'No se pudo instalar'],
    [undefined, 'No se pudo instalar']
  ] as const)('error %s → mensaje humano', (code, text) => {
    expect(tEs(officeErrorKey(code))).toContain(text)
  })
})

describe('componentes opcionales › consentimiento y acciones', () => {
  const mk = (install: InstallResult = { ok: true }, accept = true) => {
    const installFn = vi.fn(async () => install)
    const api: ComponentApi<null> = {
      status: vi.fn(async () => null),
      install: installFn,
      cancel: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
    const confirm = vi.fn(async (_mb: number) => accept)
    return { api, installFn, confirm, ctl: officeController(api, confirm) }
  }

  it('confirmar → instalar (con el tamaño en MB), siempre en ese orden', async () => {
    const m = mk()
    const onStart = vi.fn()
    expect(await m.ctl.install(205, onStart)).toEqual({ kind: 'installed' })
    expect(m.confirm).toHaveBeenCalledWith(205)
    expect(m.installFn).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(m.confirm.mock.invocationCallOrder[0]).toBeLessThan(m.installFn.mock.invocationCallOrder[0] as number)
  })

  it('si el usuario rechaza el consentimiento no se instala nada', async () => {
    const m = mk({ ok: true }, false)
    expect(await m.ctl.install(205)).toEqual({ kind: 'declined' })
    expect(m.installFn).not.toHaveBeenCalled()
  })

  it('un fallo de instalación devuelve su código', async () => {
    const m = mk({ ok: false, error: 'hash', message: 'SHA-256' })
    expect(await m.ctl.install(205)).toEqual({ kind: 'failed', error: 'hash' })
  })

  it('cancelar y quitar llaman a su canal', async () => {
    const m = mk()
    await m.ctl.cancel()
    await m.ctl.remove()
    expect(m.api.cancel).toHaveBeenCalledTimes(1)
    expect(m.api.remove).toHaveBeenCalledTimes(1)
  })
})
