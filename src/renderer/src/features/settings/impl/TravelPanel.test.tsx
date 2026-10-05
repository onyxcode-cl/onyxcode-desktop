import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate, type MsgKey, type Params } from '@shared/i18n'
import { REMOTE_OFF_STATE, type RemotePolicyView, type RemoteState } from '@shared/ipc-remote'
import type { TravelState } from '@shared/remote/travel'
import {
  TravelPanelView,
  activateTravelFlow,
  formatCountdown,
  travelBlockedText,
  travelErrorText,
  travelInstallErrorText,
  travelKeepOptions,
  travelNeedsDownload
} from './TravelPanel'

const tEs = (k: MsgKey, p?: Params): string => translate('es', k, p)
const tEn = (k: MsgKey, p?: Params): string => translate('en', k, p)

const travel = (o: Partial<TravelState> = {}): TravelState => ({ status: 'idle', keep: 'idle30', binary: 'ready', ...o })
const st = (tr: TravelState | undefined, extra: Partial<RemoteState> = {}): RemoteState => ({
  ...REMOTE_OFF_STATE,
  connection: 'travel',
  ...(tr ? { travel: tr } : {}),
  ...extra
})
const policy = (o: Partial<RemotePolicyView> = {}): RemotePolicyView =>
  ({ managed: true, blocked: false, allowTravelMode: true, travelMaxHours: 24, ...o }) as RemotePolicyView

const html = (state: RemoteState, o: Partial<Parameters<typeof TravelPanelView>[0]> = {}, t = tEs): string =>
  renderToStaticMarkup(
    createElement(TravelPanelView, { t, state, busy: false, now: 0, unsupported: false, installError: null, onKeep: vi.fn(), ...o })
  )

describe('Modo viaje › explicación honesta', () => {
  it('lista los límites y lo que ve Cloudflare', () => {
    const h = html(st(travel()))
    expect(h).toContain('El enlace cambia cada vez que se reinicia el túnel')
    expect(h).toContain('vincular el celular en casa')
    expect(h).toContain('encendido, con internet y con OnyxCode abierta')
    expect(h).toContain('redes móviles o de empresa')
    expect(h).toContain('no ve tus conversaciones')
    expect(h).toContain('señalización')
  })

  it('no menciona ningún servidor propio ni Workers', () => {
    for (const t of [tEs, tEn]) expect(html(st(travel()), {}, t)).not.toMatch(/Worker|servicio fijo|fixed service/i)
  })

  it('en inglés también', () => {
    const h = html(st(travel()), {}, tEn)
    expect(h).toContain('The link changes every time the tunnel restarts')
    expect(h).toContain('does not see your conversations')
  })
})

describe('Modo viaje › estados del túnel', () => {
  it.each([
    ['downloading', 'Descargando y verificando'],
    ['starting', 'Abriendo el enlace'],
    ['checking', 'Comprobando que el enlace responde'],
    ['online', 'Enlace activo'],
    ['connecting', 'Reiniciando el enlace'],
    ['retrying', 'Reiniciando el enlace'],
    ['failed', 'No se pudo abrir el enlace'],
    ['idle', 'Modo viaje apagado']
  ] as const)('%s', (status, text) => {
    const h = html(st(travel({ status })))
    expect(h).toContain(text)
    expect(h).toContain('aria-live="polite"')
  })

  it('el giro de espera respeta movimiento reducido', () => {
    expect(html(st(travel({ status: 'starting' })))).toContain('motion-reduce:animate-none')
  })

  it('cuenta atrás solo con «mantener abierto» (h*) y túnel activo', () => {
    const online = { status: 'online', url: 'https://aa-bb.trycloudflare.com', expiresAt: 3_600_000 } as const
    expect(html(st(travel({ ...online, keep: 'h4' })))).toContain('Se corta en 1 h 00 min')
    expect(html(st(travel({ ...online, keep: 'idle30' })))).not.toContain('Se corta en')
    expect(html(st(travel({ status: 'starting', keep: 'h4', expiresAt: 3_600_000 })))).not.toContain('Se corta en')
  })

  it('muestra solo el host del túnel, sin esquema ni ruta', () => {
    const h = html(st(travel({ status: 'online', url: 'https://aa-bb.trycloudflare.com' })))
    expect(h).toContain('aa-bb.trycloudflare.com')
    expect(h).not.toContain('https://aa-bb')
  })

  it('al reiniciar avisa de volver a vincular', () => {
    expect(html(st(travel({ status: 'retrying' })))).toContain('vuelve a vincular el celular en casa')
  })

  it('diagnóstico de conexión directa fallida', () => {
    expect(html(st(travel({ status: 'online', directFailures: 2 })))).toContain('2 intento(s)')
  })

  it('herramienta ausente / desactualizada / con huella mala se explica', () => {
    expect(html(st(travel({ binary: 'missing' })))).toContain('Aún no se descargó')
    expect(html(st(travel({ binary: 'outdated' })))).toContain('otra versión')
    expect(html(st(travel({ binary: 'bad-hash' })))).toContain('no pasó la verificación')
  })
})

