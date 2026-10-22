import { describe, expect, it } from 'vitest'
import {
  CODE_INTERNAL_MCP,
  isInternalCodeMcp,
  mcpPermissionRulesForCode,
  mcpServerPermissionKey,
  normalizeCodeTrustedMcp,
  sanitizeMcpName,
  withCodeTrust
} from './mcp-permissions'

describe('normalizeCodeTrustedMcp', () => {
  it('nunca lanza y devuelve [] ante basura', () => {
    for (const v of [undefined, null, 5, 'a', {}, [[]], () => 1]) expect(() => normalizeCodeTrustedMcp(v)).not.toThrow()
    expect(normalizeCodeTrustedMcp(undefined)).toEqual([])
    expect(normalizeCodeTrustedMcp('gmail')).toEqual([])
  })
  it('descarta no textos, nombres inválidos, duplicados e internos', () => {
    expect(normalizeCodeTrustedMcp(['gmail', 3, 'gmail', 'a b', '', 'browser', 'crm-1', null, 'x'.repeat(65)])).toEqual(['gmail', 'crm-1'])
  })
  it('pone tope a la lista', () => {
    const many = Array.from({ length: 500 }, (_, i) => `s${i}`)
    expect(normalizeCodeTrustedMcp(many)).toHaveLength(200)
  })
})

describe('withCodeTrust', () => {
  it('marca y desmarca sin duplicar ni mutar', () => {
    const base = ['a']
    expect(withCodeTrust(base, 'b', true)).toEqual(['a', 'b'])
    expect(withCodeTrust(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    expect(withCodeTrust(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(base).toEqual(['a'])
  })
})

describe('mcpPermissionRulesForCode', () => {
  const internal = [...CODE_INTERNAL_MCP]
  it('no confiado = ask; confiado = allow', () => {
    expect(mcpPermissionRulesForCode({ servers: ['gmail', 'crm'], trusted: ['crm'], internal: [] })).toEqual({
      'gmail_*': 'ask',
      'crm_*': 'allow'
    })
  })
  it('por defecto (sin confiados) todo pregunta', () => {
    expect(mcpPermissionRulesForCode({ servers: ['gmail', 'crm'], trusted: [], internal: [] })).toEqual({
      'gmail_*': 'ask',
      'crm_*': 'ask'
    })
  })
  it('interno = allow aunque no esté confiado, y aunque aún no figure en servers', () => {
    expect(mcpPermissionRulesForCode({ servers: ['browser', 'gmail'], trusted: [], internal })).toMatchObject({
      'browser_*': 'allow',
      'gmail_*': 'ask'
    })
    expect(mcpPermissionRulesForCode({ servers: ['gmail'], trusted: [], internal })['browser_*']).toBe('allow')
  })
  it('servidor con guion se conserva; con espacio o punto se sanea como el motor', () => {
    expect(mcpPermissionRulesForCode({ servers: ['lz-shell_bg', 'mi crm', 'a.b'], trusted: ['mi crm'], internal: [] })).toEqual({
      'lz-shell_bg_*': 'ask',
      'a_b_*': 'ask',
      'mi_crm_*': 'allow'
    })
    expect(sanitizeMcpName('mi crm.v2')).toBe('mi_crm_v2')
    expect(mcpServerPermissionKey('x-y')).toBe('x-y_*')
  })
  it('homónimos tras sanear: gana ask', () => {
    expect(mcpPermissionRulesForCode({ servers: ['a b', 'a.b'], trusted: ['a b'], internal: [] })).toEqual({ 'a_b_*': 'ask' })
  })
  it('lista vacía: solo los internos', () => {
    expect(mcpPermissionRulesForCode({ servers: [], trusted: [], internal: [] })).toEqual({})
    expect(mcpPermissionRulesForCode({ servers: [], trusted: ['gmail'], internal })).toEqual({
      'browser_*': 'allow',
      'computer_*': 'allow'
    })
  })
  it('un confiado que ya no existe no inventa regla; las entradas raras se ignoran', () => {
    const r = mcpPermissionRulesForCode({ servers: ['crm', '', 5 as unknown as string], trusted: ['fantasma'], internal: [] })
    expect(r).toEqual({ 'crm_*': 'ask' })
    expect(() => mcpPermissionRulesForCode(undefined as never)).not.toThrow()
  })
  it('los que preguntan van antes que los permitidos (gana la última regla)', () => {
    const keys = Object.keys(mcpPermissionRulesForCode({ servers: ['a', 'b', 'c'], trusted: ['a'], internal: [] }))
    expect(keys).toEqual(['b_*', 'c_*', 'a_*'])
  })
  it('isInternalCodeMcp', () => {
    expect(isInternalCodeMcp('browser')).toBe(true)
    expect(isInternalCodeMcp('gmail')).toBe(false)
  })
})
