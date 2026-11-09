/**
 * W-A2: las reglas `ask` de los conectores que trae la carpeta (`projectAskRules`/`projectAskOf`) van DELANTE del bloque del
 * modo sin romper `endsWithRuleset`/`approvalKindOf` (que reconocen el modo porque la sesión TERMINA con su bloque). No usan
 * `*_*: ask` general (casaría con permisos internos con guion bajo y con los conectores de confianza).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalKindOf, rulesetForMode } from '@shared/permission-rules'
import type { ProjectScanResult } from '@shared/ipc-code'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type PR = typeof import('./permission-rules')
let pr: PR
let useSettings: (typeof import('../../../stores/settings'))['useSettings']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  pr = await import('./permission-rules')
  ;({ useSettings } = await import('../../../stores/settings'))
})

const scanWith = (names: string[], complete = true): Pick<ProjectScanResult, 'items' | 'complete'> => ({
  complete,
  items: names.map((n) => ({
    id: n,
    kind: 'mcp',
    name: n,
    trustName: n,
    mcpKey: `${n}_*`,
    where: 'opencode.json',
    risky: true
  }))
})

describe('projectAskRules', () => {
  it('sin escaneo en esta ejecución: falla cerrado, todo conector pregunta', () => {
    expect(pr.projectAskRules(undefined, [])).toEqual([{ permission: '*_*', pattern: '*', action: 'ask' }])
  })

  it('un conector de la carpeta: una regla ask con SU clave, no un `*_*` general', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: false }], askAll: false }, [])
    expect(rules).toEqual([{ permission: 'crm_*', pattern: '*', action: 'ask' }])
  })

  it('conector marcado de confianza en Ajustes: sin regla (no pregunta)', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: false }], askAll: false }, [
      'crm'
    ])
    expect(rules).toEqual([])
  })

  it('conector de confianza que esta carpeta REDEFINE (mismo nombre): pregunta siempre, aunque esté en la lista de confianza', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: true }], askAll: false }, [
      'crm'
    ])
    expect(rules).toEqual([{ permission: 'crm_*', pattern: '*', action: 'ask' }])
  })

  it('la confianza se decide con el nombre CRUDO: un nombre que solo se ve igual (sin trustName) pregunta aunque el mostrado esté en la lista', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'github', key: 'github__*', overrides: false }], askAll: false }, ['github'])
    expect(rules).toEqual([{ permission: 'github__*', pattern: '*', action: 'ask' }])
  })

  it('escaneo incompleto (archivo roto, enlace fuera, tope): `*_*: ask` como red de seguridad, delante de las demás', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: false }], askAll: true }, [])
    expect(rules).toEqual([
      { permission: '*_*', pattern: '*', action: 'ask' },
      { permission: 'crm_*', pattern: '*', action: 'ask' }
    ])
  })

  it('varios conectores: orden estable (por clave), sin duplicar', () => {
    const rules = pr.projectAskRules(
      {
        servers: [
          { name: 'z', key: 'z_*', overrides: false },
          { name: 'a', key: 'a_*', overrides: false }
        ],
        askAll: false
      },
      []
    )
    expect(rules.map((r) => r.permission)).toEqual(['a_*', 'z_*'])
  })
})

describe('setFolderMcp / clearFolderMcp / folderMcpOf', () => {
  it('guarda el escaneo y lo relee por carpeta (normaliza la barra final)', () => {
    pr.setFolderMcp('/p/a', scanWith(['crm']))
    expect(pr.folderMcpOf('/p/a')).toEqual({
      servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: false }],
      askAll: false,
      config: []
    })
    expect(pr.folderMcpOf('/p/a/')).toEqual(pr.folderMcpOf('/p/a'))
  })

  it('sin escaneo (null): askAll true, falla cerrado', () => {
    pr.setFolderMcp('/p/b', null)
    expect(pr.folderMcpOf('/p/b')).toEqual({ servers: [], askAll: true })
  })

  it('clearFolderMcp quita el registro (vuelve a `undefined`: sin escaneo, falla cerrado)', () => {
    pr.setFolderMcp('/p/c', scanWith(['x']))
    pr.clearFolderMcp('/p/c')
    expect(pr.folderMcpOf('/p/c')).toBeUndefined()
    expect(pr.projectAskOf('/p/c')).toEqual([{ permission: '*_*', pattern: '*', action: 'ask' }])
  })
})

describe('projectAskOf', () => {
  it('cablea folderMcpOf con la lista de confianza de Ajustes; sin Ajustes cargados, no lanza', () => {
    pr.setFolderMcp('/p/d', scanWith(['crm', 'web']))
    useSettings.setState((s) => ({ settings: { ...s.settings, codeTrustedMcp: ['crm'] } }))
    expect(pr.projectAskOf('/p/d').map((r) => r.permission)).toEqual(['web_*'])
  })
})

describe('rulesetFor con reglas de proyecto: sigue terminando en el bloque del modo', () => {
  const projectAsk = [{ permission: 'crm_*', pattern: '*' as const, action: 'ask' as const }]

  it('las reglas de proyecto van delante; el bloque sigue siendo el del modo (endsWithModeBlock / approvalKindOf)', () => {
    for (const mode of ['manual', 'acceptEdits', 'plan', 'auto', 'bypass'] as const) {
      const withProject = pr.rulesetFor(mode, undefined, projectAsk)
      const without = pr.rulesetFor(mode, undefined, [])
      // El bloque del modo (lo que importa para `approvalKindOf`/idempotencia) es igual con o sin reglas de proyecto: solo cambia
      // lo que va ANTES.
      expect(withProject.slice(withProject.length - rulesetForMode(mode).length)).toEqual(
        without.slice(without.length - rulesetForMode(mode).length)
      )
    }
  })

  it('approvalKindOf sigue reconociendo "auto" y "plan" con las reglas de proyecto delante', () => {
    expect(approvalKindOf(pr.rulesetFor('auto', undefined, projectAsk))).toBe('auto')
    expect(approvalKindOf(pr.rulesetFor('plan', undefined, projectAsk))).toBe('plan')
    expect(approvalKindOf(pr.rulesetFor('manual', undefined, projectAsk))).toBeNull()
  })

  it('reenviar el mismo modo con las mismas reglas de proyecto es idempotente (sessionHasRuleset)', () => {
    const a = pr.rulesetFor('auto', undefined, projectAsk)
    expect(pr.sessionHasRuleset(a, pr.rulesetFor('auto', undefined, projectAsk))).toBe(true)
  })

  it('sin reglas de proyecto, el bloque es exactamente el de antes (compatibilidad)', () => {
    expect(pr.rulesetFor('manual')).toEqual(pr.rulesetFor('manual', undefined, []))
  })
})

/**
 * Evaluación con la semántica REAL del motor 1.19 (`evaluate`): gana la ÚLTIMA regla que casa por permiso y patrón con comodín
 * (`*` casa todo, `?` un carácter, `\` cuenta como `/`); si ninguna casa, el valor por defecto es `ask`. Se usa el mismo comparador que la app
 * copia del motor (`wildcardMatch`). Las reglas del agente `build` (`'*': allow`) van ANTES de las de la sesión.
 */
