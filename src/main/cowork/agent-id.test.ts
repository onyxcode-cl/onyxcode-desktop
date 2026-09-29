/**
 * El id del agente de tareas está DUPLICADO: `COWORK_AGENT_ID` (main, `opencode-config.ts`) y
 * `COWORK_AGENT` (renderer, `features/cowork/impl/actions.ts`). Si divergen, el renderer pide un
 * agente sin los permisos de `inline-config`. Red de seguridad hasta unificarlos en un id único
 * compartido (paso 4 del renombre).
 *
 * El renderer se lee como TEXTO: el proyecto TS de main no puede importar módulos del renderer.
 * Cuando el id pase a `src/shared/`, sustituir la lectura por una comparación de imports.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent', getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))

import { COMPUTER_AGENT_ID, COWORK_AGENT_ID } from './opencode-config'

const actions = readFileSync(join(process.cwd(), 'src/renderer/src/features/cowork/impl/actions.ts'), 'utf8')
const literal = (name: string): string | undefined => new RegExp(`export const ${name} = '([^']+)'`).exec(actions)?.[1]

describe('id del agente: renderer == main', () => {
  it('el agente de tareas coincide', () => {
    expect(literal('COWORK_AGENT')).toBe(COWORK_AGENT_ID)
  })
  it('el agente de Control total coincide', () => {
    expect(literal('COMPUTER_AGENT')).toBe(COMPUTER_AGENT_ID)
  })
  it('currentAgent() elige entre esas dos constantes según fullAccess', () => {
    expect(actions).toMatch(/fullAccess \? COMPUTER_AGENT : COWORK_AGENT/)
  })
})
