/**
 * W-A3 (1.8.12, decisión D5=A): en Code el ayudante `general` declara «preguntar» (bloque `agent.general.permission` de `buildInlineConfig`)
 * y el guardián de subagentes (`subagent-guard.ts`, zona intocable: solo se ejecuta, no se toca) lo deja pasar con un padre `build` en los
 * cuatro modos. Ejecuta el texto REAL del plugin. Los permisos de `general` se arman como los arma el motor 1.19 (agent.ts): defaults del
 * motor + `todowrite: allow` + permisos de la config (bgshell/documentos) + lo DECLARADO por la app AL FINAL (`Permission.merge`).
 * Lo que decide de verdad es el motor real: `PROBE_ONLY=olaA node scripts/engine-probe/run.mjs` (comprobación 1).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rulesetForMode } from '../../shared/permission-rules'
import { bgshellConfigPermission, bgshellSessionRules } from '../../shared/shell-bg-permissions'
import { documentsConfigPermission, documentsSessionRules } from '../../shared/documents-permissions'
import { buildInlineConfig } from './config'
import { subagentGuardPluginSource } from './subagent-guard'

type Action = 'allow' | 'ask' | 'deny'
interface Rule {
  permission: string
  pattern: string
  action: Action
}
type Before = (input: { tool: string; sessionID?: string; callID?: string }, output: { args: Record<string, unknown> }) => Promise<void>

/** Mismas reglas de sesión que envía Code (`rulesetFor` del renderer): bgshell + documentos + bloque del modo. */
const rulesetFor = (mode: 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'bypass'): Rule[] =>
  [...bgshellSessionRules(mode), ...documentsSessionRules(mode), ...rulesetForMode(mode)] as Rule[]

const r = (permission: string, action: Action, pattern = '*'): Rule => ({ permission, pattern, action })

/** Como `Permission.fromConfig` del motor: texto → patrón `*`; mapa → una regla por patrón, en el orden escrito. */
function fromConfig(perm: Record<string, unknown>): Rule[] {
  const out: Rule[] = []
  for (const [k, v] of Object.entries(perm)) {
    if (typeof v === 'string') out.push(r(k, v as Action))
    else if (v && typeof v === 'object') for (const [p, a] of Object.entries(v as Record<string, string>)) out.push(r(k, a as Action, p))
  }
  return out
}

/** Defaults del motor (agent.ts) + permisos de la config inline que la app pasa a TODOS los agentes (server.ts: bgshell y documentos). */
const DEFAULTS: Rule[] = [
  r('*', 'allow'),
  r('doom_loop', 'ask'),
  r('external_directory', 'ask'),
  r('question', 'deny'),
  r('read', 'allow'),
  r('read', 'ask', '*.env'),
  r('read', 'ask', '*.env.*'),
  r('read', 'allow', '*.env.example')
]
const CONFIG: Rule[] = fromConfig({ ...bgshellConfigPermission(), ...documentsConfigPermission() })
const BUILD: Rule[] = [...DEFAULTS.map((x) => (x.permission === 'question' ? r('question', 'allow') : x)), ...CONFIG]
const declarado = (): Rule[] => {
  const agent = (buildInlineConfig() as { agent: Record<string, { permission?: Record<string, unknown> }> }).agent
  return fromConfig(agent.general?.permission ?? {})
}
/** `general` según el motor: defaults, `todowrite: allow`, config, y lo declarado por la app al final. */
const general = (): Rule[] => [...DEFAULTS, r('todowrite', 'allow'), ...CONFIG, ...declarado()]
const EXPLORE: Rule[] = [r('*', 'deny'), r('read', 'allow'), r('grep', 'allow'), r('glob', 'allow'), r('list', 'allow')]
const HELPER: Rule[] = [
  r('*', 'deny'),
  r('read', 'allow'),
  r('read', 'ask', '*.env'),
  r('read', 'ask', '*.env.*'),
  r('read', 'allow', '*.env.example'),
  r('read', 'deny', 'mcp:*'),
  r('glob', 'allow'),
  r('grep', 'allow'),
  r('list', 'allow')
]
const PLAN: Rule[] = [...BUILD, r('edit', 'deny'), r('task', 'deny', 'general')]
const CHAT: Rule[] = [r('*', 'deny'), r('webfetch', 'allow'), r('websearch', 'allow'), r('question', 'allow')]

