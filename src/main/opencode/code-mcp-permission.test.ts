/**
 * Reglas de los conectores en Code dentro de la config inline (F8-B203). Los comportamientos del motor que se asumen aquí (orden de
 * fusión de `permission`, alias exacto `"<clave> *"`, llamadas internas de Code Mode con la misma clave) están comprobados con el
 * motor 1.19 real: `scripts/engine-probe/run.mjs` (manual, sin red ni modelo).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_INTERNAL_MCP } from '@shared/mcp-permissions'
import {
  buildCodeMcpPermission,
  cleanServerNames,
  fetchEngineMcpServers,
  permissionFingerprint,
  readGlobalOpencodeConfig,
  stripJsonc,
  wildcardMatch
} from './code-mcp-permission'

type Rules = Record<string, unknown>

/**
 * Simula lo que hace el motor 1.19 con las configs: fusión de objetos (una clave existente conserva su posición, una nueva va al
 * final) y, al evaluar, gana la ÚLTIMA regla cuyo permiso casa (`Wildcard.match`); sin regla, el `'*': allow` de `build`.
 */
function evaluate(configs: Rules[], tool: string, agentTail: Rules = {}): string {
  const merged: Rules = {}
  for (const c of configs) for (const [k, v] of Object.entries(c)) merged[k] = v
  const rules: Array<[string, string]> = [['*', 'allow']]
  for (const [k, v] of [...Object.entries(merged), ...Object.entries(agentTail)]) {
    if (typeof v === 'string') rules.push([k, v])
    else if (v && typeof v === 'object') for (const a of Object.values(v as Record<string, string>)) rules.push([k, a])
  }
  let hit = 'ask'
  for (const [k, a] of rules) if (wildcardMatch(tool, k)) hit = a
  return hit
}

describe('wildcardMatch (mismo comparador que el motor)', () => {
  it('comodines y el " *" final opcional', () => {
    expect(wildcardMatch('gmail_send', 'gmail_*')).toBe(true)
    expect(wildcardMatch('gmail_send', 'gmail_send *')).toBe(true)
    expect(wildcardMatch('gmail_sendx', 'gmail_send *')).toBe(false)
    expect(wildcardMatch('gmail_sen', 'gmail_send *')).toBe(false)
    expect(wildcardMatch('a.b', 'a?b')).toBe(true)
    expect(wildcardMatch('axb', 'a.b')).toBe(false)
  })
})

