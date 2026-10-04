import { describe, expect, it } from 'vitest'
import { syncThemeColor, type ThemeDoc } from './theme-sync'

const meta = () => {
  const attrs: Record<string, string> = { media: '(prefers-color-scheme: dark)', content: '#000' }
  return {
    attrs,
    setAttribute: (n: string, v: string) => void (attrs[n] = v),
    removeAttribute: (n: string) => void delete attrs[n]
  }
}
const mkDoc = (theme: string | undefined, metas: ReturnType<typeof meta>[]): ThemeDoc => ({
  documentElement: { dataset: { theme } },
  querySelectorAll: () => metas
})

describe('syncThemeColor', () => {
  it('escribe el fondo en todos los theme-color, sin media, y recuerda el tema', () => {
    const metas = [meta(), meta()]
    const saved: Record<string, string> = {}
    const ok = syncThemeColor(mkDoc('dark', metas), () => ' #11131a ', { setItem: (k, v) => void (saved[k] = v) })
    expect(ok).toBe(true)
    for (const m of metas) expect(m.attrs).toEqual({ content: '#11131a' })
    expect(saved).toEqual({ 'onyx.theme': 'dark' })
  })
  it('sin tema resuelto no toca nada', () => {
    const metas = [meta()]
    expect(syncThemeColor(mkDoc(undefined, metas), () => '#fff')).toBe(false)
    expect(metas[0].attrs.media).toBeDefined()
  })
  it('sin valor de --bg deja las metas como estaban', () => {
    const metas = [meta()]
    syncThemeColor(mkDoc('light', metas), () => '  ')
    expect(metas[0].attrs.content).toBe('#000')
  })
})
