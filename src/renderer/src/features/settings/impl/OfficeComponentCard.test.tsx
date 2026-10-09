/** Ajustes › Tareas › LibreOffice (componentes opcionales): vista por estado y lógica de consentimiento/instalación. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate, type MsgKey, type Params } from '@shared/i18n'
import type { OfficeInstallResult, OfficeUiSnapshot } from '@shared/office'
import {
  OfficeCardView,
  officeController,
  officeErrorKey,
  officeMb,
  officeNeedsPoll,
  type OfficeApi,
  type OfficeCardViewProps
} from './OfficeComponentCard'

const tEs = (k: MsgKey, p?: Params): string => translate('es', k, p)
const tEn = (k: MsgKey, p?: Params): string => translate('en', k, p)

const snap = (o: Partial<OfficeUiSnapshot> = {}): OfficeUiSnapshot => ({
  status: { state: 'missing', version: '24.8.7', sizeBytes: 212_400_000 },
  installing: false,
  ...o
})

const view = (s: OfficeUiSnapshot | null, o: Partial<OfficeCardViewProps> = {}, t = tEs): string =>
  renderToStaticMarkup(
    createElement(OfficeCardView, {
      t,
      snapshot: s,
      busy: false,
      error: null,
      onInstall: vi.fn(),
      onCancel: vi.fn(),
      onRemove: vi.fn(),
      ...o
    })
  )

describe('LibreOffice › utilidades', () => {
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

  it('sondea solo mientras instala', () => {
    expect(officeNeedsPoll(snap({ installing: true }))).toBe(true)
    expect(officeNeedsPoll(snap())).toBe(false)
    expect(officeNeedsPoll(null)).toBe(false)
  })
})

describe('LibreOffice › vista por estado', () => {
  it('unsupported no renderiza nada', () => {
    expect(view(snap({ status: { state: 'unsupported', reason: 'Windows' } }))).toBe('')
  })

  it('sin snapshot todavía no renderiza nada', () => {
    expect(view(null)).toBe('')
  })

  it('missing muestra el botón de instalar con el tamaño y el texto corto', () => {
    const h = view(snap())
    expect(h).toContain('Sirve para que el agente revise cómo quedan los Word, Excel y PowerPoint que crea.')
    expect(h).toContain('Instalar (≈ 212 MB)')
    expect(h).not.toContain('Reintentar')
  })

  it('installing muestra la fase, la barra y done/total, y ofrece cancelar', () => {
    const h = view(snap({ installing: true, progress: { phase: 'download', done: 50_000_000, total: 200_000_000 } }), {})
    expect(h).toContain('Descargando')
    expect(h).toContain('role="progressbar"')
    expect(h).toContain('aria-valuenow="50000000"')
    expect(h).toContain('50 de 200 MB')
    expect(h).toContain('Cancelar instalación')
    expect(h).not.toContain('Instalar (≈')
  })

  it('installing por la pestaña (busy) antes de que llegue el primer sondeo', () => {
    const h = view(snap(), { busy: true })
    expect(h).toContain('role="progressbar"')
    expect(h).toContain('Cancelar instalación')
  })

  it.each([
    ['verify', 'Verificando'],
    ['mount', 'Montando'],
    ['copy', 'Copiando']
  ] as const)('fase %s', (phase, text) => {
    expect(view(snap({ installing: true, progress: { phase } }))).toContain(text)
  })

  it('installed (app) muestra versión y Quitar', () => {
    const h = view(snap({ status: { state: 'installed', source: 'app', version: '24.8.7' } }))
    expect(h).toContain('Instalado · versión 24.8.7')
    expect(h).toContain('>Quitar<')
  })

  it('installed (system) usa el de /Applications y no ofrece Quitar', () => {
    const h = view(snap({ status: { state: 'installed', source: 'system', version: '24.8.7' } }))
    expect(h).toContain('Usando el de /Applications · versión 24.8.7')
    expect(h).not.toContain('Quitar')
  })

  it.each([
    ['hash', 'no coincide con la esperada; no se instaló nada'],
    ['signature', 'La firma no es válida; no se instaló nada'],
    ['disk', 'No hay espacio suficiente'],
    ['download', 'revisa tu conexión'],
    ['cancelled', 'Instalación cancelada']
  ] as const)('error %s muestra su mensaje y Reintentar', (code, text) => {
    const h = view(snap({ error: code }))
    expect(h).toContain(text)
    expect(h).toContain('role="alert"')
    expect(h).toContain('Reintentar')
  })

  it('el error de la acción (error prop) también se muestra', () => {
    expect(view(snap(), { error: 'signature' })).toContain('La firma no es válida')
  })

  it('en inglés también', () => {
    const h = view(snap(), {}, tEn)
    expect(h).toContain('Install (≈ 212 MB)')
    expect(h).toContain('Lets the agent check how the Word, Excel and PowerPoint files it creates look.')
  })
})

describe('LibreOffice › consentimiento y acciones', () => {
  const mk = (install: OfficeInstallResult = { ok: true }, accept = true) => {
    const installFn = vi.fn(async () => install)
    const api: OfficeApi = {
      status: vi.fn(async () => snap()),
      install: installFn,
      cancel: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
    const confirm = vi.fn(async (_mb: number) => accept)
    return { api, installFn, confirm, ctl: officeController(api, confirm) }
  }

  it('missing → confirmar → office:install llamado (con el tamaño en MB)', async () => {
    const m = mk()
    const onStart = vi.fn()
    expect(await m.ctl.install(212, onStart)).toEqual({ kind: 'installed' })
    expect(m.confirm).toHaveBeenCalledWith(212)
    expect(m.installFn).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(m.confirm.mock.invocationCallOrder[0]).toBeLessThan(m.installFn.mock.invocationCallOrder[0] as number)
  })

  it('si el usuario rechaza el consentimiento no se instala nada', async () => {
    const m = mk({ ok: true }, false)
    expect(await m.ctl.install(212)).toEqual({ kind: 'declined' })
    expect(m.installFn).not.toHaveBeenCalled()
  })

  it('un fallo de instalación devuelve su código', async () => {
    const m = mk({ ok: false, error: 'hash', message: 'SHA-256' })
    expect(await m.ctl.install(212)).toEqual({ kind: 'failed', error: 'hash' })
  })

  it('cancelar instalación llama a office:cancel', async () => {
    const m = mk()
    await m.ctl.cancel()
    expect(m.api.cancel).toHaveBeenCalledTimes(1)
  })

  it('quitar llama a office:remove', async () => {
    const m = mk()
    await m.ctl.remove()
    expect(m.api.remove).toHaveBeenCalledTimes(1)
  })

  it('los textos del consentimiento dicen tamaño, origen y firma', () => {
    const body = tEs('settings.office.consent.body', { mb: 212 })
    expect(body).toContain('≈ 212 MB')
    expect(body).toContain('The Document Foundation')
    expect(body).toContain('firma')
    expect(body).toContain('no necesita contraseña de administrador')
    expect(tEs('settings.office.consent.confirm')).toBe('Instalar')
  })
})
