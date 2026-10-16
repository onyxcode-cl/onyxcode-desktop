import { describe, expect, it } from 'vitest'
import { engineNotice, engineNoticeText, engineSourceLabel, engineSummary } from './engine-notice'

const base = {
  found: true,
  source: 'settings' as const,
  version: '1.18.32',
  sdkVersion: '1.19.0',
  compatible: false,
  bundledAvailable: true
}

describe('engineNoticeText', () => {
  it('avisa con otra mayor.menor (compatible=false) y nombra ambas versiones', () => {
    expect(engineNoticeText(base)).toBe(
      'Estás usando un motor de IA instalado aparte (versión 1.18.32). Lazunox funciona mejor con el motor incluido (versión 1.19.0).'
    )
    expect(engineNoticeText({ ...base, source: 'cli' })).not.toBeNull()
    expect(engineNoticeText({ ...base, source: 'env', version: '1.17.9' })).toContain('1.17.9')
  })

  it('con una versión más nueva que la probada el texto es otro y tranquilo', () => {
    const t = engineNoticeText({ ...base, version: '1.20.1' })!
    expect(t).toContain('más nuevo que el probado (versión 1.20.1)')
    expect(t).toContain('Suele funcionar bien')
    expect(engineNotice({ ...base, version: '1.20.1' })!.kind).toBe('newer')
    expect(engineNotice({ ...base, version: '2.0.0' })!.kind).toBe('newer')
    expect(engineNotice(base)!.kind).toBe('older')
    expect(engineNotice({ ...base, version: '0.99.9' })!.kind).toBe('older')
  })

  it('solo se puede cambiar si hay motor incluido y ninguna variable de entorno fija el otro', () => {
    expect(engineNotice(base)!.canSwitch).toBe(true)
    expect(engineNotice({ ...base, bundledAvailable: false })!.canSwitch).toBe(false)
    expect(engineNotice({ ...base, source: 'env' })!.canSwitch).toBe(false)
  })

  it('no avisa si es compatible (mismo mayor.menor, aunque el parche difiera)', () => {
    expect(engineNoticeText({ ...base, version: '1.19.4', compatible: true })).toBeNull()
  })

  it('nunca avisa con el motor incluido, sin binario o sin versión conocida', () => {
    expect(engineNoticeText({ ...base, source: 'bundled' })).toBeNull()
    expect(engineNoticeText({ ...base, found: false, source: null, version: null })).toBeNull()
    expect(engineNoticeText({ ...base, version: null })).toBeNull()
    expect(engineNoticeText(null)).toBeNull()
  })

  it('un aviso cerrado no vuelve para esa versión, pero sí para otra', () => {
    expect(engineNoticeText(base, '1.18.32')).toBeNull()
    expect(engineNoticeText(base, '1.18.0')).not.toBeNull()
  })
})

describe('engineSummary / engineSourceLabel', () => {
  it('describe versión y origen', () => {
    expect(engineSummary({ ...base, source: 'bundled', version: '1.18.33', compatible: true })).toBe('OpenCode 1.18.33 (incluido)')
    expect(engineSummary({ ...base, source: 'cli' })).toBe('OpenCode 1.18.32 (tu CLI)')
    expect(engineSummary(base)).toBe('OpenCode 1.18.32 (ruta elegida)')
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
