import { describe, expect, it } from 'vitest'
import { engineNoticeText, engineSourceLabel, engineSummary } from './engine-notice'

const base = { found: true, source: 'cli' as const, version: '1.19.0', sdkVersion: '1.18.32', compatible: false }

describe('engineNoticeText', () => {
  it('avisa con otra mayor.menor (compatible=false) y nombra ambas versiones', () => {
    expect(engineNoticeText(base)).toBe(
      'Estás usando OpenCode 1.19.0; OnyxCode se probó con 1.18.32. Si algo falla, usa el motor incluido.'
    )
    expect(engineNoticeText({ ...base, source: 'settings' })).not.toBeNull()
    expect(engineNoticeText({ ...base, source: 'env', version: '1.17.9' })).toContain('1.17.9')
  })

  it('no avisa si es compatible (mismo mayor.menor, aunque el parche difiera)', () => {
    expect(engineNoticeText({ ...base, version: '1.18.40', compatible: true })).toBeNull()
  })

  it('nunca avisa con el motor incluido, sin binario o sin versión conocida', () => {
    expect(engineNoticeText({ ...base, source: 'bundled' })).toBeNull()
    expect(engineNoticeText({ ...base, found: false, source: null, version: null })).toBeNull()
    expect(engineNoticeText({ ...base, version: null })).toBeNull()
    expect(engineNoticeText(null)).toBeNull()
  })

  it('un aviso cerrado no vuelve para esa versión, pero sí para otra', () => {
    expect(engineNoticeText(base, '1.19.0')).toBeNull()
    expect(engineNoticeText(base, '1.18.0')).not.toBeNull()
  })
})

describe('engineSummary / engineSourceLabel', () => {
  it('describe versión y origen', () => {
    expect(engineSummary({ ...base, source: 'bundled', version: '1.18.33', compatible: true })).toBe('OpenCode 1.18.33 (incluido)')
    expect(engineSummary(base)).toBe('OpenCode 1.19.0 (tu CLI)')
    expect(engineSummary({ ...base, source: 'settings' })).toBe('OpenCode 1.19.0 (ruta elegida)')
    expect(engineSummary({ ...base, source: 'env', version: null })).toBe('OpenCode (ruta elegida)')
    expect(engineSummary({ ...base, found: false, source: null })).toBeNull()
    expect(engineSummary(null)).toBeNull()
  })

  it('etiquetas por origen', () => {
    expect(engineSourceLabel('bundled')).toBe('incluido')
    expect(engineSourceLabel('cli')).toBe('tu CLI')
    expect(engineSourceLabel('env')).toBe('ruta elegida')
    expect(engineSourceLabel(null)).toBeNull()
  })
})
