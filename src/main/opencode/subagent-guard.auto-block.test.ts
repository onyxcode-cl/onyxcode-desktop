/**
 * W-A1 (1.8.12): con el bloque «Automático» NUEVO como reglas de la sesión del padre (con los `ask` de .git, opencode.json y .opencode/*),
 * el guardián de subagentes (`subagent-guard.ts`, zona intocable: solo se prueba, no se toca) sigue bloqueando a `general` (que traería
 * `*: allow` y editaría esos archivos sin preguntar). `explore` también se bloquea: el padre pregunta `read mcp:*` y los `.env`, y `read: allow` de explore es más libertad.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rulesetForMode } from '../../shared/permission-rules'
import { subagentGuardPluginSource } from './subagent-guard'

type Action = 'allow' | 'ask' | 'deny'
interface Rule {
  permission: string
  pattern: string
  action: Action
}
type Before = (input: { tool: string; sessionID?: string; callID?: string }, output: { args: Record<string, unknown> }) => Promise<void>

const r = (permission: string, action: Action, pattern = '*'): Rule => ({ permission, pattern, action })
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
const EXPLORE: Rule[] = [r('*', 'deny'), r('read', 'allow'), r('grep', 'allow'), r('glob', 'allow'), r('list', 'allow')]
const AGENTS: Record<string, Rule[]> = { build: BUILD, general: GENERAL, explore: EXPLORE }

let dir = ''
let n = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-guard-auto-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function load(parentRules: Rule[]): Promise<Before> {
  const client = {
    session: {
      get: async () => ({ data: { id: 'root', permission: parentRules } }),
      messages: async () => ({ data: [{ info: { role: 'user', agent: 'build', time: { created: 1 } } }] }),
      abort: async () => ({ data: true })
    },
    app: {
      agents: async () => ({ data: Object.entries(AGENTS).map(([name, permission]) => ({ name, mode: 'subagent', permission })) })
    }
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

describe('guardián de subagentes con el bloque «Automático» nuevo (W-A1)', () => {
  const auto = rulesetForMode('auto') as Rule[]

  it('el bloque nuevo lleva los ask de .git, opencode.json y .opencode/*', () => {
    for (const p of ['.git', '*/.git/*', 'opencode.json', '*/opencode.jsonc', '.opencode/*', '*/.opencode/*']) {
      expect(
        auto.some((x) => x.permission === 'edit' && x.pattern === p && x.action === 'ask'),
        p
      ).toBe(true)
    }
  })
  it('task(general) queda bloqueado: traería más libertad que el padre', async () => {
    const b = await load([...BUILD, ...auto])
    await expect(task(b, 'general')).rejects.toThrow(/bloqueado por Lazunox/)
  })
  it('task(explore) también queda bloqueado (el padre pregunta `read mcp:*` y `.env`; explore los permite)', async () => {
    const b = await load([...BUILD, ...auto])
    await expect(task(b, 'explore')).rejects.toThrow(/bloqueado por Lazunox/)
  })
  it('lo mismo con el bloque de «Editar sin preguntar»', async () => {
    const b = await load([...BUILD, ...(rulesetForMode('acceptEdits') as Rule[])])
    await expect(task(b, 'general')).rejects.toThrow(/bloqueado por Lazunox/)
  })
})
