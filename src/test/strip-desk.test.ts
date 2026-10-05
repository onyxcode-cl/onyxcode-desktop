import { describe, expect, it } from 'vitest'
import { stripDesk } from './strip-desk'

describe('stripDesk', () => {
  it('quita solo las clases desk: (con sus variantes y valores arbitrarios)', () => {
    expect(stripDesk('<div class="a desk:h-8 b desk:hover:bg-hover desk:shadow-[0_1px_2px_#000] c">x</div>')).toBe(
      '<div class="a b c">x</div>'
    )
    expect(stripDesk('<i class="a desk:text-ui"></i>')).toBe('<i class="a"></i>')
  })

  it('no toca otras clases ni el texto con «desk:» suelto', () => {
    const html = '<p class="desktop-x hover:bg-hover group-hover:flex">desk: texto</p>'
    expect(stripDesk(html)).toBe(html)
  })

  it('marcado sin desk: queda idéntico', () => {
    const html = '<button type="button" class="rounded-lg px-3 py-1.5 text-sm">Aceptar</button>'
    expect(stripDesk(html)).toBe(html)
  })
})
