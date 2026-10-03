import { describe, expect, it } from 'vitest'
import { baseOf, createParent, dirsToReload, isProtectedPath, isUnder, joinPath, parentOf, stemLength } from './files-logic'

describe('files-logic', () => {
  it('parentOf / baseOf / joinPath', () => {
    expect(parentOf('a.txt')).toBe('.')
    expect(parentOf('src/app/x.ts')).toBe('src/app')
    expect(baseOf('src/app/x.ts')).toBe('x.ts')
    expect(baseOf('x')).toBe('x')
    expect(joinPath('.', 'a')).toBe('a')
    expect(joinPath('src', 'a')).toBe('src/a')
  })
  it('isProtectedPath', () => {
    expect(isProtectedPath('.git')).toBe(true)
    expect(isProtectedPath('sub/.GIT/config')).toBe(true)
    expect(isProtectedPath('.gitignore')).toBe(false)
  })
  it('dirsToReload: solo las abiertas afectadas; null = todas', () => {
    const open = new Set(['.', 'src', 'docs'])
    expect(dirsToReload(['src', 'otra'], open)).toEqual(['src'])
    expect(dirsToReload(['.'], open)).toEqual(['.'])
    expect(dirsToReload(null, open).sort()).toEqual(['.', 'docs', 'src'])
    expect(dirsToReload([], open)).toEqual([])
  })
  it('isUnder', () => {
    expect(isUnder('src/a', 'src')).toBe(true)
    expect(isUnder('src', 'src')).toBe(true)
    expect(isUnder('srcx/a', 'src')).toBe(false)
  })
  it('stemLength', () => {
    expect(stemLength('a.txt')).toBe(1)
    expect(stemLength('.env')).toBe(4)
    expect(stemLength('a.b.c')).toBe(3)
    expect(stemLength('README')).toBe(6)
  })
  it('createParent', () => {
    expect(createParent(null)).toBe('.')
    expect(createParent({ path: 'src', isDir: true })).toBe('src')
    expect(createParent({ path: 'src/a.ts', isDir: false })).toBe('src')
    expect(createParent({ path: 'a.ts', isDir: false })).toBe('.')
  })
})
