/**
 * ZONA INTOCABLE (contención de subagentes y de rechazos en Code Mode): ejecuta el texto REAL de
 * `subagentGuardPluginSource()` con un cliente de motor simulado. Las formas del cliente
 * (`session.get({ path: { id } })`, `app.agents()`, `session.messages`) y los rulesets de `general` están
 * tomados del binario 1.19 real (ver docs/SEGURIDAD.md §3 sexagies).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { subagentGuardPluginSource } from './subagent-guard'
import { McpProxy } from '../tasks/mcp-proxy'
import { createGuardInfoHandler, GUARD_PATH_PREFIX } from '../tasks/guard-info'

interface Rule {
  permission: string
  pattern: string
  action: 'allow' | 'ask' | 'deny'
}
type Action = Rule['action']
type Before = (input: { tool: string; sessionID?: string; callID?: string }, output: { args: Record<string, unknown> }) => Promise<void>
type EventHook = (a: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>

/** Convierte los `permission:` de un agente .md a ruleset (mismo orden que el motor: en el orden escrito). */
function rulesFromAgentMd(file: string): Rule[] {
  const text = readFileSync(join(__dirname, '../../../resources/opencode/agents', file), 'utf8')
  const head = text.split('\n---\n')[0].split('\n')
  const start = head.findIndex((l) => l === 'permission:')
  const rules: Rule[] = []
  let key = ''
  const unq = (v: string): string => v.trim().replace(/^"(.*)"$/, '$1')
  for (const raw of head.slice(start + 1)) {
    if (!raw.startsWith('  ') || raw.trim().startsWith('#') || !raw.trim()) continue
    const m = /^( +)(.+?):\s*(.*)$/.exec(raw)
    if (!m) continue
    const [, ind, k, v] = m
    if (ind.length === 2) {
      if (v) rules.push({ permission: unq(k), pattern: '*', action: v as Action })
      else key = unq(k)
    } else rules.push({ permission: key, pattern: unq(k), action: v as Action })
  }
  return rules
}

const r = (permission: string, action: Action, pattern = '*'): Rule => ({ permission, pattern, action })
// `general` integrado de 1.19 (capturado del binario real).
const GENERAL: Rule[] = [
  r('*', 'allow'),
  r('doom_loop', 'ask'),
  r('external_directory', 'ask'),
  r('question', 'deny'),
  r('read', 'allow'),
  r('read', 'ask', '*.env'),
  r('read', 'ask', '*.env.*'),
  r('read', 'allow', '*.env.example'),
  r('todowrite', 'deny')
]
const BUILD: Rule[] = [
  r('*', 'allow'),
  r('doom_loop', 'ask'),
  r('external_directory', 'ask'),
  r('question', 'allow'),
  r('read', 'allow'),
  r('read', 'ask', '*.env'),
  r('read', 'ask', '*.env.*'),
  r('read', 'allow', '*.env.example')
]
const PLAN: Rule[] = [...BUILD, r('edit', 'deny')]
const EXPLORE: Rule[] = [r('*', 'deny'), r('read', 'allow'), r('grep', 'allow'), r('glob', 'allow'), r('list', 'allow')]
const BASH_DENIED: Rule[] = [r('*', 'allow'), r('bash', 'deny')]
const CHAT: Rule[] = [r('*', 'deny'), r('webfetch', 'allow'), r('websearch', 'allow'), r('question', 'allow')]
// Chat con subagentes encendidos (F8-B206, config inline de `config.ts`): `read` centinela y `task` con lista blanca.
const CHAT_SUB: Rule[] = [
  ...CHAT,
  r('read', 'deny'),
  r('read', 'allow', '/__lazunox_sin_acceso__'),
  r('task', 'deny'),
  r('task', 'allow', 'lazunox-chat-helper')
]

const AGENTS: Record<string, Rule[]> = {
  tasks: rulesFromAgentMd('tasks.md'),
  computer: rulesFromAgentMd('computer.md'),
  'lazunox-helper': rulesFromAgentMd('lazunox-helper.md'),
  'lazunox-chat-helper': rulesFromAgentMd('lazunox-chat-helper.md'),
  chatsub: CHAT_SUB,
  general: GENERAL,
  build: BUILD,
  plan: PLAN,
  explore: EXPLORE,
  bashdenied: BASH_DENIED,
  chat: CHAT
}