describe('Modo viaje › errores con motivos claros', () => {
  it.each([
    ['rate', 'limitó la creación'],
    ['edge-unreachable', 'puerto 7844'],
    ['config-conflict', 'configuración de cloudflared'],
    ['timeout', 'tardó demasiado'],
    ['bad-url', 'no es válido'],
    ['unreachable', 'no responde desde internet'],
    ['site-mismatch', 'no coincide'],
    ['no-binary', 'Falta descargar'],
    ['download', 'No se pudo descargar'],
    ['exited:7', 'código 7']
  ] as const)('%s', (error, text) => {
    expect(travelErrorText(tEs, error)).toContain(text)
    expect(travelErrorText(tEn, error)).not.toBe('')
    expect(html(st(travel({ status: 'failed', error })))).toContain(text)
  })

  it('un error desconocido no filtra texto crudo', () => {
    expect(travelErrorText(tEs, 'ERR secreto https://x.trycloudflare.com')).not.toContain('secreto')
  })

  it('fallos de descarga por código del Mac', () => {
    for (const c of [
      'policy',
      'consent',
      'unsupported',
      'bad-hash',
      'bad-signature',
      'download',
      'extract',
      'busy',
      'no-binary',
      undefined,
      'raro'
    ])
      expect(travelInstallErrorText(tEs, c)).not.toBe('')
    expect(html(st(travel()), { installError: 'bad-signature' })).toContain('firma de la herramienta descargada')
  })
})

describe('Modo viaje › bloqueos con explicación', () => {
  it.each([
    ['policy', 'política de tu organización'],
    ['confirm-required', 'confirmar cada conexión'],
    ['passkey-required', 'passkey']
  ] as const)('%s', (blocked, text) => {
    expect(travelBlockedText(tEs, blocked)).toContain(text)
    const h = html(st(travel({ blocked })))
    expect(h).toContain(text)
    expect(h).toContain('role="alert"')
  })

  it('bloqueado oculta el error del túnel (manda el motivo)', () => {
    const h = html(st(travel({ status: 'failed', error: 'rate', blocked: 'policy' })))
    expect(h).not.toContain('limitó la creación')
  })
})

describe('Modo viaje › selector de duración bajo política', () => {
  it('sin política ofrece las cuatro', () => {
    expect(travelKeepOptions(undefined)).toEqual(['idle30', 'h4', 'h12', 'h24'])
  })
  it('respeta travelMaxHours', () => {
    expect(travelKeepOptions(24)).toEqual(['idle30', 'h4', 'h12', 'h24'])
    expect(travelKeepOptions(12)).toEqual(['idle30', 'h4', 'h12'])
    expect(travelKeepOptions(4)).toEqual(['idle30', 'h4'])
    expect(travelKeepOptions(1)).toEqual(['idle30'])
  })
  it('la vista no pinta opciones por encima del tope y avisa', () => {
    const h = html(st(travel({ keep: 'h24' }), { policy: policy({ travelMaxHours: 4 }) }))
    expect(h).toContain('hasta 4 h')
    expect(h).not.toContain('hasta 12 h')
    expect(h).not.toContain('hasta 24 h')
    expect(h).toContain('limita el enlace a 4 h')
    // la duración guardada no cabe: el selector cae en la predeterminada
    expect(h).toMatch(/<option value="idle30" selected/)
  })
  it('la predeterminada es «30 min sin uso»', () => {
    expect(html(st(travel()))).toMatch(/<option value="idle30" selected/)
  })
  it('con la política en contra el selector queda deshabilitado', () => {
    expect(html(st(travel({ blocked: 'policy' })))).toContain('disabled=""')
  })
})

