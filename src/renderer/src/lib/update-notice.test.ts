import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@shared/update-check'
import { IDLE_INSTALL } from '@shared/update-install'
import { checkResultText, downloadUrl, lastCheckText, updateNoticeText } from './update-notice'

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
