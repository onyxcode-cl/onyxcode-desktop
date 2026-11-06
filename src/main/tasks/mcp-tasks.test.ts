/** `tasksMcpContribution`: el prefijo `/usr/bin/env` solo va donde existe (Linux/macOS, y WSL aislado). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData, getAppPath: () => process.cwd(), isPackaged: false } }))

import { HIDDEN_SHELL_ENV } from './hidden-env'
import { MCP_ENV_WRAPPER, tasksMcpContribution } from './mcp-tasks'
import { shellLabel, toolsFor } from '../background-shell/mcp-server'

beforeAll(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'lazunox-mcptasks-'))
  mkdirSync(join(state.userData, 'opencode'), { recursive: true })
  writeFileSync(
    join(state.userData, 'opencode', 'opencode.json'),
    JSON.stringify({
      mcp: {
        loc: { type: 'local', command: ['node', 'srv.js'], environment: { A: '1' }, enabled: true },
        plano: { type: 'local', command: ['node', 'p.js'], enabled: true }
      }
    })
  )
  writeFileSync(
    join(state.userData, 'tasks-mcp.json'),
    JSON.stringify({ servers: { loc: { tasks: true, askEachTool: false }, plano: { tasks: true, askEachTool: false } } })
  )
})

type Local = { command: string[]; environment?: Record<string, string> }
const local = (c: ReturnType<typeof tasksMcpContribution>, n = 'loc'): Local => c.mcp[n] as Local

describe('tasksMcpContribution · prefijo de entorno', () => {
  it('win32 no aislado (Windows nativo): sin /usr/bin/env y variables ocultas anuladas en environment', () => {
    const l = local(tasksMcpContribution({ sandboxed: false, platform: 'win32' }))
    expect(l.command).toEqual(['node', 'srv.js'])
    expect(l.environment?.A).toBe('1')
    for (const n of HIDDEN_SHELL_ENV) expect(l.environment?.[n]).toBe('')
  })
  it('win32 aislado (WSL): conserva /usr/bin/env', () => {
    expect(local(tasksMcpContribution({ sandboxed: true, platform: 'win32' }), 'plano').command).toEqual([
      ...MCP_ENV_WRAPPER,
      'node',
      'p.js'
    ])
  })
  it('darwin: conserva /usr/bin/env, con y sin aislamiento', () => {
    for (const sandboxed of [true, false]) {
      const l = local(tasksMcpContribution({ sandboxed, platform: 'darwin' }), sandboxed ? 'plano' : 'loc')
      expect(l.command[0]).toBe('/usr/bin/env')
      if (!sandboxed) expect(l.environment).toEqual({ A: '1' })
    }
  })
})

describe('descripción de bgshell_start por plataforma', () => {
  const cmdOf = (p: NodeJS.Platform): string =>
    String((toolsFor(p)[0].inputSchema as { properties: { command: { description: string } } }).properties.command.description)
  it('win32 dice cmd.exe /d /s /c; darwin y linux dicen /bin/sh -c', () => {
    expect(shellLabel('win32')).toBe('cmd.exe /d /s /c')
    expect(cmdOf('win32')).toContain('cmd.exe /d /s /c')
    expect(cmdOf('win32')).not.toContain('/bin/sh')
    expect(cmdOf('darwin')).toContain('/bin/sh -c')
    expect(cmdOf('linux')).toContain('/bin/sh -c')
  })
})
