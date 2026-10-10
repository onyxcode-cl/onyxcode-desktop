import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver, isNewerRelease } from '@shared/update-check'
import { pickBetaRelease, releasesListUrl } from './channel'

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://lazunox.onyxcode.cl/o/r/releases/tag/${tag}`,
  draft: false,
  prerelease: tag.includes('-'),
  ...extra
})
const cmp = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!)

describe('canal beta: semver con prerelease', () => {
  it('orden: beta.1 < beta.2 < beta.10 < estable < siguiente beta', () => {
    expect(cmp('0.4.0-beta.1', '0.4.0-beta.2')).toBe(-1)
    expect(cmp('0.4.0-beta.2', '0.4.0-beta.10')).toBe(-1)
    expect(cmp('0.4.0-beta.10', '0.4.0')).toBe(-1)
    expect(cmp('0.4.0', '0.4.1-beta.1')).toBe(-1)
    expect(cmp('0.4.0-alpha.1', '0.4.0-beta.1')).toBe(-1)
  })
  it('el estable sigue sin ofrecer prereleases a quien tiene una estable', () => {
    expect(isNewerRelease({ tag: 'v0.4.0-beta.1', prerelease: true, draft: false }, '0.3.0')).toBe(false)
  })
})

describe('canal beta: pickBetaRelease', () => {
  it('URL de la lista: per_page=10 sobre el repositorio', () => {
    expect(releasesListUrl('o/r')).toBe('https://lazunox.onyxcode.cl/repos/o/r/releases?per_page=10')
    expect(releasesListUrl('o/r', 'http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/repos/o/r/releases?per_page=10')
  })
  it('elige la semver mayor aunque sea prerelease y aunque no vaya primero', () => {
    const list = [rel('v0.4.0'), rel('v0.5.0-beta.2'), rel('v0.5.0-beta.10'), rel('v0.5.0-beta.3')]
    expect(pickBetaRelease(list, '0.3.0')?.tag).toBe('v0.5.0-beta.10')
    expect(pickBetaRelease(list, '0.3.0')?.prerelease).toBe(true)
  })
  it('una estable posterior gana a la beta de la misma versión', () => {
    expect(pickBetaRelease([rel('v0.5.0-beta.2'), rel('v0.5.0')], '0.4.0')?.tag).toBe('v0.5.0')
  })
  it('desde una beta, solo ofrece algo mayor (no baja a la estable anterior)', () => {
    expect(pickBetaRelease([rel('v0.4.0'), rel('v0.5.0-beta.1')], '0.5.0-beta.1')).toBeNull()
    expect(pickBetaRelease([rel('v0.5.0-beta.2')], '0.5.0-beta.1')?.tag).toBe('v0.5.0-beta.2')
  })
  it('ignora borradores, tags raros y entradas inválidas; null si no hay nada mayor o la respuesta no es una lista', () => {
    expect(pickBetaRelease([rel('v0.9.0', { draft: true }), { nada: 1 }, rel('nightly'), null, rel('v0.2.0')], '0.3.0')).toBeNull()
    expect(pickBetaRelease({ message: 'x' }, '0.3.0')).toBeNull()
    expect(pickBetaRelease([rel('v0.4.0')], 'raro')).toBeNull()
  })
  it('solo mira las 10 primeras', () => {
    const list = Array.from({ length: 10 }, (_, i) => rel(`v0.1.${i}`))
    list.push(rel('v9.0.0'))
    expect(pickBetaRelease(list, '0.3.0')).toBeNull()
  })
})
