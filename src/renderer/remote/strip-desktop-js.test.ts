import { describe, expect, it } from 'vitest'
import { stripDesktopJs } from './strip-desktop-js'

describe('stripDesktopJs', () => {
  it('quita las fichas desk: de cadenas de clases', () => {
    expect(stripDesktopJs('a="flex desk:h-7 gap-2 desk:py-0"')).toBe('a="flex gap-2"')
    expect(stripDesktopJs('a="desk:h-7 flex"')).toBe('a="flex"')
    expect(stripDesktopJs('a="desk:@[34rem]:flex-row"')).toBe('a=""')
    expect(stripDesktopJs('a=`x ${b} desk:p-1`')).toBe('a=`x ${b}`')
  })
  it('no toca claves de objeto ni otro texto', () => {
    expect(stripDesktopJs('x={desk:1,y:2}')).toBe('x={desk:1,y:2}')
    expect(stripDesktopJs('a="flex gap-2"')).toBe('a="flex gap-2"')
  })
})