interface Sess {
  id: string
  parentID?: string
  agent?: string
  permission?: Rule[]
}
interface World {
  sessions: Record<string, Sess>
  /** agente del último mensaje de usuario por sesión raíz */
  userAgent?: Record<string, string>
  agents?: Record<string, Rule[]>
  agentsFail?: boolean
  noApp?: boolean
  /**
   * F8-B208: cómo falla `session.get` cuando el plugin no alcanza a su propio servidor (Overdrive con Seatbelt sin salida al
   * propio puerto): `throw` = el fetch del cliente lanza (EPERM); `noresponse` = el cliente devuelve `{ error }` sin respuesta
   * HTTP; `404` = el motor responde que la sesión no existe.
   */
  sessionFail?: 'throw' | 'noresponse' | '404'
}

let dir = ''
let n = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-guard-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function load(
  w: World
): Promise<{ before: Before; after: (i: Record<string, unknown>) => Promise<void>; event: EventHook; aborts: string[] }> {
  const aborts: string[] = []
  const client = {
    session: {
      get: async (a: { path?: { id: string } }) => {
        if (w.sessionFail === 'throw') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EPERM' } })
        if (w.sessionFail === 'noresponse') return { error: new TypeError('fetch failed'), request: {}, response: undefined }
        if (w.sessionFail === '404') return { error: { name: 'NotFoundError' }, request: {}, response: { status: 404 } }
        return { data: a.path ? w.sessions[a.path.id] : undefined }
      },
      messages: async (a: { path?: { id: string } }) => {
        const agent = a.path && w.userAgent?.[a.path.id]
        return { data: agent ? [{ info: { role: 'user', agent, time: { created: 1 } } }] : [] }
      },
      abort: async (a: { path: { id: string } }) => {
        aborts.push(a.path.id)
        return { data: true }
      }
    },
    ...(w.noApp
      ? {}
      : {
          app: {
            agents: async () => {
              if (w.agentsFail) throw new Error('motor caído')
              const src = w.agents ?? AGENTS
              return { data: Object.entries(src).map(([name, permission]) => ({ name, mode: 'subagent', permission })) }
            }
          }
        })
  }
  const file = join(dir, `guard-${n++}.mjs`)
  writeFileSync(file, subagentGuardPluginSource(), 'utf8')
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default: { server: (i: unknown) => Promise<Record<string, unknown>> }
  }
  const h = await mod.default.server({ client })
  return { before: h['tool.execute.before'] as Before, after: h['tool.execute.after'] as never, event: h.event as EventHook, aborts }
}

const task = (b: Before, sessionID: string, subagent_type: unknown) =>
  b({ tool: 'task', sessionID, callID: 'c-task' }, { args: { subagent_type, prompt: 'x', description: 'd' } })

