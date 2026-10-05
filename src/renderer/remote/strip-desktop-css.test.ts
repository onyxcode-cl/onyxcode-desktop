import { describe, expect, it } from 'vitest'
import { stripDesktopCss } from './strip-desktop-css'

describe('stripDesktopCss', () => {
  it('quita las reglas de escritorio (también dentro de @media/@layer) y deja el resto', () => {
    const css =
      '.a{color:red}.desk\\:h-8:where([data-shell=desktop] *){height:2rem}' +
      '@media (hover:hover){.desk\\:hover\\:bg-hover:where([data-shell=desktop] *):hover{background:blue}.b:hover{color:green}}' +
      "@layer utilities{:root[data-shell='desktop'] .x{top:0}}"
    expect(stripDesktopCss(css)).toBe('.a{color:red}@media (hover:hover){.b:hover{color:green}}')
  })

  it('en un selector de lista solo descarta el de escritorio', () => {
    expect(stripDesktopCss(".a,:root[data-shell='desktop'] .b{x:y}")).toBe('.a{x:y}')
  })

  it('un CSS sin data-shell queda byte a byte igual', () => {
    const css = '.a{color:red}@media (min-width:1px){.b{top:0}}@keyframes k{from{opacity:0}to{opacity:1}}'
    expect(stripDesktopCss(css)).toBe(css)
  })
})
