import { describe, expect, it } from 'vitest'
import { isSingleFileDiff, splitDiffHunks } from './diff-hunks'

const P =
  'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10 +10 @@\n-j\n+J\n\\ No newline at end of file\n'

describe('splitDiffHunks', () => {
  it('separa cabecera y bloques conservando el texto exacto', () => {
    const s = splitDiffHunks(P)
    expect(s.header).toBe('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n')
    expect(s.hunks).toEqual(['@@ -1,2 +1,2 @@\n a\n-b\n+B\n', '@@ -10 +10 @@\n-j\n+J\n\\ No newline at end of file\n'])
    expect(s.header + s.hunks.join('')).toBe(P)
  })
  it('sin bloques (binario o vacío)', () => {
    expect(splitDiffHunks('').hunks).toEqual([])
    expect(splitDiffHunks('diff --git a/x b/x\nBinary files differ\n').hunks).toEqual([])
  })
  it('isSingleFileDiff', () => {
    expect(isSingleFileDiff(P)).toBe(true)
    expect(isSingleFileDiff(P + P)).toBe(false)
    expect(isSingleFileDiff('')).toBe(false)
  })
})