describe('lazunox-subagent-guard: task no puede dar más libertad que el padre', () => {
  const rootOf = (agent: string, extra: Partial<World> = {}): World => ({
    sessions: { root: { id: 'root' } },
    userAgent: { root: agent },
    ...extra
  })

  it('tasks → lazunox-helper (solo lectura) pasa', async () => {
    const g = await load(rootOf('tasks'))
    await expect(task(g.before, 'root', 'lazunox-helper')).resolves.toBeUndefined()
  })

  it('tasks → general queda bloqueado (rm/git push/webfetch del padre no se heredan)', async () => {
    const g = await load(rootOf('tasks'))
    await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bloqueado por Lazunox.*mas libertad/)
  })

  it('el incidente de la prueba real: padre con bash: deny → general bloqueado', async () => {
    const g = await load(rootOf('bashdenied'))
    await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bash/)
    await expect(task(g.before, 'root', 'lazunox-helper')).resolves.toBeUndefined()
  })

  it('plan y build pueden lanzar lazunox-helper (mismas excepciones de .env que los integrados)', async () => {
    await expect(task((await load(rootOf('plan'))).before, 'root', 'lazunox-helper')).resolves.toBeUndefined()
    await expect(task((await load(rootOf('build'))).before, 'root', 'lazunox-helper')).resolves.toBeUndefined()
  })

  it('padre plan (edit: deny) no puede lanzar general; build → general (igual libertad) sí', async () => {
    await expect(task((await load(rootOf('plan'))).before, 'root', 'general')).rejects.toThrow(/edit/)
    await expect(task((await load(rootOf('build'))).before, 'root', 'general')).resolves.toBeUndefined()
  })

  it('chat (todo denegado salvo web) no puede lanzar nada con más libertad, aunque se le abriera task', async () => {
    const g = await load(rootOf('chat'))
    await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bloqueado/)
    await expect(task(g.before, 'root', 'explore')).rejects.toThrow(/read/) // chat no lee archivos
  })

  it('Chat con subagentes (F8-B206): chat → lazunox-chat-helper pasa; chat → general / explore / lazunox-helper, bloqueado', async () => {
    const g = await load(rootOf('chatsub'))
    await expect(task(g.before, 'root', 'lazunox-chat-helper')).resolves.toBeUndefined()
    await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bloqueado/)
    await expect(task(g.before, 'root', 'explore')).rejects.toThrow(/bloqueado/)
    await expect(task(g.before, 'root', 'lazunox-helper')).rejects.toThrow(/read/)
    // El `read` centinela del ayudante cuenta: frente a un padre SIN él (CHAT simplificado), el guardián lo ve como escalada.
    await expect(task((await load(rootOf('chat'))).before, 'root', 'lazunox-chat-helper')).rejects.toThrow(/__lazunox_sin_acceso__/)
  })

  it('el ayudante del Chat lanzado por una hija del Chat sigue sin poder lanzar nada (task: deny añadido por el motor)', async () => {
    const g = await load({
      sessions: { root: { id: 'root' }, kid: { id: 'kid', parentID: 'root', agent: 'lazunox-chat-helper' } },
      userAgent: { root: 'chatsub' }
    })
    await expect(task(g.before, 'kid', 'lazunox-chat-helper')).resolves.toBeUndefined()
    await expect(task(g.before, 'kid', 'general')).rejects.toThrow(/bloqueado/)
  })

  it('computer (Control total) → general / explore: bloqueado o denegado (computer.md ya tiene task: deny)', async () => {
    expect(AGENTS.computer.some((x) => x.permission === 'task' && x.action === 'deny')).toBe(true)
    const g = await load(rootOf('computer'))
    await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bloqueado/)
  })

  it('las reglas deny de session.permission del padre cuentan: la hija las hereda y no hay escalada', async () => {
    const g = await load({
      sessions: { root: { id: 'root', permission: [r('bash', 'deny')] } },
      userAgent: { root: 'build' }
    })
    await expect(task(g.before, 'root', 'general')).resolves.toBeUndefined()
  })

  it('una hija (parentID) usa session.agent como agente padre', async () => {
    const g = await load({
      sessions: { root: { id: 'root' }, kid: { id: 'kid', parentID: 'root', agent: 'lazunox-helper' } },
      userAgent: { root: 'build' }
    })
    await expect(task(g.before, 'kid', 'general')).rejects.toThrow(/lazunox-helper/)
  })

  it('fail-closed: agente destino inexistente, sin subagent_type, sesión o agente padre desconocidos', async () => {
    const g = await load(rootOf('tasks'))
    await expect(task(g.before, 'root', 'no-existe')).rejects.toThrow(/no existe/)
    await expect(task(g.before, 'root', undefined)).rejects.toThrow(/subagent_type/)
    await expect(task(g.before, 'fantasma', 'lazunox-helper')).rejects.toThrow(/sesion desconocida/)
    const g2 = await load({ sessions: { root: { id: 'root' } } }) // sin mensajes de usuario ni session.agent
    await expect(task(g2.before, 'root', 'lazunox-helper')).rejects.toThrow(/agente que lo lanza/)
  })

  it('F8-B208: si el plugin no alcanza a su propio motor (Seatbelt sin salida al puerto), se bloquea con un motivo distinto', async () => {
    for (const sessionFail of ['throw', 'noresponse'] as const) {
      const g = await load(rootOf('tasks', { sessionFail }))
      // Fail-closed: ni siquiera el ayudante de solo lectura pasa sin poder leer la sesión.
      await expect(task(g.before, 'root', 'lazunox-helper')).rejects.toThrow(/no se pudo consultar la sesion al motor/)
      await expect(task(g.before, 'root', 'general')).rejects.toThrow(/bloqueado por Lazunox/)
    }
    // El motor responde (404): sigue siendo «sesión desconocida».
    await expect(task((await load(rootOf('tasks', { sessionFail: '404' }))).before, 'root', 'lazunox-helper')).rejects.toThrow(
      /sesion desconocida/
    )
    // Con el motor alcanzable (perfil corregido) el mismo caso pasa y `general` sigue bloqueado.
    const ok = await load(rootOf('tasks'))
    await expect(task(ok.before, 'root', 'lazunox-helper')).resolves.toBeUndefined()
    await expect(task(ok.before, 'root', 'general')).rejects.toThrow(/mas libertad/)
  })

  it('fail-closed: error del motor al listar agentes o cliente sin app', async () => {
    await expect(task((await load(rootOf('tasks', { agentsFail: true }))).before, 'root', 'lazunox-helper')).rejects.toThrow(
      /lista de agentes/
    )
    await expect(task((await load(rootOf('tasks', { noApp: true }))).before, 'root', 'lazunox-helper')).rejects.toThrow(/bloqueado/)
  })

  it('no toca otras herramientas', async () => {
    const g = await load(rootOf('plan'))
    await expect(g.before({ tool: 'bash', sessionID: 'root', callID: 'c1' }, { args: {} })).resolves.toBeUndefined()
    await expect(g.before({ tool: 'prueba_leer', sessionID: 'nada', callID: 'c2/0' }, { args: {} })).resolves.toBeUndefined()
  })
})

