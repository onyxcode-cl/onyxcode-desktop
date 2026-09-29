/**
 * Caracterización del config inline de OpenCode (`buildInlineConfig`, usado por
 * `CoworkManager.inlineConfig`) ANTES del renombre `cowork` → `tasks`. Las claves
 * `agent.<id>.permission` son SEGURIDAD: si se renombra el agente sin moverlas, los permisos dejan
 * de aplicarse SIN AVISO. Estos tests fijan los permisos actuales, que existan para los ids
 * `COWORK_AGENT_ID`/`COMPUTER_AGENT_ID` y que ninguna clave de agente quede sin agente definido.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent', getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))

import { buildInlineConfig, type InlineConfigInput } from './inline-config'
import { CHAT_AGENT_ID, COMPUTER_AGENT_ID, COWORK_AGENT_ID } from './opencode-config'

const AGENTS_DIR = join(process.cwd(), 'resources', 'opencode', 'agents')
const definedAgents = (): string[] =>
  readdirSync(AGENTS_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => n.slice(0, -3))
    .sort()

const BROWSER = { type: 'remote', url: 'http://127.0.0.1:1234/mcp' }
const COMPUTER = { type: 'remote', url: 'http://127.0.0.1:5678/mcp' }
const MCP_PERM = { 'github_*': 'ask' }
const RULES_PERM = { bash: { 'npm test': 'allow' }, external_directory: { '/fixture/x/*': 'allow' } }

const empty: InlineConfigInput = {
  fullAccess: false,
  extras: [],
  browserMcp: null,
  computerMcp: null,
  mcpContribution: { mcp: {}, permission: {} },
  rulesPermission: {},
  skills: {}
}

type Agents = Record<string, { permission?: Record<string, unknown>; disable?: boolean }>
const agentsOf = (c: Record<string, unknown>): Agents => (c.agent ?? {}) as Agents

/** Todos los escenarios relevantes (sandbox/Control total × con y sin extras, MCP y reglas). */
const scenarios: Array<[string, InlineConfigInput]> = [
  ['sandbox vacío', empty],
  ['sandbox + extras', { ...empty, extras: [{ path: '/fixture/a' }, { path: '/fixture/b' }] }],
  ['sandbox + navegador', { ...empty, browserMcp: BROWSER }],
  [
    'sandbox + MCP usuario + reglas',
    { ...empty, mcpContribution: { mcp: { github: { type: 'local' } }, permission: MCP_PERM }, rulesPermission: RULES_PERM }
  ],
  ['control total vacío', { ...empty, fullAccess: true }],
  ['control total + computer + navegador', { ...empty, fullAccess: true, computerMcp: COMPUTER, browserMcp: BROWSER }],
  [
    'control total + todo',
    {
      ...empty,
      fullAccess: true,
      extras: [],
      computerMcp: COMPUTER,
      browserMcp: BROWSER,
      mcpContribution: { mcp: { github: { type: 'local' } }, permission: MCP_PERM },
      rulesPermission: RULES_PERM
    }
  ]
]

describe('buildInlineConfig: ids de agente', () => {
  it('los ids actuales son los del bundle de agentes', () => {
    expect(COWORK_AGENT_ID).toBe('cowork')
    expect(COMPUTER_AGENT_ID).toBe('computer')
    expect(definedAgents()).toEqual([CHAT_AGENT_ID, COMPUTER_AGENT_ID, COWORK_AGENT_ID].sort())
  })

  it.each(scenarios)('%s: toda clave agent.<id> tiene su agente definido (o es un disable del computer)', (_n, input) => {
    const defined = definedAgents()
    for (const id of Object.keys(agentsOf(buildInlineConfig(input)))) expect(defined).toContain(id)
  })

  it.each(scenarios)('%s: solo se tocan los agentes de tareas y computer, nunca chat', (_n, input) => {
    for (const id of Object.keys(agentsOf(buildInlineConfig(input)))) expect([COWORK_AGENT_ID, COMPUTER_AGENT_ID]).toContain(id)
  })
})

