import { describe, expect, it } from 'vitest'
import { fileLook } from './FileTypeIcon'

describe('fileLook', () => {
  it('da un color distinto a cada tipo de archivo conocido', () => {
    const colors = new Set(['a.ts', 'a.js', 'a.json', 'a.png', 'a.sh', 'a.py', 'a.yml', 'a.css'].map((n) => fileLook(n).color))
    expect(colors.size).toBeGreaterThanOrEqual(7)
  })
  it('reconoce nombres especiales por encima de la extensión', () => {
    expect(fileLook('package.json').color).not.toBe(fileLook('otro.json').color)
    expect(fileLook('.gitignore').color).toBe('text-orange-500')
    expect(fileLook('eslint.config.mjs').color).toBe('text-violet-500')
    expect(fileLook('CLAUDE.md').color).toBe('text-orange-500')
  })
  it('un tipo desconocido queda gris', () => {
    expect(fileLook('archivo.xyz').color).toBe('text-subtle')
    expect(fileLook('Makefile').color).toBe('text-subtle')
  })
})
