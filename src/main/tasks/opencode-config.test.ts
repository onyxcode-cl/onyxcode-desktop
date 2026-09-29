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
  app: {
    getPath: () => userData,
    getAppPath: () => process.cwd(),
    isPackaged: true,
    getVersion: () => version
  }
}))

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'onyx-ocfg-'))
  vi.resetModules()
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

const agentsOf = (dir: string): string[] => readdirSync(join(dir, 'agents')).sort()

describe('agentes del bundle', () => {
  it('los ids del bundle son exactamente chat, computer y tasks', async () => {
    const { getBundledOpencodeDir } = await import('./opencode-config')
    const ids = readdirSync(join(getBundledOpencodeDir(), 'agents'))
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.replace(/\.md$/, ''))
      .sort()
    expect(ids).toEqual(['chat', 'computer', 'tasks'])
  })
})

describe('prepareOpencodeConfigDir: refresco por versión', () => {
  it('borra agents/tasks.md heredado y deja los agentes del bundle', async () => {
    const dest = join(userData, 'opencode-config')
    mkdirSync(join(dest, 'agents'), { recursive: true })
    writeFileSync(join(dest, 'agents', `${LEGACY_AGENT_ID}.md`), 'agente viejo')
    writeFileSync(join(dest, 'agents', 'chat.md'), 'viejo')
    writeFileSync(join(dest, '.onyxcode-version'), '0.2.2')
    version = '0.3.0'
    const { prepareOpencodeConfigDir } = await import('./opencode-config')
    const dir = prepareOpencodeConfigDir()
    expect(existsSync(join(dir, 'agents', `${LEGACY_AGENT_ID}.md`))).toBe(false)
    expect(agentsOf(dir)).toEqual(['chat.md', 'computer.md', 'tasks.md'])
    expect(readFileSync(join(dir, 'agents', 'chat.md'), 'utf8')).not.toBe('viejo')
    expect(readFileSync(join(dir, '.onyxcode-version'), 'utf8')).toBe('0.3.0')
  })
})
