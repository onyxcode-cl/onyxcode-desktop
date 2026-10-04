import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostCss } from '@shared/remote/host-css'

/**
 * Los tokens de la capa ligera (`pwa/src/style.css`) están copiados a mano de `globals.css` y de `mobile-tokens.css`: esta
 * prueba impide que se desvíen (claro, oscuro y medidas móviles) y que el CSS ligero deje de traducirse bien al shadow root.
 */
const ROOT = resolve(__dirname, '../../..')
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')
const pwa = read('pwa/src/style.css')
const globals = read('src/renderer/src/app/globals.css')
const mobile = read('src/renderer/src/app/mobile/mobile-tokens.css')

/** Declaraciones `--x: valor;` del bloque que empieza por `head`. */
function decls(css: string, head: string): Record<string, string> {
  const i = css.indexOf(head)
  expect(i, `no se encontró «${head}»`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const SHARED = [
  'bg',
  'bg-sidebar',
  'bg-elevated',
  'bg-hover',
  'bg-active',
  'bg-code',
  'bg-inset',
  'fg',
  'fg-muted',
  'fg-subtle',
  'border',
  'border-strong',
  'accent',
  'accent-hover',
  'accent-fg',
  'accent-soft',
  'accent-ring',
  'gold-text',
  'success',
  'warning',
  'danger',
  'danger-fg',
  'user-bubble',
  'selection',
  'scrollbar',
  'shadow-color'
].map((k) => `--${k}`)

describe('paridad de tokens PWA ligera y escritorio', () => {
  it('tema claro', () => {
    const a = decls(pwa, ":root,\n:root[data-theme='light'] {")
    const b = decls(globals, ":root,\n[data-theme='light'] {")
    for (const k of SHARED) expect(a[k], k).toBe(b[k])
  })
  it('tema oscuro (explícito y por preferencia del sistema)', () => {
    const b = decls(globals, "[data-theme='dark'] {")
    const explicit = decls(pwa, ":root[data-theme='dark'] {")
    const system = decls(pwa, '  :root:not([data-theme]) {')
    for (const k of SHARED) {
      expect(explicit[k], k).toBe(b[k])
      expect(system[k], k).toBe(b[k])
    }
  })
  it('medidas móviles compartidas', () => {
    const a = decls(pwa, '\n:root {\n  --radius-sm')
    const b = decls(mobile, "[data-surface='mobile'] {")
    for (const k of [
      '--m-row',
      '--m-row-compact',
      '--m-bar',
      '--m-tab',
      '--m-gutter',
      '--m-radius-card',
      '--m-radius-sheet',
      '--m-backdrop',
      '--dur-screen'
    ])
      expect(a[k], k).toBe(b[k])
  })
})

describe('hostCss (shadow root)', () => {
  it('traduce :root y los selectores con atributo a la forma válida de :host', () => {
    const out = hostCss(pwa)
    expect(out).not.toContain(':root')
    expect(out).toContain(":host([data-theme='dark'])")
    expect(out).toContain(":host,\n:host([data-theme='light'])")
    expect(out).toContain(':host(:not([data-theme]))')
    expect(out).not.toMatch(/:host\[/)
  })
})
