import { describe, expect, it } from 'vitest'
import { SUGGESTION_REASON_MAX, cleanSuggestionReason, readPermissionSuggestion, type SuggestionRequest } from './permission-suggestion'

const md = (s: unknown, extra: Record<string, unknown> = {}) => ({ lazunoxSugerencia: s, ...extra })
const SUG = { sugerencia: 'permitir', motivo: 'ok' }
const req = (metadata: unknown, over: Partial<SuggestionRequest> = {}): SuggestionRequest => ({
  permission: 'bash',
  patterns: ['ls'],
  metadata,
  api: 'v1',
  ...over
})

describe('readPermissionSuggestion', () => {
  it('lee una sugerencia válida', () => {
    for (const v of ['permitir', 'negar', 'preguntar'] as const) {
      expect(readPermissionSuggestion(req(md({ sugerencia: v, motivo: 'Es una lectura.' })))).toEqual({
        value: v,
        reason: 'Es una lectura.'
      })
    }
  })
  it('sin sugerencia o con metadata rara, nada', () => {
    for (const m of [undefined, null, 'x', 3, [], {}, md(null), md('permitir'), md([]), md(7)])
      expect(readPermissionSuggestion(req(m))).toBeNull()
  })
  it('valor fuera de la lista, otra capitalización o sin motivo: nada', () => {
    for (const s of [
      { sugerencia: 'allow', motivo: 'x' },
      { sugerencia: 'Permitir', motivo: 'x' },
      { sugerencia: 'permitir' },
      { sugerencia: 'permitir', motivo: 5 },
      { sugerencia: 'permitir', motivo: '   ' }
    ]) {
      expect(readPermissionSuggestion(req(md(s)))).toBeNull()
    }
  })
  it('ruta protegida del motor o ayudante: no se muestra', () => {
    expect(readPermissionSuggestion(req(md(SUG)), { protectedPath: true })).toBeNull()
    expect(readPermissionSuggestion(req(md(SUG)), { isChild: true })).toBeNull()
  })
  it('canal v2: no se muestra', () => {
    expect(readPermissionSuggestion(req(md(SUG), { api: 'v2' }))).toBeNull()
  })
  it('edit/write de configuración que se ejecuta o de git: no se muestra (aunque el motor no la marque)', () => {
    for (const permission of ['edit', 'write']) {
      for (const p of [
        'opencode.json',
        'opencode.jsonc',
        '/proj/opencode.json',
        '/proj/sub/opencode.jsonc',
        '.opencode/plugin/x.ts',
        '/proj/.opencode/tool/a.js',
        '.git/config',
        '/proj/.git/hooks/pre-commit',
        '.gitattributes',
        '/proj/.gitmodules',
        'C:' + String.fromCharCode(92) + 'proj' + String.fromCharCode(92) + 'OpenCode.json'
      ]) {
        expect(readPermissionSuggestion(req(md(SUG), { permission, patterns: [p] }))).toBeNull()
        expect(readPermissionSuggestion(req(md(SUG, { filepath: p }), { permission, patterns: ['x'] }))).toBeNull()
      }
    }
  })
  it('edit normal en el proyecto: sí se muestra', () => {
    expect(
      readPermissionSuggestion(req(md(SUG, { filepath: '/proj/src/a.ts' }), { permission: 'edit', patterns: ['src/a.ts'] }))
    ).not.toBeNull()
    expect(readPermissionSuggestion(req(md(SUG), { permission: 'edit', patterns: ['.gitignore'] }))).not.toBeNull()
  })
  it('lectura de .env: no se muestra', () => {
    for (const p of ['.env', 'a/.env', '/proj/.env.local', 'prod.env'])
      expect(readPermissionSuggestion(req(md(SUG), { permission: 'read', patterns: [p] }))).toBeNull()
    expect(readPermissionSuggestion(req(md(SUG), { permission: 'read', patterns: ['mcp:srv:*'] }))).toBeNull()
  })
  it('external_directory, conectores MCP y otras acciones: no se muestra', () => {
    for (const permission of ['external_directory', 'miconector_herramienta', 'task', 'documentos_crear', 'doom_loop']) {
      expect(readPermissionSuggestion(req(md(SUG), { permission, patterns: ['/x'] }))).toBeNull()
    }
  })
  it('bash, webfetch y websearch: sí se muestra', () => {
    for (const permission of ['bash', 'webfetch', 'websearch'])
      expect(readPermissionSuggestion(req(md(SUG), { permission }))).not.toBeNull()
  })
})

describe('cleanSuggestionReason', () => {
  it('quita etiquetas, enlaces y Markdown', () => {
    const r = cleanSuggestionReason('Mira <a href="http://evil.test">aquí</a> **ya** [clic](https://x.io) y www.mal.com `rm`')
    expect(r).not.toMatch(/[<>*`\[\]()]|:\/\/|www\./)
    expect(r).toContain('aquí')
  })
  it('un enlace partido con ()[] o con invisibles no se vuelve a juntar', () => {
    for (const t of [
      'ht(tp)s://evil.test/x',
      'ht[tp]://evil.test',
      'ww(w).evil.test',
      'https\u200b://evil.test',
      'https：//evil.test',
      'ｈｔｔｐｓ：／／evil.test'
    ]) {
      expect(cleanSuggestionReason('ve a ' + t + ' ya')).not.toMatch(/:\/\/|www\.|evil/i)
    }
  })
  it('quita control, ANSI y marcas de dirección', () => {
    expect(cleanSuggestionReason('a\u0000b\u001b[31mc\u202ed\u2066e\u200bf\nline')).toBe('a bcdef line')
  })
  it('quita invisibles menos comunes: U+061C, etiquetas, variación, rellenos Hangul, U+180E, U+FFF9', () => {
    const r = cleanSuggestionReason('a\u061cb\u{E0041}c\ufe0fd\u3164e\u115ff\u180eg\ufff9h\u034fi\u00adj')
    expect(r).toBe('abcdefghij')
  })
  it('limita a 200 puntos de código sin partir un emoji', () => {
    expect(cleanSuggestionReason('a'.repeat(500)).length).toBe(SUGGESTION_REASON_MAX)
    const e = cleanSuggestionReason('😀'.repeat(300))
    expect(Array.from(e).length).toBe(SUGGESTION_REASON_MAX)
    expect(e).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })
  it('no texto = vacío', () => {
    expect(cleanSuggestionReason(undefined)).toBe('')
  })
})
