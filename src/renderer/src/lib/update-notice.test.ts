import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@shared/update-check'
import { IDLE_INSTALL } from '@shared/update-install'
import { checkResultText, downloadUrl, lastCheckText, updateNoticeText, updateView } from './update-notice'

const base: UpdateState = {
  available: true,
  configured: true,
  enabled: true,
  current: '1.0.0',
  latest: { version: '1.1.0', url: 'https://github.com/o/r/releases/tag/v1.1.0' },
  dismissed: null,
  lastCheck: 1000,
  checking: false,
  installable: false,
  install: IDLE_INSTALL
}

describe('updateNoticeText', () => {
  it('avisa con la versión nueva', () => {
    expect(updateNoticeText(base)).toBe('Hay una versión nueva de OnyxCode (1.1.0).')
  })
  it('null si no hay aviso', () => {
    expect(updateNoticeText(null)).toBeNull()
    expect(updateNoticeText({ ...base, available: false })).toBeNull()
    expect(updateNoticeText({ ...base, latest: null })).toBeNull()
  })
})

describe('checkResultText', () => {
  it('versión nueva, al día o sin poder comprobar', () => {
    expect(checkResultText(base, 500)).toBe('Hay una versión nueva: 1.1.0')
    expect(checkResultText({ ...base, latest: null }, 500)).toBe('Tienes la última versión.')
    expect(checkResultText({ ...base, latest: null }, 2000)).toBe('No se pudo comprobar ahora. Inténtalo más tarde.')
    expect(checkResultText({ ...base, latest: null, lastCheck: null }, 0)).toBe('No se pudo comprobar ahora. Inténtalo más tarde.')
  })
})

describe('downloadUrl', () => {
  it('solo acepta páginas de releases de github.com', () => {
    expect(downloadUrl(base)).toBe(base.latest!.url)
    for (const url of [
      'https://evil.example/x',
      'http://github.com/o/r/releases/tag/v1.1.0',
      'https://github.com/o/r/issues/1',
      'javascript:alert(1)'
    ])
      expect(downloadUrl({ ...base, latest: { version: '1.1.0', url } }), url).toBeNull()
    expect(downloadUrl(null)).toBeNull()
  })
})

describe('lastCheckText', () => {
  it('sin comprobación previa', () => expect(lastCheckText(null)).toContain('todavía no'))
  it('con fecha', () => expect(lastCheckText(1_700_000_000_000)).toMatch(/^Última comprobación: .+/))
})

describe('updateView', () => {
  const ids = (s: UpdateState, o?: { later?: boolean }): string[] => (updateView(s, o)?.actions ?? []).map((a) => a.id)
  const inst = (over: Partial<UpdateState['install']>): UpdateState['install'] => ({ ...IDLE_INSTALL, version: '1.1.0', ...over })

  it('sin instalador: el aviso de siempre (Descargar / Más tarde)', () => {
    expect(ids(base)).toEqual(['download-manual', 'later'])
    expect(updateView(base)?.actions[0].label).toBe('Descargar')
  })
  it('con instalador: Actualizar (principal) y Más tarde', () => {
    const v = updateView({ ...base, installable: true })
    expect(v?.actions).toEqual([
      { id: 'install', label: 'Actualizar', primary: true },
      { id: 'later', label: 'Más tarde' }
    ])
  })
  it('Acerca de no lleva «Más tarde»', () => {
    expect(ids({ ...base, installable: true }, { later: false })).toEqual(['install'])
  })
  it('descargando: porcentaje y Cancelar', () => {
    const v = updateView({ ...base, installable: true, install: inst({ phase: 'downloading', received: 420, total: 1000 }) })
    expect(v).toMatchObject({ phase: 'downloading', percent: 42, progress: true, text: 'Descargando OnyxCode 1.1.0…' })
    expect(v?.actions.map((a) => a.id)).toEqual(['cancel'])
  })
  it('verificando, lista, instalando, reiniciando', () => {
    const b = { ...base, installable: true }
    expect(updateView({ ...b, install: inst({ phase: 'verifying' }) })).toMatchObject({ text: 'Verificando la descarga…', progress: true })
    const ready = updateView({ ...b, install: inst({ phase: 'ready' }) })
    expect(ready?.actions[0]).toEqual({ id: 'restart', label: 'Reiniciar ahora', primary: true })
    expect(updateView({ ...b, install: inst({ phase: 'installing' }) })?.actions).toEqual([])
    expect(updateView({ ...b, install: inst({ phase: 'restarting' }) })?.text).toBe('Reiniciando OnyxCode…')
  })
  it('lista y descartada con «Más tarde»: el aviso se oculta, pero Acerca de sigue mostrándola', () => {
    const s = { ...base, installable: true, available: false, install: inst({ phase: 'ready' }) }
    expect(updateView(s)).toBeNull()
    expect(ids(s, { later: false })).toEqual(['restart'])
  })
  it('error: texto en español, Reintentar (si se puede) y Descargar manualmente', () => {
    const s = { ...base, installable: true, install: inst({ phase: 'error', code: 'hash' }) }
    expect(updateView(s)?.text).toMatch(/no coincide/)
    expect(ids(s)).toEqual(['retry', 'download-manual', 'later'])
    expect(ids({ ...s, installable: false })).toEqual(['download-manual', 'later'])
  })
  it('cancelada vuelve a ofrecer Actualizar; sin versión nueva y sin error no hay nada', () => {
    expect(ids({ ...base, installable: true, install: inst({ phase: 'cancelled' }) })).toEqual(['install', 'later'])
    expect(updateView({ ...base, available: false })).toBeNull()
    expect(updateView(null)).toBeNull()
  })
})
