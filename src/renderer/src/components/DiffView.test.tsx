import { describe, expect, it } from 'vitest'
import { clipPatch, DIFF_MAX_LINES, parseUnifiedDiff } from './DiffView'

function bigPatch(n: number): string {
  const rows = ['--- a/x.ts', '+++ b/x.ts', `@@ -1,${n} +1,${n} @@`]
  for (let i = 0; i < n; i++) rows.push(i % 2 ? `+const a${i} = ${i}` : `-const b${i} = ${i}`)
  return rows.join('\n')
}

describe('clipPatch', () => {
  it('no recorta un diff pequeño', () => {
    const p = bigPatch(50)
    expect(clipPatch(p)).toMatchObject({ text: p, clipped: false })
  })
  it('recorta por líneas en límite de línea', () => {
    const p = bigPatch(50_000)
    const c = clipPatch(p)
    expect(c.clipped).toBe(true)
    expect(c.total).toBe(50_003)
    expect(c.shown).toBe(DIFF_MAX_LINES)
    expect(parseUnifiedDiff(c.text).length).toBeLessThanOrEqual(DIFF_MAX_LINES)
  })
  it('recorta por tamaño aunque pocas líneas', () => {
    const p = ['@@ -1,2 +1,2 @@', '+' + 'x'.repeat(400_000), '+fin'].join('\n')
    const c = clipPatch(p)
    expect(c.clipped).toBe(true)
    expect(c.text.length).toBeLessThan(p.length)
  })
})
