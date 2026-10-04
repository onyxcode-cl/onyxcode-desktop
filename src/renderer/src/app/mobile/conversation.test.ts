import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'conversation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('conversation.css', () => {
  it('todos sus selectores cuelgan de [data-surface=mobile] (el escritorio no cambia)', () => {
    const heads = [...css.matchAll(/([^{}]+)\{/g)].map((x) => x[1].replace(/:is\([^)]*\)/g, ':is()').trim())
    const bad = heads.flatMap((h) => h.split(',').map((s) => s.trim())).filter((s) => !s.startsWith("[data-surface='mobile']"))
    expect(bad).toEqual([])
  })
  it('fija la tipografía del plan: 16/1.6 en la respuesta, 14 en metadatos y 13 en código', () => {
    expect(css).toMatch(/\.markdown \{[^}]*font-size: var\(--m-body\)[^}]*line-height: var\(--m-body-lh\)/)
    expect(css).toMatch(/\[data-m='meta'\] \{\s*font-size: var\(--m-meta\)/)
    expect(css).toMatch(/\.markdown pre \{[^}]*font-size: var\(--m-mono\)[^}]*overscroll-behavior-x: contain/)
  })
})