describe('buildCodeMcpPermission', () => {
  const internal = CODE_INTERNAL_MCP

  it('conector externo no confiado → ask; confiado → allow; internos → allow', () => {
    const p = buildCodeMcpPermission({ servers: ['crm', 'gmail', 'browser'], trusted: ['gmail'], internal })
    expect(p).toMatchObject({ 'crm_*': 'ask', 'gmail_*': 'allow', 'browser_*': 'allow', 'computer_*': 'allow' })
    expect(evaluate([p], 'crm_delete')).toBe('ask')
    expect(evaluate([p], 'gmail_list')).toBe('allow')
    // Code Mode: la llamada interna `tools.crm.delete` pide permiso con la MISMA clave `crm_delete` (comprobado en 1.19).
    expect(evaluate([p], 'crm_delete')).toBe(evaluate([p], 'crm_delete'))
  })

  it('las reglas no tocan bash/edit/etc.', () => {
    const p = buildCodeMcpPermission({ servers: ['x'], trusted: [], internal })
    for (const k of Object.keys(p)) expect(k).toMatch(/_\*$/)
  })

  it('«Preguntar antes de cada uso» del archivo gana sobre «Sin preguntar en Code»', () => {
    const base = { 'gmail_*': 'ask' }
    const p = buildCodeMcpPermission({ servers: ['gmail'], trusted: ['gmail'], internal, base })
    expect(p['gmail_*']).toBe('ask')
    expect(evaluate([base, p], 'gmail_list')).toBe('ask')
  })

  it('un deny del servidor entero en la base no se afloja', () => {
    const base = { 'crm_*': 'deny', 'browser_*': 'deny' }
    const p = buildCodeMcpPermission({ servers: ['crm'], trusted: ['crm'], internal, base })
    expect(p['crm_*']).toBe('deny')
    expect(p['browser_*']).toBe('deny')
  })

  it('EL HUECO: una herramienta bloqueada del archivo sigue bloqueada aunque el conector sea de confianza', () => {
    // Conector local con herramienta bloqueada y SIN «preguntar»: el archivo solo trae la regla por herramienta.
    const base = { gmail_send: 'deny' }
    // Sin alias, `gmail_*: allow` (clave nueva) quedaría al final y ganaría (lo que se vio con el motor real).
    expect(evaluate([base, { 'gmail_*': 'allow' }], 'gmail_send')).toBe('allow')
    const p = buildCodeMcpPermission({ servers: ['gmail'], trusted: ['gmail'], internal, base })
    expect(p['gmail_send *']).toBe('deny')
    expect(Object.keys(p).indexOf('gmail_send *')).toBeGreaterThan(Object.keys(p).indexOf('gmail_*'))
    expect(evaluate([base, p], 'gmail_send')).toBe('deny')
    expect(evaluate([base, p], 'gmail_list')).toBe('allow')
  })

  it('una herramienta bloqueada de un conector NO confiado: deny se mantiene sobre el ask', () => {
    const base = { gmail_send: 'deny' }
    const p = buildCodeMcpPermission({ servers: ['gmail'], trusted: [], internal, base })
    expect(evaluate([base, p], 'gmail_send')).toBe('deny')
    expect(evaluate([base, p], 'gmail_list')).toBe('ask')
  })

  it('un ask por herramienta se re-afirma tras un allow; un allow por herramienta no se re-afirma', () => {
    const base = { crm_delete: 'ask', crm_list: 'allow' }
    const p = buildCodeMcpPermission({ servers: ['crm'], trusted: ['crm'], internal, base })
    expect(p['crm_delete *']).toBe('ask')
    expect(p['crm_list *']).toBeUndefined()
    expect(evaluate([base, p], 'crm_delete')).toBe('ask')
    const q = buildCodeMcpPermission({ servers: ['crm'], trusted: [], internal, base })
    expect(q['crm_delete *']).toBeUndefined() // ask sobre ask: nada que re-afirmar
    expect(evaluate([base, q], 'crm_list')).toBe('ask') // por defecto se pregunta en Code
  })

  it('servidor cuyo nombre es prefijo de otro: confiar en `a` NO confía en `a_b`', () => {
    const p = buildCodeMcpPermission({ servers: ['a', 'a_b', 'browser_x'], trusted: ['a'], internal })
    // Sin alias, `a_*: allow` (después) ganaría sobre `a_b_*: ask`.
    expect(evaluate([{ 'a_b_*': 'ask', 'a_*': 'allow' }], 'a_b_list')).toBe('allow')
    expect(p['a_b_* *']).toBe('ask')
    expect(evaluate([p], 'a_b_list')).toBe('ask')
    expect(evaluate([p], 'a_list')).toBe('allow')
    // Igual con el interno `browser`: un conector `browser_x` sigue preguntando.
    expect(evaluate([p], 'browser_x_go')).toBe('ask')
    expect(evaluate([p], 'browser_navigate')).toBe('allow')
  })

  it('mapas por patrón: solo se re-afirman sus deny/ask', () => {
    const base = { crm_query: { '*': 'allow', 'drop*': 'deny' } }
    const p = buildCodeMcpPermission({ servers: ['crm'], trusted: ['crm'], internal, base })
    expect(p['crm_query *']).toEqual({ 'drop*': 'deny' })
  })

  it('reglas fijas (bgshell) van después y su servidor no recibe la regla general', () => {
    const p = buildCodeMcpPermission({
      servers: ['bgshell', 'crm'],
      trusted: ['bgshell'],
      internal,
      fixed: { bgshell_start: 'ask', bgshell_list: 'allow' },
      fixedServers: ['bgshell']
    })
    expect(p['bgshell_*']).toBeUndefined()
    const keys = Object.keys(p)
    expect(keys.indexOf('bgshell_start')).toBeGreaterThan(keys.indexOf('crm_*'))
    expect(p.bgshell_start).toBe('ask')
  })

  it('una regla global del usuario (base) con la misma clave más estricta gana', () => {
    const p = buildCodeMcpPermission({
      servers: [],
      trusted: [],
      internal,
      base: { bgshell_list: 'deny' },
      fixed: { bgshell_list: 'allow' }
    })
    expect(p.bgshell_list).toBe('deny')
  })

  it('basura: nunca lanza', () => {
    expect(() =>
      buildCodeMcpPermission({ servers: [1, null, 'a'] as never, trusted: 'x' as never, internal: [] as never, base: [] as never })
    ).not.toThrow()
  })

  it('huella estable y sensible al orden', () => {
    expect(permissionFingerprint({ a: 'ask', b: 'allow' })).toBe(permissionFingerprint({ a: 'ask', b: 'allow' }))
    expect(permissionFingerprint({ a: 'ask', b: 'allow' })).not.toBe(permissionFingerprint({ b: 'allow', a: 'ask' }))
  })
})

