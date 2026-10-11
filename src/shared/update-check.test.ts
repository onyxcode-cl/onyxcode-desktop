import { describe, expect, it } from 'vitest'
import {
  CHECK_INTERVAL_MS,
  compareSemver,
  isNewerRelease,
  isValidRepo,
  nextCheckDue,
  parseReleaseJson,
  parseRetryAfter,
  parseSemver,
  releasesApiUrl,
  safeReleaseUrl
} from './update-check'

const rel = (tag: string, o: { prerelease?: boolean; draft?: boolean } = {}) => ({
  tag,
  prerelease: false,
  draft: false,
  ...o
})
const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })

describe('semver', () => {
  it('quita la v inicial', () => {
    expect(parseSemver('v1.2.3')).toEqual(parseSemver('1.2.3'))
    expect(parseSemver('V1.2.3')).not.toBeNull()
  })
  it('rechaza basura', () => {
    for (const t of ['', 'latest', '1.2', '1.2.3.4', 'v', '1.2.x', '../../1.2.3', '1.2.3 ', 'vv1.2.3']) expect(parseSemver(t), t).toBeNull()
  })
  it('precedencia', () => {
    const c = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!)
    expect(c('1.10.0', '1.9.9')).toBe(1)
    expect(c('1.0.0-beta.2', '1.0.0')).toBe(-1)
    expect(c('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(c('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1)
    expect(c('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1)
    expect(c('1.0.0+build', '1.0.0')).toBe(0)
  })
})

describe('isNewerRelease', () => {
  it('misma versión no avisa', () => expect(isNewerRelease(rel('v1.2.3'), '1.2.3')).toBe(false))
  it('mayor avisa', () => {
    expect(isNewerRelease(rel('v1.10.0'), '1.9.9')).toBe(true)
    expect(isNewerRelease(rel('v0.3.1'), '0.3.0')).toBe(true)
  })
  it('menor no avisa', () => expect(isNewerRelease(rel('v0.2.0'), '0.3.0')).toBe(false))
  it('prerelease anterior a la estable', () => expect(isNewerRelease(rel('1.0.0-beta.2'), '1.0.0')).toBe(false))
  it('prerelease ignorada si la actual es estable', () => {
    expect(isNewerRelease(rel('v2.0.0', { prerelease: true }), '1.0.0')).toBe(false)
    expect(isNewerRelease(rel('v2.0.0-rc.1'), '1.0.0')).toBe(false)
  })
  it('prerelease sí si la actual es prerelease', () =>
    expect(isNewerRelease(rel('v1.0.0-beta.2', { prerelease: true }), '1.0.0-beta.1')).toBe(true))
  it('draft y tags basura', () => {
    expect(isNewerRelease(rel('v9.0.0', { draft: true }), '1.0.0')).toBe(false)
    expect(isNewerRelease(rel('nightly'), '1.0.0')).toBe(false)
    expect(isNewerRelease(rel('v9.0.0'), 'dev')).toBe(false)
  })
})

describe('repo y URLs', () => {
  it('isValidRepo', () => {
    expect(isValidRepo('owner/repo')).toBe(true)
    expect(isValidRepo('o-w/re.po_1')).toBe(true)
    for (const r of ['', 'owner', 'owner/', '/repo', 'a/b/c', 'a/..', 'a/.', 'a b/c', 'a/b?x', 'a_b/c', `${'a'.repeat(40)}/r`])
      expect(isValidRepo(r), r).toBe(false)
    expect(isValidRepo(undefined)).toBe(false)
  })
  it('releasesApiUrl', () => {
    expect(releasesApiUrl('o/r')).toBe('https://api.github.com/repos/o/r/releases/latest')
    expect(releasesApiUrl('o/r', 'http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/repos/o/r/releases/latest')
  })
  const fb = 'https://github.com/o/r/releases/tag/v1.0.0'
  it('acepta la URL legítima', () => {
    const u = 'https://github.com/o/r/releases/tag/v1.0.0'
    expect(safeReleaseUrl(u, 'o/r', 'v1.0.0')).toBe(u)
    expect(safeReleaseUrl('https://github.com/O/R/releases/tag/v1.0.0', 'o/r', 'v1.0.0')).toContain('github.com')
  })
  it('rechaza ataques', () => {
    for (const bad of [
      'https://github.com.evil.com/o/r/releases/tag/v1',
      'http://github.com/o/r/releases/tag/v1',
      'https://evil@github.com/o/r/releases/tag/v1',
      'https://user:pw@github.com/o/r/releases/tag/v1',
      'https://github.com/other/r/releases/tag/v1',
      'https://github.com/o/r2/releases/tag/v1',
      'https://github.com/o/r/issues/1',
      'https://github.com:443/o/r/releases/tag/v1',
      'https://github.com:8443/o/r/releases/tag/v1',
      'https://evil.example/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'no es url',
      null,
      42
    ])
      expect(safeReleaseUrl(bad, 'o/r', 'v1.0.0'), String(bad)).toBe(fb)
  })
  it('codifica el tag en la URL de reserva', () =>
    expect(safeReleaseUrl(null, 'o/r', 'v1/../x')).toBe('https://github.com/o/r/releases/tag/v1%2F..%2Fx'))
})

describe('nextCheckDue', () => {
  const now = 1_000_000_000_000
  it('primera vez', () => expect(nextCheckDue({ now, lastCheck: null, retryAfter: null, manual: false })).toBe(true))
  it('menos de 24 h no', () => {
    expect(nextCheckDue({ now, lastCheck: now - CHECK_INTERVAL_MS + 1, retryAfter: null, manual: false })).toBe(false)
    expect(nextCheckDue({ now, lastCheck: now - CHECK_INTERVAL_MS, retryAfter: null, manual: false })).toBe(true)
  })
  it('manual ignora las 24 h', () => expect(nextCheckDue({ now, lastCheck: now - 1000, retryAfter: null, manual: true })).toBe(true))
  it('retryAfter futuro espera incluso en manual', () => {
    expect(nextCheckDue({ now, lastCheck: null, retryAfter: now + 1, manual: true })).toBe(false)
    expect(nextCheckDue({ now, lastCheck: null, retryAfter: now, manual: true })).toBe(true)
  })
  it('reloj atrasado toca comprobar', () =>
    expect(nextCheckDue({ now, lastCheck: now + 5000, retryAfter: null, manual: false })).toBe(true))
})

describe('parseRetryAfter', () => {
  const now = 1_000_000_000_000
  it('retry-after en segundos, con mínimo 1 h', () => {
    expect(parseRetryAfter(h({ 'retry-after': '7200' }), now)).toBe(now + 7_200_000)
    expect(parseRetryAfter(h({ 'retry-after': '60' }), now)).toBe(now + 3_600_000)
  })
  it('máximo 24 h', () => expect(parseRetryAfter(h({ 'retry-after': '999999999' }), now)).toBe(now + CHECK_INTERVAL_MS))
  it('x-ratelimit-reset en epoch segundos', () =>
    expect(parseRetryAfter(h({ 'x-ratelimit-reset': String((now + 10_800_000) / 1000) }), now)).toBe(now + 10_800_000))
  it('sin cabeceras: 1 h', () => expect(parseRetryAfter(h({}), now)).toBe(now + 3_600_000))
})

describe('parseReleaseJson', () => {
  it('solo toma los campos necesarios', () => {
    expect(parseReleaseJson({ tag_name: 'v1.0.0', html_url: 'https://x', draft: false, prerelease: true, body: 'x', evil: 1 })).toEqual({
      tag: 'v1.0.0',
      url: 'https://x',
      draft: false,
      prerelease: true
    })
  })
  it('descarta formas inválidas', () => {
    for (const v of [null, 'x', 1, [], {}, { tag_name: 5 }, { tag_name: '' }, { tag_name: 'v'.repeat(200) }])
      expect(parseReleaseJson(v)).toBeNull()
  })
})
