import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_VALUE_MASK } from '@shared/mcp-catalog'

const userData = mkdtempSync(join(tmpdir(), 'onyx-mcpmask-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { appOpencodeConfigPath, maskAppMcpConfig, readAppMcpConfig, saveMcpServer } from './mcp-config'

afterAll(() => rmSync(userData, { recursive: true, force: true }))
beforeEach(() => rmSync(join(userData, 'opencode'), { recursive: true, force: true }))

const TOKEN = 'ghp_secretTOKEN1234567890abcdef'
const raw = (): { mcp: Record<string, Record<string, Record<string, string>>> } => JSON.parse(readFileSync(appOpencodeConfigPath(), 'utf8'))

describe('MCP: el renderer no recibe secretos (F8-B69, hallazgo 5)', () => {
  it('maskAppMcpConfig oculta todos los valores de headers y environment pero conserva las claves', () => {
    saveMcpServer('gh', { type: 'remote', url: 'https://x.example/mcp', headers: { Authorization: `Bearer ${TOKEN}` } })
    saveMcpServer('loc', { type: 'local', command: ['npx', 'x'], environment: { API_KEY: TOKEN } })
    const masked = maskAppMcpConfig(readAppMcpConfig())
    expect(JSON.stringify(masked)).not.toContain(TOKEN)
    expect(masked.servers.gh).toMatchObject({ headers: { Authorization: MCP_VALUE_MASK } })
    expect(masked.servers.loc).toMatchObject({ environment: { API_KEY: MCP_VALUE_MASK } })
    // el original no se muta
    expect(JSON.stringify(readAppMcpConfig())).toContain(TOKEN)
  })

  it('guardar con el valor enmascarado conserva el secreto; uno nuevo lo reemplaza; renombrar también conserva', () => {
    saveMcpServer('gh', { type: 'remote', url: 'https://x.example/mcp', headers: { Authorization: `Bearer ${TOKEN}`, 'X-Other': 'a' } })
    saveMcpServer(
      'gh',
      {
        type: 'remote',
        url: 'https://x.example/mcp2',
        headers: { Authorization: MCP_VALUE_MASK, 'X-Other': 'nuevo-valor' }
      },
      'gh'
    )
    expect(raw().mcp.gh.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, 'X-Other': 'nuevo-valor' })
    saveMcpServer('gh2', { type: 'remote', url: 'https://x.example/mcp2', headers: { Authorization: MCP_VALUE_MASK } }, 'gh')
    expect(raw().mcp.gh2.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(raw().mcp.gh).toBeUndefined()
  })

  it('un valor enmascarado sin secreto previo no se guarda como si fuera el secreto', () => {
    saveMcpServer('nuevo', { type: 'local', command: ['x'], environment: { A: MCP_VALUE_MASK, B: 'ok' } })
    expect(raw().mcp.nuevo.environment).toEqual({ B: 'ok' })
  })
})