describe('cleanServerNames', () => {
  it('sin duplicados, sin vacíos ni no textos, con tope', () => {
    expect(cleanServerNames(['a', ' a ', '', 3, 'b', 'x'.repeat(200)])).toEqual(['a', 'b'])
    expect(cleanServerNames(Array.from({ length: 400 }, (_, i) => `s${i}`))).toHaveLength(300)
  })
})

describe('config global (~/.config/opencode)', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('stripJsonc respeta cadenas y quita comentarios y comas finales', () => {
    const t = '{ "a": "x // no", /* c */ "b": [1, 2,], // fin\n "c": "y /* no */", }'
    expect(JSON.parse(stripJsonc(t))).toEqual({ a: 'x // no', b: [1, 2], c: 'y /* no */' })
  })

  it('lee servidores y permisos de los tres archivos, en orden; uno roto se ignora', () => {
    dir = mkdtempSync(join(tmpdir(), 'lazunox-gcfg-'))
    const oc = join(dir, 'opencode')
    mkdirSync(oc)
    writeFileSync(join(oc, 'config.json'), JSON.stringify({ mcp: { crm: {} }, permission: { crm_drop: 'deny' } }))
    writeFileSync(join(oc, 'opencode.json'), '{ roto')
    writeFileSync(join(oc, 'opencode.jsonc'), '{ // gmail\n "mcp": { "gmail": {} }, "permission": { "gmail_send": "deny", },\n}')
    const g = readGlobalOpencodeConfig({ XDG_CONFIG_HOME: dir })
    expect(g.servers).toEqual(['crm', 'gmail'])
    expect(g.permission).toEqual({ crm_drop: 'deny', gmail_send: 'deny' })
  })

  it('sin carpeta: vacío', () => {
    expect(readGlobalOpencodeConfig({ XDG_CONFIG_HOME: join(tmpdir(), 'no-existe-lazunox-xyz') })).toEqual({ servers: [], permission: {} })
  })
})

describe('fetchEngineMcpServers', () => {
  afterEach(() => vi.unstubAllGlobals())
  const conn = { baseUrl: 'http://127.0.0.1:1', authorization: 'Basic x' }

  it('une /mcp y las claves mcp de /config (pide con la carpeta y la credencial)', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        calls.push(url)
        expect(init.headers.Authorization).toBe('Basic x')
        const body = url.includes('/mcp?') ? { crm: { status: 'connected' }, bgshell: {} } : { mcp: { gmail: {}, crm: {} }, permission: {} }
        return new Response(JSON.stringify(body), { status: 200 })
      })
    )
    expect(await fetchEngineMcpServers(conn, '/chat dir')).toEqual(['crm', 'bgshell', 'gmail'])
    expect(calls.every((u) => u.includes('directory=%2Fchat%20dir'))).toBe(true)
  })

  it('cualquier fallo → null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 }))
    )
    expect(await fetchEngineMcpServers(conn, '/c')).toBeNull()
  })
})
