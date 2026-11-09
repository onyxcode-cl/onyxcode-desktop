/**
 * Motor `lazunox.16` (LAZUNOX_PERMISOS_CAPAS=1): al crear la sesión y al cambiar de modo la app manda `permissionMode: "replace"` para que el
 * bloque del modo SUSTITUYA al anterior. Con eso se arregla el fallo conocido de la 1.8.12: tras «Solo explorar» el bloque viejo (`edit * deny`,
 * `write * deny`, `task general deny`) se quedaba en la lista de la sesión y los ayudantes (sesiones hijas) lo heredaban, así que no podían editar.
 *
 * Aquí no hay motor real: un motor FALSO imita el contrato (`replace` sustituye lo acumulado y pone la marca; sin el campo, anexa como lazunox.15).
 * Lo que se prueba es lo que la app ENVÍA y que la lista resultante ya no trae el bloque de «Solo explorar».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import { hasModeMark, hasStalePlanBlock, rulesetForMode } from '@shared/permission-rules'
import { rulesetFor, sessionRulesUpToDate } from './permission-rules'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Rule = { permission: string; pattern: string; action: 'allow' | 'ask' | 'deny' }
type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const MARK: Rule = { permission: 'lazunox_modo_inicio', pattern: 'modo', action: 'allow' }

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
  ;(await import('./permission-rules')).setFolderMcp(D, { items: [], complete: true })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)

/** Motor falso: guarda las reglas de cada sesión. `supportsReplace=false` imita a lazunox.15 (anexa siempre y no pone marca). */
function installEngine(supportsReplace: boolean) {
  const rules = new Map<string, Rule[]>()
  const apply2 = (sid: string, permission: Rule[] | undefined, body: Record<string, unknown>): Rule[] => {
    const replace = supportsReplace && body.$body_permissionMode === 'replace'
    const prev = rules.get(sid) ?? []
    const next = !permission ? prev : replace ? [MARK, ...permission] : [...prev, ...permission]
    rules.set(sid, next)
    return next
  }
  const create = vi.fn((a: Record<string, unknown>) => {
    const sid = `new${rules.size}`
    const permission = apply2(sid, a.permission as Rule[] | undefined, a)
    return Promise.resolve({ data: makeSession(sid, a.directory as string, { permission: permission as never }) })
  })
  const update = vi.fn((a: Record<string, unknown>) => {
    const permission = apply2(a.sessionID as string, a.permission as Rule[] | undefined, a)
    return Promise.resolve({ data: { id: a.sessionID, permission } })
  })
  const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
  const client = {
    session: {
      create,
      update,
      promptAsync,
      list: () => Promise.resolve({ data: [] }),
      status: () => Promise.resolve({ data: {} }),
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] })
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
  return { create, update, promptAsync, rules }
}

describe('permissionMode: "replace" (motor lazunox.16)', () => {
  it('al crear la sesión manda replace junto con el bloque del modo', async () => {
    const { create } = installEngine(true)
    await st().newSessionAt(D)
    const body = create.mock.calls[0]![0]
    expect(body.$body_permissionMode).toBe('replace')
    expect(body.permission).toEqual(rulesetFor('manual'))
  })

  it('al cambiar de modo manda replace con el bloque COMPLETO del modo nuevo', async () => {
    const { update } = installEngine(true)
    apply(sessionCreated(makeSession('s1', D, { permission: [MARK, ...rulesetFor('manual')] as never })))
    useCode.setState({ activeSessionID: 's1' })
    await st().setPermissionMode('plan')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]![0].$body_permissionMode).toBe('replace')
    expect(update.mock.calls[0]![0].permission).toEqual(rulesetFor('plan'))
  })

  it('«Solo explorar» → «Automático»: la lista queda sin el bloque de plan (los ayudantes ya pueden editar) y no crece', async () => {
    const { rules } = installEngine(true)
    const sid = await st().newSessionAt(D)
    expect(sid).toBeTruthy()
    useCode.setState({ activeSessionID: sid! })
    await st().setPermissionMode('plan')
    expect(hasStalePlanBlock(st().sessions[sid!]?.permission)).toBe(false) // está en «Solo explorar»
    await st().setPermissionMode('auto')
    const list = rules.get(sid!)!
    expect(list).toEqual([MARK, ...rulesetFor('auto')])
    // Nada del bloque de «Solo explorar» sobrevive: ni `edit * deny`, ni `write * deny`, ni `task general deny`.
    expect(list.some((r) => r.action === 'deny' && ['edit', 'write'].includes(r.permission) && r.pattern === '*')).toBe(false)
    expect(list.some((r) => r.permission === 'task' && r.pattern === 'general' && r.action === 'deny')).toBe(false)
    expect(hasStalePlanBlock(st().sessions[sid!]?.permission)).toBe(false)
    // Y muchos cambios de modo no hacen crecer la lista.
    for (const m of ['manual', 'plan', 'auto', 'manual', 'plan', 'auto'] as const) await st().setPermissionMode(m)
    expect(rules.get(sid!)!.length).toBe(1 + rulesetFor('auto').length) // la marca + un solo bloque, sin importar cuántos cambios hubo
    expect(rules.get(sid!)!.filter((r) => r.permission === MARK.permission)).toHaveLength(1)
  })

  it('una sesión de la 1.8.12 que arrastra «Solo explorar» y termina con el bloque nuevo se REPARA al enviar (replace una vez)', async () => {
    const { update, promptAsync, rules } = installEngine(true)
    const stale = [...rulesetFor('plan'), ...rulesetFor('auto')] // lo que dejaba la 1.8.12: plan → auto acumulados, sin marca
    rules.set('s1', stale)
    apply(sessionCreated(makeSession('s1', D, { permission: stale as never })))
    useCode.setState({ activeSessionID: 's1', permissionMode: 'auto' })
    expect(hasStalePlanBlock(st().sessions.s1?.permission)).toBe(true)
    expect(await st().send('hola', [])).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]![0].$body_permissionMode).toBe('replace')
    expect(hasStalePlanBlock(st().sessions.s1?.permission)).toBe(false)
    expect(hasModeMark(st().sessions.s1?.permission)).toBe(true)
    // El segundo mensaje ya no reenvía nada.
    await st().send('otra vez', [])
    expect(update).toHaveBeenCalledTimes(1)
    expect(promptAsync).toHaveBeenCalledTimes(2)
  })

  it('con un motor anterior (sin marca) se reenvía UNA vez por sesión, no en cada mensaje (la lista no crece de más)', async () => {
    const { update, rules } = installEngine(false)
    const block = rulesetFor('manual')
    rules.set('s1', block)
    apply(sessionCreated(makeSession('s1', D, { permission: block as never })))
    useCode.setState({ activeSessionID: 's1' })
    await st().send('uno', [])
    await st().send('dos', [])
    await st().send('tres', [])
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('sessionRulesUpToDate: exige terminar con el bloque Y haber sido reemplazada', () => {
    const block = rulesetFor('manual') as never
    expect(sessionRulesUpToDate('x', undefined, block)).toBe(false)
    expect(sessionRulesUpToDate('x', [...rulesetForMode('plan'), ...(block as Rule[])] as never, block)).toBe(false)
    expect(sessionRulesUpToDate('x', [MARK, ...(block as Rule[])] as never, block)).toBe(true)
    expect(sessionRulesUpToDate('x', [MARK, ...(block as Rule[]), { permission: 'x', pattern: '*', action: 'ask' }] as never, block)).toBe(false)
  })
})
