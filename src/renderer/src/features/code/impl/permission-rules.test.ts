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
    mcpKey: `${n}_*`,
    where: 'opencode.json',
    risky: true
  }))
})

describe('projectAskRules', () => {
  it('sin escaneo (carpeta no abierta todavía): sin reglas', () => {
    expect(pr.projectAskRules(undefined, [])).toEqual([])
  })

  it('un conector de la carpeta: una regla ask con SU clave, no un `*_*` general', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', key: 'crm_*', overrides: false }], askAll: false }, [])
    expect(rules).toEqual([{ permission: 'crm_*', pattern: '*', action: 'ask' }])
  })

  it('conector marcado de confianza en Ajustes: sin regla (no pregunta)', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', key: 'crm_*', overrides: false }], askAll: false }, ['crm'])
    expect(rules).toEqual([])
  })

  it('conector de confianza que esta carpeta REDEFINE (mismo nombre): pregunta siempre, aunque esté en la lista de confianza', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', key: 'crm_*', overrides: true }], askAll: false }, ['crm'])
    expect(rules).toEqual([{ permission: 'crm_*', pattern: '*', action: 'ask' }])
  })

  it('escaneo incompleto (archivo roto, enlace fuera, tope): `*_*: ask` como red de seguridad, delante de las demás', () => {
    const rules = pr.projectAskRules({ servers: [{ name: 'crm', key: 'crm_*', overrides: false }], askAll: true }, [])
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
    expect(pr.folderMcpOf('/p/a')).toEqual({ servers: [{ name: 'crm', key: 'crm_*', overrides: false }], askAll: false })
    expect(pr.folderMcpOf('/p/a/')).toEqual(pr.folderMcpOf('/p/a'))
  })

  it('sin escaneo (null): askAll true, falla cerrado', () => {
    pr.setFolderMcp('/p/b', null)
    expect(pr.folderMcpOf('/p/b')).toEqual({ servers: [], askAll: true })
  })

  it('clearFolderMcp quita el registro (vuelve a `undefined`, sin reglas)', () => {
    pr.setFolderMcp('/p/c', scanWith(['x']))
    pr.clearFolderMcp('/p/c')
    expect(pr.folderMcpOf('/p/c')).toBeUndefined()
    expect(pr.projectAskRules(pr.folderMcpOf('/p/c'), [])).toEqual([])
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