describe('agentes empaquetados: contención estática', () => {
  const taskRules = (a: string): Rule[] => AGENTS[a].filter((x) => x.permission === 'task')
  it('tasks solo puede lanzar lazunox-helper (lista blanca explícita, no allow global)', () => {
    expect(taskRules('tasks')).toEqual([r('task', 'deny'), r('task', 'allow', 'lazunox-helper')])
  })
  it('computer deniega task; lazunox-helper es solo lectura y no lanza subagentes', () => {
    expect(taskRules('computer')).toEqual([r('task', 'deny')])
    const h = AGENTS['lazunox-helper']
    expect(h[0]).toEqual(r('*', 'deny'))
    for (const x of h.slice(1)) expect(['read', 'glob', 'grep', 'list']).toContain(x.permission)
    expect(h.filter((x) => x.permission === 'read' && x.pattern === '*.env').map((x) => x.action)).toEqual(['ask'])
    for (const tool of ['bash', 'edit', 'write', 'webfetch', 'task', 'computer_x', 'browser_x']) {
      const hit = [...h].reverse().find((x) => x.permission === tool || x.permission === '*')
      expect(hit?.action).toBe('deny')
    }
  })
})

describe('lazunox-subagent-guard: rechazo dentro de execute (Code Mode)', () => {
  const asked = (id: string, sessionID: string, callID: string, permission = 'prueba_leer') => ({
    type: 'permission.asked',
    properties: { id, sessionID, permission, patterns: ['*'], always: ['*'], tool: { messageID: 'm', callID } }
  })
  const replied = (requestID: string, sessionID: string, reply: string) => ({
    type: 'permission.replied',
    properties: { sessionID, requestID, reply }
  })
  const inner = (b: Before, sid: string, call: string, tool = 'prueba_leer') => b({ tool, sessionID: sid, callID: call }, { args: {} })

  it('reject de una llamada interna: se bloquean las siguientes del mismo execute y se aborta la sesión', async () => {
    const g = await load({ sessions: {} })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await inner(g.before, 's1', 'ex1/0') // antes del rechazo pasa
    await g.event({ event: asked('p1', 's1', 'ex1') })
    await g.event({ event: replied('p1', 's1', 'reject') })
    await expect(inner(g.before, 's1', 'ex1/1', 'prueba_suma')).rejects.toThrow(/rechazo un permiso/)
    await expect(inner(g.before, 's1', 'ex1/2', 'bash')).rejects.toThrow(/rechazo un permiso/)
    expect(g.aborts).toEqual(['s1'])
  })

  it('otro execute de la misma sesión, y otras sesiones, no quedan afectados', async () => {
    const g = await load({ sessions: {} })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await g.before({ tool: 'execute', sessionID: 's2', callID: 'ex9' }, { args: {} })
    await g.event({ event: asked('p1', 's1', 'ex1') })
    await g.event({ event: replied('p1', 's1', 'reject') })
    await expect(inner(g.before, 's2', 'ex9/0')).resolves.toBeUndefined()
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex2' }, { args: {} }) // un execute NUEVO (otro turno)
    await expect(inner(g.before, 's1', 'ex2/0')).resolves.toBeUndefined()
  })

  it('permitir una vez / siempre no revoca nada', async () => {
    const g = await load({ sessions: {} })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await g.event({ event: asked('p1', 's1', 'ex1') })
    await g.event({ event: replied('p1', 's1', 'once') })
    await g.event({ event: asked('p2', 's1', 'ex1') })
    await g.event({ event: replied('p2', 's1', 'always') })
    await expect(inner(g.before, 's1', 'ex1/3')).resolves.toBeUndefined()
    expect(g.aborts).toEqual([])
  })

  it('un reject fuera de execute (herramienta normal) o del propio permiso `execute` no aborta ni bloquea', async () => {
    const g = await load({ sessions: {} })
    await g.event({ event: asked('p1', 's1', 'bash-call', 'bash') })
    await g.event({ event: replied('p1', 's1', 'reject') })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await g.event({ event: asked('p2', 's1', 'ex1', 'execute') })
    await g.event({ event: replied('p2', 's1', 'reject') })
    await expect(inner(g.before, 's1', 'ex1/0')).resolves.toBeUndefined()
    expect(g.aborts).toEqual([])
  })

  it('reject sin `asked` previo: se revocan los execute en curso de esa sesión (conservador)', async () => {
    const g = await load({ sessions: {} })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await g.event({ event: replied('desconocido', 's1', 'reject') })
    await expect(inner(g.before, 's1', 'ex1/0')).rejects.toThrow(/rechazo un permiso/)
  })

  it('al terminar el execute (after) se limpia el estado', async () => {
    const g = await load({ sessions: {} })
    await g.before({ tool: 'execute', sessionID: 's1', callID: 'ex1' }, { args: {} })
    await g.event({ event: asked('p1', 's1', 'ex1') })
    await g.event({ event: replied('p1', 's1', 'reject') })
    await g.after({ tool: 'execute', sessionID: 's1', callID: 'ex1' })
    await expect(inner(g.before, 's1', 'ex1/0')).resolves.toBeUndefined()
  })
})

