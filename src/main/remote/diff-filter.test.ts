import { describe, expect, it } from 'vitest'
import { dropSensitiveEntries, filterRawDiff, scrubDiffLists } from './diff-filter'

const D = '/p'

describe('filterRawDiff', () => {
  it('quita bloques sensibles, también con renombrado o con espacios, y conserva el resto', () => {
    const t = [
      'diff --git a/ok.ts b/ok.ts',
      '+bien',
      'diff --git a/x.txt b/.env',
      'similarity index 90%',
      'rename from x.txt',
      'rename to .env',
      '+SECRETO',
      'diff --git a/mi .env b/mi .env',
      '+SECRETO2',
      'diff --cc .envrc',
      '+SECRETO3',
      'diff algo raro',
      '+SECRETO4',
      ''
    ].join('\n')
    const out = filterRawDiff(t, D)
    expect(out).toContain('+bien')
    expect(out).not.toContain('SECRETO')
  })
})

describe('dropSensitiveEntries / scrubDiffLists', () => {
  it('filtra por file o path y recorre summary.diffs', () => {
    expect(dropSensitiveEntries([{ file: '.env' }, { path: 'a.ts' }, 'x'], D)).toEqual([{ path: 'a.ts' }, 'x'])
    const ev = { info: { summary: { diffs: [{ file: 'id_rsa', patch: 'K' }, { file: 'a.ts', patch: 'ok' }] } }, diff: [{ file: '.env' }] }
    expect(scrubDiffLists(ev, D)).toEqual({ info: { summary: { diffs: [{ file: 'a.ts', patch: 'ok' }] } }, diff: [] })
  })
})
