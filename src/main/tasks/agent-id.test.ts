/**
 * El id del agente de tareas es ÚNICO (`src/shared/agents.ts`) y lo importan main y renderer. Si el
 * renderer pidiera un agente distinto de la clave de `inline-config`, los permisos dejarían de
 * aplicarse sin aviso. El renderer se lee como TEXTO (el proyecto TS de main no importa el renderer):
 * se comprueba que importa los ids del módulo compartido y que no redefine ningún literal.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent', getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))

import * as shared from '@shared/agents'
import * as opencodeConfig from './opencode-config'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
const actions = read('src/renderer/src/features/tasks/impl/actions.ts')
const inlineConfig = read('src/main/tasks/inline-config.ts')

describe('id del agente: única fuente compartida', () => {
  it('los ids valen chat, tasks y computer', () => {
    expect(shared.CHAT_AGENT_ID).toBe('chat')
    expect(shared.TASKS_AGENT_ID).toBe('tasks')
    expect(shared.COMPUTER_AGENT_ID).toBe('computer')
  })
  it('main reexporta los mismos ids', () => {
    expect(opencodeConfig.TASKS_AGENT_ID).toBe(shared.TASKS_AGENT_ID)
    expect(opencodeConfig.COMPUTER_AGENT_ID).toBe(shared.COMPUTER_AGENT_ID)
  })
  it('el renderer importa los ids de @shared/agents y no los redefine', () => {
    expect(actions).toMatch(/import \{[^}]*\bTASKS_AGENT_ID\b[^}]*\} from '@shared\/agents'/)
    expect(actions).toMatch(/import \{[^}]*\bCOMPUTER_AGENT_ID\b[^}]*\} from '@shared\/agents'/)
    expect(actions).not.toMatch(/(?:const|let|var) \w*AGENT\w* = '/)
  })
  it('currentAgent() elige entre esos dos ids según fullAccess', () => {
    expect(actions).toMatch(/fullAccess \? COMPUTER_AGENT_ID : TASKS_AGENT_ID/)
  })
  it('inline-config usa los ids compartidos como CLAVE de agente (sin literales)', () => {
    expect(inlineConfig).toMatch(/import \{[^}]*\bTASKS_AGENT_ID\b[^}]*\} from '@shared\/agents'/)
    expect(inlineConfig).toContain('[TASKS_AGENT_ID]')
    expect(inlineConfig).toContain('[COMPUTER_AGENT_ID]')
    expect(inlineConfig).not.toMatch(/\b(?:tasks|tasks|computer):\s*\{/)
  })
  it('cada id tiene su agente en resources/opencode/agents', () => {
    for (const id of [shared.CHAT_AGENT_ID, shared.TASKS_AGENT_ID, shared.COMPUTER_AGENT_ID]) {
      expect(existsSync(join(process.cwd(), 'resources/opencode/agents', `${id}.md`))).toBe(true)
    }
  })
})