describe('lazunox-subagent-guard por el canal de solo lectura de main (Tareas con sandbox, F8-B208)', () => {
  // Cliente del motor que falla como dentro de Seatbelt (sin salida al puerto del motor): en este camino NO se usa.
  const sandboxedClient = {
    session: {
      get: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EPERM' } })
      },
      messages: async () => {
        throw new TypeError('fetch failed')
      },
      abort: async () => ({})
    },
    app: {
      agents: async () => {
        throw new TypeError('fetch failed')
      }
    }
  }
  const ROOT = 'ses_rootAAAAAAAAAAAAAAAA'
  const KID = 'ses_kidBBBBBBBBBBBBBBBBB'
  const engineSessions: Record<string, unknown> = {
    [ROOT]: { id: ROOT, agent: 'tasks', permission: [] },
    [KID]: { id: KID, parentID: ROOT, agent: 'lazunox-helper', permission: [] }
  }
  let engineDown = false
  let agentsBroken = false
  // Motor simulado al que llama MAIN (no el plugin): sesión, mensajes y agentes del 1.19.
  const engineFetch = (async (input: string | URL) => {
    if (engineDown) throw new TypeError('fetch failed')
    const path = new URL(String(input)).pathname
    const body = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
    if (path === '/agent') {
      return agentsBroken
        ? body({}, 500)
        : body(Object.entries(AGENTS).map(([name, permission]) => ({ name, mode: 'subagent', permission })))
    }
    const m = /^\/session\/([^/]+)(\/message)?$/.exec(path)
    if (m && engineSessions[m[1]!])
      return m[2] ? body([{ info: { role: 'user', agent: 'tasks', time: { created: 1 } } }]) : body(engineSessions[m[1]!])
    return body({ name: 'NotFoundError' }, 404)
  }) as typeof fetch

  async function loadChannel(opts: { token?: string; ready?: boolean } = {}): Promise<{ before: Before }> {
    const p = new McpProxy()
    await p.start()
    const g = p.setLocalHandler(
      GUARD_PATH_PREFIX,
      createGuardInfoHandler({
        server: () => (opts.ready === false ? null : { baseUrl: 'http://127.0.0.1:1', authorization: 'Basic x', directory: '/d' }),
        fetchImpl: engineFetch
      })
    )
    cleanups.push(() => p.stop())
    const prev = { url: process.env.LAZUNOX_GUARD_URL, token: process.env.LAZUNOX_GUARD_TOKEN }
    process.env.LAZUNOX_GUARD_URL = g.url
    process.env.LAZUNOX_GUARD_TOKEN = opts.token ?? g.token
    try {
      const file = join(dir, `guard-ch-${n++}.mjs`)
      writeFileSync(file, subagentGuardPluginSource(), 'utf8')
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        default: { server: (i: unknown) => Promise<Record<string, unknown>> }
      }
      const h = await mod.default.server({ client: sandboxedClient })
      return { before: h['tool.execute.before'] as Before }
    } finally {
      if (prev.url === undefined) delete process.env.LAZUNOX_GUARD_URL
      else process.env.LAZUNOX_GUARD_URL = prev.url
      if (prev.token === undefined) delete process.env.LAZUNOX_GUARD_TOKEN
      else process.env.LAZUNOX_GUARD_TOKEN = prev.token
    }
  }
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    engineDown = false
    agentsBroken = false
    await Promise.all(cleanups.splice(0).map((f) => f()))
  })

  it('con el canal: tasks → lazunox-helper pasa y tasks → general sigue bloqueado (sin tocar el cliente del motor)', async () => {
    const g = await loadChannel()
    await expect(task(g.before, ROOT, 'lazunox-helper')).resolves.toBeUndefined()
    await expect(task(g.before, ROOT, 'general')).rejects.toThrow(/mas libertad/)
    // Una hija (lazunox-helper) no puede lanzar general.
    await expect(task(g.before, KID, 'general')).rejects.toThrow(/bloqueado por Lazunox/)
  })

  it('fail-closed por el canal: sesión inexistente o malformada = «sesion desconocida»; motor caído, token malo o servidor no listo = «no se pudo consultar»', async () => {
    const g = await loadChannel()
    await expect(task(g.before, 'ses_noexisteCCCCCCCCCC', 'lazunox-helper')).rejects.toThrow(/sesion desconocida/)
    await expect(task(g.before, '../config', 'lazunox-helper')).rejects.toThrow(/sesion desconocida/)
    engineDown = true
    await expect(task(g.before, ROOT, 'lazunox-helper')).rejects.toThrow(/no se pudo consultar la sesion al motor/)
    engineDown = false
    await expect(task((await loadChannel({ token: 'robado-o-falso' })).before, ROOT, 'lazunox-helper')).rejects.toThrow(
      /no se pudo consultar la sesion al motor/
    )
    await expect(task((await loadChannel({ ready: false })).before, ROOT, 'lazunox-helper')).rejects.toThrow(
      /no se pudo consultar la sesion al motor/
    )
    agentsBroken = true
    await expect(task((await loadChannel()).before, ROOT, 'lazunox-helper')).rejects.toThrow(/lista de agentes/)
  })

  it('sin canal y con el cliente bloqueado por Seatbelt (el fallo original): bloquea con «no se pudo consultar»', async () => {
    const file = join(dir, `guard-nc-${n++}.mjs`)
    writeFileSync(file, subagentGuardPluginSource(), 'utf8')
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      default: { server: (i: unknown) => Promise<Record<string, unknown>> }
    }
    const h = await mod.default.server({ client: sandboxedClient })
    await expect(task(h['tool.execute.before'] as Before, ROOT, 'lazunox-helper')).rejects.toThrow(
      /no se pudo consultar la sesion al motor/
    )
  })
})