let dir = ''
let n = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-guard-modes-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function load(parentAgent: string, parentAgentRules: Rule[], session: Rule[], gen: Rule[] = general()): Promise<Before> {
  const agents: Record<string, Rule[]> = {
    build: BUILD,
    plan: PLAN,
    chat: CHAT,
    general: gen,
    explore: EXPLORE,
    'lazunox-helper': HELPER
  }
  agents[parentAgent] = parentAgentRules
  const client = {
    session: {
      get: async () => ({ data: { id: 'root', permission: session } }),
      messages: async () => ({ data: [{ info: { role: 'user', agent: parentAgent, time: { created: 1 } } }] }),
      abort: async () => ({ data: true })
    },
    app: { agents: async () => ({ data: Object.entries(agents).map(([name, permission]) => ({ name, mode: 'subagent', permission })) }) }
  }
  const file = join(dir, `guard-${n++}.mjs`)
  writeFileSync(file, subagentGuardPluginSource(), 'utf8')
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default: { server: (i: unknown) => Promise<Record<string, unknown>> }
  }
  const h = await mod.default.server({ client })
  return h['tool.execute.before'] as Before
}
const task = (b: Before, subagent_type: string) =>
  b({ tool: 'task', sessionID: 'root', callID: 'c-task' }, { args: { subagent_type, prompt: 'x', description: 'd' } })

describe('W-A3: general en Code (el guardián lo deja pasar porque declara «preguntar»)', () => {
  it('el bloque declarado pregunta en todo lo que cambia el mundo y deniega lanzar más ayudantes', () => {
    const d = declarado()
    for (const k of ['edit', 'write', 'bash', 'webfetch', 'websearch', 'external_directory'])
      expect(d.find((x) => x.permission === k && x.pattern === '*')?.action, k).toBe('ask')
    expect(d.find((x) => x.permission === 'read' && x.pattern === 'mcp:*')?.action).toBe('ask')
    expect(d.find((x) => x.permission === 'read' && x.pattern === '*.env')?.action).toBe('ask')
    expect(d.find((x) => x.permission === 'read' && x.pattern === '*.env.example')?.action).toBe('allow')
    expect(d.find((x) => x.permission === 'task')?.action).toBe('deny')
    // Nada de `allow` en lo que cambia el mundo: lo único `allow` es leer.
    expect(d.filter((x) => x.action === 'allow').every((x) => x.permission === 'read')).toBe(true)
  })

  for (const mode of ['manual', 'acceptEdits', 'auto', 'bypass'] as const) {
    it(`padre build en «${mode}»: task(general) pasa`, async () => {
      const b = await load('build', BUILD, rulesetFor(mode))
      await expect(task(b, 'general')).resolves.toBeUndefined()
    })
  }

  it('sin el bloque nuevo (permisos del motor a secas) sigue bloqueado en los tres modos que preguntan: la prueba no pasa en vacío', async () => {
    const sinBloque = [...DEFAULTS, r('todowrite', 'allow'), ...CONFIG]
    for (const mode of ['manual', 'acceptEdits', 'auto'] as const) {
      const b = await load('build', BUILD, rulesetFor(mode), sinBloque)
      await expect(task(b, 'general')).rejects.toThrow(/bloqueado por Lazunox/)
    }
  })

  it('Solo explorar: padre plan (edit deny del agente) bloqueado por el guardián; con padre build lo para la regla `task general deny` de la sesión', async () => {
    await expect(task(await load('plan', PLAN, []), 'general')).rejects.toThrow(/edit/)
    // Con el bloque plan en la SESIÓN el guardián deja pasar (la hija heredaría `edit deny`, el motor copia los deny) y el que para es el `task general: deny`.
    const plan = rulesetFor('plan')
    expect(plan.filter((x) => x.permission === 'task' && x.pattern === 'general').at(-1)?.action).toBe('deny')
    expect(plan.filter((x) => x.permission === 'edit' && x.pattern === '*').at(-1)?.action).toBe('deny')
  })

  it('Chat (todo denegado salvo web) sigue sin poder lanzar general', async () => {
    await expect(task(await load('chat', CHAT, []), 'general')).rejects.toThrow(/bloqueado por Lazunox/)
  })

  it('un padre que deniega en su AGENTE (bash deny, sin reglas de sesión) bloquea a general: nunca más libertad que quien lo lanza', async () => {
    await expect(task(await load('build', [...BUILD, r('bash', 'deny')], []), 'general')).rejects.toThrow(/bash/)
    await expect(task(await load('build', [...BUILD, r('write', 'deny', 'secreto/*')], []), 'general')).rejects.toThrow(/write secreto/)
  })

  it('lazunox-helper sigue pasando y explore sigue como estaba (bloqueado en modos que preguntan `read mcp:*`)', async () => {
    for (const mode of ['manual', 'acceptEdits', 'auto', 'bypass'] as const) {
      const b = await load('build', BUILD, rulesetFor(mode))
      await expect(task(b, 'lazunox-helper')).resolves.toBeUndefined()
    }
    await expect(task(await load('build', BUILD, rulesetFor('auto') as Rule[]), 'explore')).rejects.toThrow(/bloqueado por Lazunox/)
  })
})
