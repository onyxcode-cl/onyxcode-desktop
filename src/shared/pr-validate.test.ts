import { describe, expect, it } from 'vitest'
import {
  checkBranchName,
  checkPrBody,
  checkPrTitle,
  isProtectedBranch,
  isValidBranchName,
  isValidRemoteName,
  isValidSlug,
  maskRemoteUrl,
  parsePrRef,
  parseRemoteUrl,
  suggestBranchName
} from './pr-validate'

describe('nombres de rama (lista blanca de caracteres)', () => {
  it.each(['feat/login', 'fix-123', 'release/1.2.3', 'a', 'Mi_rama.v2', 'lazunox/trabajo-20261018'])('acepta %s', (n) => {
    expect(isValidBranchName(n)).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['-f', 'start'],
    ['--force', 'start'],
    ['a b', 'chars'],
    ['a;rm -rf', 'chars'],
    ['a$(x)', 'chars'],
    ['a`b`', 'chars'],
    ['a\nb', 'chars'],
    ['a\0b', 'chars'],
    ['ñandú', 'chars'],
    ['a..b', 'dots'],
    ['a//b', 'slashes'],
    ['a/.b', 'dots'],
    ['.oculta', 'start'],
    ['/abs', 'start'],
    ['fin/', 'ends'],
    ['fin.', 'ends'],
    ['x.lock', 'lock'],
    ['a/b.lock/c', 'lock'],
    ['HEAD', 'reserved'],
    ['@', 'chars'],
    ['a'.repeat(101), 'too-long']
  ])('rechaza %j', (n, problem) => {
    const r = checkBranchName(n)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problem).toBe(problem)
  })

  it('rechaza lo que no es texto', () => {
    expect(isValidBranchName(undefined)).toBe(false)
    expect(isValidBranchName(42)).toBe(false)
    expect(isValidBranchName(null)).toBe(false)
  })
})

describe('nombres de remoto', () => {
  it('acepta nombres normales y rechaza URL, opciones y rutas', () => {
    expect(isValidRemoteName('origin')).toBe(true)
    expect(isValidRemoteName('mi-fork_2')).toBe(true)
    for (const bad of [
      '',
      '-origin',
      'https://github.com/x/y',
      'git@github.com:x/y',
      '../x',
      'a b',
      'a/b',
      '--mirror',
      'a..b',
      'x'.repeat(65)
    ]) {
      expect(isValidRemoteName(bad)).toBe(false)
    }
  })
})

describe('ramas protegidas', () => {
  it('reconoce los nombres habituales sin distinguir mayúsculas', () => {
    for (const n of ['main', 'master', 'develop', 'trunk', 'production', 'Main', 'MASTER', 'release', 'release/1.0', 'releases/2']) {
      expect(isProtectedBranch(n)).toBe(true)
    }
  })
  it('no marca ramas de trabajo', () => {
    for (const n of ['feat/main-menu', 'fix-master-key', 'mi-rama', 'maintenance', 'feat/release-notes']) {
      expect(isProtectedBranch(n)).toBe(false)
    }
  })
  it('suma la rama predeterminada del remoto', () => {
    expect(isProtectedBranch('estable', ['estable'])).toBe(true)
    expect(isProtectedBranch('estable', [null, undefined, 'otra'])).toBe(false)
  })
})

describe('sugerencia de nombre de rama', () => {
  it('convierte texto libre en un nombre válido', () => {
    expect(suggestBranchName('Arreglo del Login: ¡rápido!')).toBe('arreglo-del-login-rapido')
    expect(isValidBranchName(suggestBranchName('Añadir búsqueda en el menú'))).toBe(true)
    expect(suggestBranchName('???')).toBe('trabajo')
    expect(suggestBranchName('x'.repeat(200)).length).toBeLessThanOrEqual(40)
  })
})

describe('título y descripción del PR', () => {
  it('título: una línea sin caracteres de control', () => {
    expect(checkPrTitle('Arreglo del login').ok).toBe(true)
    expect(checkPrTitle('').ok).toBe(false)
    expect(checkPrTitle('   ').ok).toBe(false)
    expect(checkPrTitle('a\nb').ok).toBe(false)
    expect(checkPrTitle('a\0b').ok).toBe(false)
    expect(checkPrTitle('x'.repeat(257)).ok).toBe(false)
  })
  it('descripción: admite saltos de línea y tabulaciones, no nulos', () => {
    expect(checkPrBody('## Qué cambia\n\n- uno\n\t- dos').ok).toBe(true)
    expect(checkPrBody('').ok).toBe(true)
    expect(checkPrBody('a\0b').ok).toBe(false)
    expect(checkPrBody('x'.repeat(60_001)).ok).toBe(false)
    expect(checkPrBody(5).ok).toBe(false)
  })
})

describe('URLs de remoto', () => {
  it('quita usuario y clave', () => {
    expect(maskRemoteUrl('https://usuario:clave@github.com/o/r.git')).toBe('https://github.com/o/r.git')
    expect(maskRemoteUrl('https://ghp_token@github.com/o/r')).toBe('https://github.com/o/r')
    expect(maskRemoteUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
  })
  it('interpreta https, ssh y scp', () => {
    expect(parseRemoteUrl('https://github.com/o/r.git')).toEqual({ host: 'github.com', slug: 'o/r' })
    expect(parseRemoteUrl('https://user:pw@github.com/o/r')).toEqual({ host: 'github.com', slug: 'o/r' })
    expect(parseRemoteUrl('git@github.com:o/r.git')).toEqual({ host: 'github.com', slug: 'o/r' })
    expect(parseRemoteUrl('ssh://git@github.com/o/r.git')).toEqual({ host: 'github.com', slug: 'o/r' })
    expect(parseRemoteUrl('https://gitlab.com/grupo/sub/r.git')).toEqual({ host: 'gitlab.com', slug: null })
    expect(parseRemoteUrl('/tmp/remoto.git')).toBeNull()
  })
  it('valida owner/repo', () => {
    expect(isValidSlug('o/r')).toBe(true)
    expect(isValidSlug('o/r/x')).toBe(false)
    expect(isValidSlug('o/..')).toBe(false)
    expect(isValidSlug('o/r;x')).toBe(false)
    expect(isValidSlug(undefined)).toBe(false)
  })
})

describe('referencia a un PR', () => {
  it('acepta número y enlace de GitHub', () => {
    expect(parsePrRef('42')).toEqual({ ok: true, number: 42, slug: null })
    expect(parsePrRef(' #7 ')).toEqual({ ok: true, number: 7, slug: null })
    expect(parsePrRef('https://github.com/o/r/pull/12')).toEqual({ ok: true, number: 12, slug: 'o/r' })
    expect(parsePrRef('https://github.com/o/r/pull/12/files#diff-1')).toEqual({ ok: true, number: 12, slug: 'o/r' })
  })
  it('rechaza todo lo demás (nada llega a gh sin pasar por aquí)', () => {
    const bad = [
      '',
      '0',
      '-1',
      '12a',
      '--repo x',
      '1; rm -rf /',
      '$(id)',
      'http://github.com/o/r/pull/1',
      'https://github.com/o/r/issues/1',
      'https://github.com.evil.com/o/r/pull/1'
    ]
    for (const b of bad) expect(parsePrRef(b).ok).toBe(false)
    expect(parsePrRef('https://gitlab.com/o/r/pull/1')).toEqual({ ok: false, problem: 'host' })
    expect(parsePrRef(undefined).ok).toBe(false)
  })
})
