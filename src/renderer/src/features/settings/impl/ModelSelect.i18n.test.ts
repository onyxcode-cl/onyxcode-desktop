import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * El orden de los modelos va en un useMemo: si usara el idioma global (`localeTag()`) en vez del reactivo
 * (`useLocale()` en las dependencias), no se recalcularía al cambiar de idioma en vivo. El render estático
 * no puede reflejar el cambio (el store usa su estado inicial), así que se vigila el código.
 */
describe('ModelSelect y el idioma', () => {
  const src = readFileSync(resolve(__dirname, 'ModelSelect.tsx'), 'utf8')
  it('recalcula con el idioma reactivo', () => {
    expect(src).toContain('useLocale()')
    expect(src).not.toMatch(/localeTag\(/)
    expect(src).toMatch(/\[sorted, query, current, locale\]/)
  })
})