describe('evaluación con la semántica del motor (la última que casa gana)', () => {
  type Rule = { permission: string; pattern: string; action: 'allow' | 'ask' | 'deny' }
  const BUILD: Rule[] = [{ permission: '*', pattern: '*', action: 'allow' }]
  const modes = ['manual', 'acceptEdits', 'plan', 'auto', 'bypass'] as const

  // Mismo comparador que el motor 1.19 (`Wildcard.match`), copia de `wildcardMatch` en main: `*` cualquier cosa, `?` un carácter, `\` como `/`, " *" final opcional.
  function wildcardMatch(str: string, pattern: string): boolean {
    const text = str.replaceAll('\\', '/')
    let p = pattern
      .replaceAll('\\', '/')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    if (p.endsWith(' .*')) p = p.slice(0, -3) + '( .*)?'
    return new RegExp('^' + p + '$', 's').test(text)
  }

  async function evaluate(permission: string, pattern: string, rules: readonly Rule[]): Promise<string> {
    let action = 'ask'
    for (const r of rules) if (wildcardMatch(permission, r.permission) && wildcardMatch(pattern, r.pattern)) action = r.action
    return action
  }

  it('la herramienta de un conector de la carpeta pregunta en los cinco modos, también en «Todo sin preguntar»', async () => {
    const ask = pr.projectAskRules({ servers: [{ name: 'crm', trustName: 'crm', key: 'crm_*', overrides: false }], askAll: false }, [])
    for (const mode of modes) {
      const session = pr.rulesetFor(mode, undefined, ask) as unknown as Rule[]
      expect(await evaluate('crm_buscar', '*', [...BUILD, ...session]), mode).toBe('ask')
    }
  })

  it('sin la regla de proyecto (conector de confianza) el agente `build` lo deja pasar: por eso la exclusión solo vale con nombre crudo', async () => {
    const session = pr.rulesetFor('auto', undefined, []) as unknown as Rule[]
    expect(await evaluate('crm_buscar', '*', [...BUILD, ...session])).toBe('allow')
  })

  it('el respaldo `*_*` cubre cualquier conector, pero los permisos del bloque del modo siguen mandando', async () => {
    const ask = pr.projectAskRules(undefined, [])
    const session = pr.rulesetFor('bypass', undefined, ask) as unknown as Rule[]
    expect(await evaluate('otro_x', '*', [...BUILD, ...session])).toBe('ask')
    expect(await evaluate('bash', 'ls', [...BUILD, ...session])).toBe('allow') // bypass lo permite: el bloque del modo va después
    expect(await evaluate('external_directory', '/tmp/x', [...BUILD, ...session])).toBe('allow')
  })

  it('una ruta con `\\` casa como con `/` (Windows)', async () => {
    const rules: Rule[] = [{ permission: 'edit', pattern: 'a/*/c.txt', action: 'deny' }]
    expect(await evaluate('edit', 'a\\b\\c.txt', rules)).toBe('deny')
  })
})