describe('buildInlineConfig: permisos del agente de tareas', () => {
  it('sandbox vacío: solo oculta el agente computer', () => {
    const c = buildInlineConfig(empty)
    expect(c).toEqual({ autoupdate: false, agent: { [COMPUTER_AGENT_ID]: { disable: true } } })
  })

  it('sandbox + extras: external_directory pregunta por defecto y permite las carpetas extra (orden importa)', () => {
    const c = buildInlineConfig({ ...empty, extras: [{ path: '/fixture/a' }, { path: '/fixture/b' }] })
    const perm = agentsOf(c)[COWORK_AGENT_ID].permission!
    expect(perm).toEqual({
      external_directory: { '*': 'ask', '/fixture/a': 'allow', '/fixture/a/*': 'allow', '/fixture/b': 'allow', '/fixture/b/*': 'allow' }
    })
    expect(Object.keys(perm.external_directory as object)[0]).toBe('*')
    expect(agentsOf(c)[COMPUTER_AGENT_ID]).toEqual({ disable: true })
  })

  it('sandbox: el navegador entra como MCP sin deny de browser_*', () => {
    const c = buildInlineConfig({ ...empty, browserMcp: BROWSER })
    expect(c.mcp).toEqual({ browser: BROWSER })
    expect(agentsOf(c)[COWORK_AGENT_ID]).toBeUndefined()
  })

  it('Control total: el agente de tareas deniega computer_* y browser_* (solo si hay navegador)', () => {
    const sin = buildInlineConfig({ ...empty, fullAccess: true, computerMcp: COMPUTER })
    expect(agentsOf(sin)[COWORK_AGENT_ID].permission).toEqual({ 'computer_*': 'deny' })
    expect(sin.mcp).toEqual({ computer: COMPUTER })
    const con = buildInlineConfig({ ...empty, fullAccess: true, computerMcp: COMPUTER, browserMcp: BROWSER })
    expect(agentsOf(con)[COWORK_AGENT_ID].permission).toEqual({ 'computer_*': 'deny', 'browser_*': 'deny' })
    expect(con.mcp).toEqual({ computer: COMPUTER, browser: BROWSER })
    // Control total: el agente computer NO se deshabilita.
    expect(agentsOf(con)[COMPUTER_AGENT_ID]).toBeUndefined()
  })

  it('Control total sin ningún MCP: mantiene igualmente el deny de computer_*', () => {
    const c = buildInlineConfig({ ...empty, fullAccess: true })
    expect(c.mcp).toBeUndefined()
    expect(agentsOf(c)[COWORK_AGENT_ID].permission).toEqual({ 'computer_*': 'deny' })
  })

  it('permisos de MCP del usuario y reglas recordadas: idénticos en el agente de tareas y en computer', () => {
    const c = buildInlineConfig({
      ...empty,
      extras: [{ path: '/fixture/a' }],
      mcpContribution: { mcp: { github: { type: 'local' } }, permission: MCP_PERM },
      rulesPermission: RULES_PERM
    })
    const a = agentsOf(c)
    expect(a[COWORK_AGENT_ID].permission).toEqual({
      external_directory: {
        '*': 'ask',
        '/fixture/a': 'allow',
        '/fixture/a/*': 'allow',
        ...RULES_PERM.external_directory
      },
      ...MCP_PERM,
      bash: RULES_PERM.bash
    })
    expect(a[COMPUTER_AGENT_ID].permission).toEqual({ ...MCP_PERM, ...RULES_PERM })
    expect(a[COMPUTER_AGENT_ID].disable).toBe(true)
    expect(c.mcp).toEqual({ github: { type: 'local' } })
  })

  it('las reglas recordadas no pueden quitar el deny de computer_*/browser_* en Control total', () => {
    const c = buildInlineConfig({
      ...empty,
      fullAccess: true,
      computerMcp: COMPUTER,
      browserMcp: BROWSER,
      rulesPermission: { bash: { ls: 'allow' } }
    })
    expect(agentsOf(c)[COWORK_AGENT_ID].permission).toMatchObject({ 'computer_*': 'deny', 'browser_*': 'deny', bash: { ls: 'allow' } })
  })

  it.each(scenarios)('%s: snapshot completo del config', (_n, input) => {
    expect(buildInlineConfig(input)).toMatchSnapshot()
  })
})

describe('buildInlineConfig: pureza', () => {
  it('no muta las entradas y es determinista', () => {
    const input: InlineConfigInput = {
      ...empty,
      mcpContribution: { mcp: {}, permission: { ...MCP_PERM } },
      rulesPermission: structuredClone(RULES_PERM)
    }
    const before = JSON.stringify(input)
    const a = buildInlineConfig(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(buildInlineConfig(input))).toBe(JSON.stringify(a))
  })
})