describe('Modo viaje › sin soporte', () => {
  it('se explica y no hay selector ni estado', () => {
    const h = html(st(travel()), { unsupported: true })
    expect(h).toContain('solo está disponible en Mac con chip Apple')
    expect(h).not.toContain('<select')
    expect(h).not.toContain('Enlace activo')
  })
})

describe('Modo viaje › consentimiento obligatorio antes de descargar', () => {
  const mk = (binaryReady: boolean, accept: boolean) => {
    const confirm = vi.fn(async () => accept)
    const install = vi.fn(async () => ({ ok: true }))
    const start = vi.fn(async () => REMOTE_OFF_STATE)
    return { confirm, install, start, run: () => activateTravelFlow({ binaryReady, confirm, install, start }) }
  }

  it('sin herramienta: pide consentimiento, descarga y luego activa (en ese orden)', async () => {
    const m = mk(false, true)
    const r = await m.run()
    expect(r.kind).toBe('started')
    expect(m.confirm.mock.invocationCallOrder[0]).toBeLessThan(m.install.mock.invocationCallOrder[0] as number)
    expect(m.install.mock.invocationCallOrder[0]).toBeLessThan(m.start.mock.invocationCallOrder[0] as number)
  })

  it('si se rechaza el consentimiento NO se descarga ni se activa', async () => {
    const m = mk(false, false)
    expect(await m.run()).toEqual({ kind: 'cancelled' })
    expect(m.install).not.toHaveBeenCalled()
    expect(m.start).not.toHaveBeenCalled()
  })

  it('si la descarga falla no se activa y se devuelve el motivo', async () => {
    const m = mk(false, true)
    m.install.mockResolvedValueOnce({ ok: false, error: 'bad-hash' } as { ok: boolean })
    expect(await m.run()).toEqual({ kind: 'install-failed', error: 'bad-hash' })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('con la herramienta lista no hay diálogo ni descarga', async () => {
    const m = mk(true, false)
    expect((await m.run()).kind).toBe('started')
    expect(m.confirm).not.toHaveBeenCalled()
    expect(m.install).not.toHaveBeenCalled()
  })

  it('travelNeedsDownload según el estado de la herramienta', () => {
    expect(travelNeedsDownload(st(travel({ binary: 'ready' })))).toBe(false)
    for (const binary of ['missing', 'outdated', 'bad-hash'] as const) expect(travelNeedsDownload(st(travel({ binary })))).toBe(true)
    expect(travelNeedsDownload(st(undefined))).toBe(true)
  })

  it('el texto del consentimiento dice tamaño, origen, verificación y que se puede borrar', () => {
    const body = tEs('remote.travel.consent.body')
    expect(body).toContain('20 MB')
    expect(body).toContain('Cloudflare en GitHub')
    expect(body).toMatch(/firma/)
    expect(body).toMatch(/huellas/)
    expect(body).toMatch(/borrar/)
    expect(tEs('remote.travel.consent.confirm')).toBe('Descargar y activar')
  })
})

describe('formatCountdown', () => {
  it('formatea horas, minutos y segundos', () => {
    expect(formatCountdown(3_725_000)).toBe('1 h 02 min')
    expect(formatCountdown(125_000)).toBe('2 min 05 s')
    expect(formatCountdown(-5)).toBe('0 min 00 s')
  })
})