describe('lo que la config niega no lo tapa un ask de conector (arreglo de W-A2)', () => {
  const C = (permission: string, action: 'allow' | 'ask' | 'deny', pattern = '*', agent?: 'build' | 'plan') => ({
    permission,
    pattern,
    action,
    agent
  })
  const srv = [{ name: 'prueba', key: 'prueba_*', overrides: false }]
  const fmt = (rs: Array<{ permission: string; pattern: string; action: string }>): string[] =>
    rs.map((r) => `${r.permission} ${r.pattern} ${r.action}`)
  // Como el motor: gana la última regla que coincide.
  const gana = (rules: Array<{ permission: string; action: string }>, tool: string): string =>
    rules.filter((r) => new RegExp('^' + r.permission.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(tool)).at(-1)
      ?.action ?? 'sin-regla'

  it('los deny de la carpeta van DESPUÉS de los `ask` (gana la última): herramienta, comodín, alias, mapa, `*` y por agente', () => {
    const state = {
      servers: srv,
      askAll: false,
      config: [C('prueba_start', 'deny'), C('*delete*', 'deny'), C('y_mapa', 'deny', 'a/*'), C('*', 'deny'), C('b_x', 'deny', '*', 'build')]
    }
    const rules = pr.projectAskRules(state, [], 'build')
    expect(fmt(rules)).toEqual(['prueba_* * ask', 'prueba_start * deny', '*delete* * deny', 'y_mapa a/* deny', '* * deny', 'b_x * deny'])
    expect(gana(rules, 'prueba_otra')).toBe('deny') // `*: deny` (G1)
    expect(fmt(pr.projectAskRules(state, [], 'plan')).includes('b_x * deny')).toBe(false) // G2: solo el agente activo
  })

  it('sin ninguna regla que niegue todo queda EXACTAMENTE como antes (regresión)', () => {
    expect(pr.projectAskRules({ servers: srv, askAll: false }, [])).toEqual([{ permission: 'prueba_*', pattern: '*', action: 'ask' }])
    expect(pr.projectAskRules({ servers: srv, askAll: false, config: [C('prueba_*', 'allow'), C('x_*', 'ask')] }, [])).toEqual([
      { permission: 'prueba_*', pattern: '*', action: 'ask' }
    ])
  })

  it('«negar todo menos X» niega TAMBIÉN X (decisión de diseño: más estricto que el motor, nunca más laxo); no se re-emite ningún allow/ask', () => {
    const rules = pr.projectAskRules({ servers: srv, askAll: false, config: [C('prueba_*', 'deny'), C('prueba_start', 'allow')] }, [])
    expect(rules.some((r) => r.action === 'allow')).toBe(false)
    expect(gana(rules, 'prueba_start')).toBe('deny')
    expect(gana(rules, 'prueba_otra')).toBe('deny')
  })

  it('N1: global y carpeta se contradicen, o carpeta y carpeta superior: cualquier deny gana, en cualquier orden de las fuentes', () => {
    const global = [C('prueba_*', 'deny'), C('prueba_start', 'allow')]
    const carpeta = [C('prueba_start', 'deny'), C('prueba_*', 'allow')]
    pr.setGlobalConfigRules(global)
    expect(gana(pr.projectAskRules({ servers: srv, askAll: false, config: carpeta }, []), 'prueba_start')).toBe('deny')
    pr.setGlobalConfigRules([C('prueba_*', 'allow')])
    // carpeta + carpeta superior (el escáner las junta de la más cercana a la más lejana, al revés que el motor): da igual el orden
    for (const cfg of [
      [...carpeta, C('prueba_start', 'allow')],
      [C('prueba_start', 'allow'), ...carpeta]
    ])
      expect(gana(pr.projectAskRules({ servers: srv, askAll: false, config: cfg }, []), 'prueba_start')).toBe('deny')
  })

  it('M3: las reglas globales (config del usuario y archivo de la app) valen para carpetas sin escanear o con escaneo fallido, y se pueden refrescar', () => {
    pr.setGlobalConfigRules([C('g_x', 'deny')])
    expect(fmt(pr.projectAskOf('/sin-escanear'))).toEqual(['*_* * ask', 'g_x * deny'])
    pr.setFolderMcp('/b', null)
    expect(fmt(pr.projectAskOf('/b'))).toEqual(['*_* * ask', 'g_x * deny'])
    pr.setGlobalConfigRules([C('g_x', 'deny'), C('h_y', 'deny')]) // Ajustes cambió algo: el siguiente cálculo ya lo trae
    expect(fmt(pr.projectAskOf('/b'))).toEqual(['*_* * ask', 'g_x * deny', 'h_y * deny'])
    pr.setGlobalConfigRules(undefined) // una lectura fallida no borra lo último que se supo
    expect(fmt(pr.projectAskOf('/b'))).toHaveLength(3)
  })

  it('el escaneo trae reglas globales y de la carpeta y las guarda', () => {
    const scan = { ...scanWith(['prueba']), globalConfigRules: [C('g_x', 'deny')], configRules: [C('p_y', 'deny')] }
    pr.setFolderMcp('/a', scan)
    expect(fmt(pr.projectAskOf('/a'))).toEqual(['prueba_* * ask', 'g_x * deny', 'p_y * deny'])
  })

  it('en la sesión: los deny van antes del bloque del modo (que sigue al final) y las herramientas propias de la app (bgshell/documentos) siguen como antes', () => {
    for (const mode of ['manual', 'acceptEdits', 'auto', 'bypass', 'plan'] as const) {
      const ask = pr.projectAskRules({ servers: srv, askAll: false, config: [C('*_*', 'deny')] }, [])
      const set = pr.rulesetFor(mode, undefined, ask)
      const block = rulesetForMode(mode)
      expect(set.slice(-block.length)).toEqual(block)
      // El deny amplio `*_*` no deja a `bgshell_status` ni `documentos_renderizar` denegados: sus reglas de sesión se repiten DESPUÉS del deny.
      const cola = set.slice(0, set.length - block.length)
      for (const tool of ['bgshell_status', 'bgshell_start', 'documentos_renderizar'])
        expect(gana(cola, tool), `${mode} ${tool}`).not.toBe('deny')
      expect(gana(cola, 'prueba_start')).toBe('deny')
    }
  })

  it('carpeta sin enumerar (`*_*: ask`) + deny: las herramientas de la app siguen PREGUNTANDO, como antes (no se aflojan)', () => {
    const ask = pr.projectAskRules({ servers: [], askAll: true, config: [C('*start*', 'deny')] }, [])
    const set = pr.rulesetFor('bypass', undefined, ask)
    const cola = set.slice(0, set.length - rulesetForMode('bypass').length)
    expect(gana(cola, 'bgshell_status')).toBe('ask')
    expect(gana(cola, 'documentos_renderizar')).toBe('ask')
    expect(gana(cola, 'prueba_start')).toBe('deny')
  })

  it('sin deny, rulesetFor es idéntico al de antes (sin repetir nada)', () => {
    const ask = pr.projectAskRules({ servers: srv, askAll: false }, [])
    const set = pr.rulesetFor('manual', undefined, ask)
    const base = pr.rulesetFor('manual', undefined, [])
    expect(set).toHaveLength(base.length + 1)
  })

  it('M3: `refreshGlobalConfigRules` lee solo las reglas globales (rulesOnly) y actualiza lo que se manda; si falla o vence, queda lo último que se supo', async () => {
    const scan = vi.fn(async () => ({ globalConfigRules: [C('nuevo_x', 'deny')] }))
    vi.resetModules()
    vi.doMock('./client', () => ({ nativeCode: () => ({ project: { scan } }) }))
    const pr2 = await import('./permission-rules')
    pr2.setGlobalConfigRules([C('viejo_x', 'deny')])
    expect(fmt(pr2.projectAskOf('/x'))).toEqual(['*_* * ask', 'viejo_x * deny'])
    await pr2.refreshGlobalConfigRules()
    expect(scan).toHaveBeenCalledWith('/', true)
    expect(fmt(pr2.projectAskOf('/x'))).toEqual(['*_* * ask', 'nuevo_x * deny'])
    scan.mockRejectedValueOnce(new Error('sin motor'))
    await pr2.refreshGlobalConfigRules()
    expect(fmt(pr2.projectAskOf('/x'))).toEqual(['*_* * ask', 'nuevo_x * deny'])
    vi.doUnmock('./client')
  })
  it('sin API nativa (pruebas, web) no hace nada y no espera', () => {
    expect(pr.refreshGlobalConfigRules()).toBeUndefined()
  })
})
