import { describe, expect, it } from 'vitest'
import { clipPatch, DIFF_MAX_LINES, diffStats, hasDiffChanges, parseUnifiedDiff } from './DiffView'

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

function viaParser(p: string): { additions: number; deletions: number } {
  const lines = parseUnifiedDiff(p)
  return { additions: lines.filter((l) => l.kind === 'add').length, deletions: lines.filter((l) => l.kind === 'del').length }
}

describe('diffStats / hasDiffChanges (conteo sin parsear)', () => {
  const casos: Record<string, string> = {
    vacío: '',
    'solo cabeceras': '--- a/x\n+++ b/x\n',
    simple: bigPatch(10),
    'varios archivos': [
      'diff --git a/a.ts b/a.ts',
      'index 1..2 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      ' ctx',
      '-uno',
      '+dos',
      'diff --git a/b.ts b/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b.ts',
      '@@ -0,0 +1,2 @@ fn()',
      '+a',
      '+b',
      '\\ No newline at end of file'
    ].join('\n'),
    'Index: con CRLF': ['Index: f.ts', '===', '--- f.ts', '+++ f.ts', '@@ -1 +1 @@', '-a', '+b', ''].join('\r\n'),
    'líneas --- dentro del hunk': ['@@ -1,2 +1,1 @@', '--- borrada con guiones', '+++ añadida', ' x'].join('\n'),
    'texto antes del primer hunk': ['+no cuenta', '-no cuenta', '@@ -1 +1 @@', '+sí'].join('\n')
  }
  for (const [nombre, patch] of Object.entries(casos)) {
    it(`coincide con el parser: ${nombre}`, () => {
      expect(diffStats(patch)).toEqual(viaParser(patch))
      const v = viaParser(patch)
      expect(hasDiffChanges(patch)).toBe(v.additions + v.deletions > 0)
    })
  }
  it('50 000 líneas: cifras exactas y rápido', () => {
    const p = bigPatch(50_000)
    const t0 = performance.now()
    expect(diffStats(p)).toEqual({ additions: 25_000, deletions: 25_000 })
    expect(performance.now() - t0).toBeLessThan(100)
  })
})
