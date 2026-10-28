/**
 * Agentes del bundle y refresco de `userData/opencode-config/agents/`: al cambiar de versión, el
 * agente antiguo (con el nombre anterior) debe BORRARSE (si no, OpenCode seguiría cargando un agente huérfano).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_AGENT_ID } from '../migrations/legacy-names'

let userData = ''
let version = '0.2.2'

vi.mock('electron', () => ({
  net: {},
  app: {
    getPath: () => userData,
    getAppPath: () => process.cwd(),
    isPackaged: true,
    getVersion: () => version
  }
}))

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lazunox-ocfg-'))
  vi.resetModules()
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

const agentsOf = (dir: string): string[] => readdirSync(join(dir, 'agents')).sort()

describe('agentes del bundle', () => {
  it('los ids del bundle son exactamente chat, computer, lazunox-chat-helper, lazunox-helper y tasks', async () => {
    const { getBundledOpencodeDir } = await import('./opencode-config')
    const ids = readdirSync(join(getBundledOpencodeDir(), 'agents'))
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.replace(/\.md$/, ''))
      .sort()
    expect(ids).toEqual(['chat', 'computer', 'lazunox-chat-helper', 'lazunox-helper', 'tasks'])
  })
})

describe('prepareOpencodeConfigDir: refresco por versión', () => {
  it('borra agents/tasks.md heredado y deja los agentes del bundle', async () => {
    const dest = join(userData, 'opencode-config')
    mkdirSync(join(dest, 'agents'), { recursive: true })
    writeFileSync(join(dest, 'agents', `${LEGACY_AGENT_ID}.md`), 'agente viejo')
    writeFileSync(join(dest, 'agents', 'chat.md'), 'viejo')
    writeFileSync(join(dest, '.lazunox-version'), '0.2.2')
    version = '0.3.0'
    const { prepareOpencodeConfigDir } = await import('./opencode-config')
    const dir = prepareOpencodeConfigDir()
    expect(existsSync(join(dir, 'agents', `${LEGACY_AGENT_ID}.md`))).toBe(false)
    expect(agentsOf(dir)).toEqual(['chat.md', 'computer.md', 'lazunox-chat-helper.md', 'lazunox-helper.md', 'tasks.md'])
    expect(readFileSync(join(dir, 'agents', 'chat.md'), 'utf8')).not.toBe('viejo')
    expect(readFileSync(join(dir, '.lazunox-version'), 'utf8')).toBe('0.3.0')
  })
})

describe('getOpencodeEnv', () => {
  it('XDG_DATA_HOME apunta al almacén propio <userData>/opencode-data', async () => {
    const { getOpencodeEnv } = await import('./opencode-config')
    expect(getOpencodeEnv().XDG_DATA_HOME).toBe(join(userData, 'opencode-data'))
  })
})

describe('plugin lazunox-session escrito en la carpeta de config', () => {
  const FLAG = 'LAZUNOX_UNIFIED_APPS'
  afterEach(() => {
    delete process.env[FLAG]
  })

  it('con LAZUNOX_UNIFIED_APPS=0: byte a byte el de siempre', async () => {
    process.env[FLAG] = '0'
    const { prepareOpencodeConfigDir, sessionPluginSource } = await import('./opencode-config')
    const dir = prepareOpencodeConfigDir()
    const text = readFileSync(join(dir, 'plugins', 'lazunox-session.js'), 'utf8')
    expect(text).toBe(sessionPluginSource(false))
    expect(text).not.toContain('computer_')
  })

  it('con bandera: inyecta la sesión en computer_* solo en servidores con puente, sin activar la puerta del plan', async () => {
    process.env[FLAG] = '1'
    const { prepareOpencodeConfigDir, planGatePluginSource } = await import('./opencode-config')
    const dir = prepareOpencodeConfigDir()
    const text = readFileSync(join(dir, 'plugins', 'lazunox-session.js'), 'utf8')
    expect(text).toContain("process.env.LAZUNOX_UNIFIED_BRIDGE === '1'")
    expect(text).toContain("input.tool.startsWith('computer_')")
    expect(text).not.toContain('PLAN_GATE')
    // la puerta del plan no cambia con la bandera
    expect(readFileSync(join(dir, 'plugins', 'lazunox-plan-gate.js'), 'utf8')).toBe(planGatePluginSource())
  })
})
