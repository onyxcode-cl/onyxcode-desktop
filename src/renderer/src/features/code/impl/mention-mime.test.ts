import { describe, expect, it } from 'vitest'
import { mentionMime } from './mention-mime'

describe('mentionMime', () => {
  it('imágenes y PDF por extensión, sin importar mayúsculas ni carpetas', () => {
    expect(mentionMime('assets/Logo.PNG')).toBe('image/png')
    expect(mentionMime('a/b.c/foto.jpg')).toBe('image/jpeg')
    expect(mentionMime('x.jpeg')).toBe('image/jpeg')
    expect(mentionMime('x.webp')).toBe('image/webp')
    expect(mentionMime('docs/guia.pdf')).toBe('application/pdf')
  })
  it('código, sin extensión y archivos ocultos son texto', () => {
    for (const p of ['src/a.ts', 'Makefile', '.png', 'a.b/README', 'x.svg', 'x.png.txt']) expect(mentionMime(p), p).toBe('text/plain')
  })
})
