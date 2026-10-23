/**
 * El envoltorio de entorno de los MCP locales debe quitar EXACTAMENTE las mismas variables que se ocultan al shell
 * (`HIDDEN_SHELL_ENV`): contraseña del servidor, configuración, puerta del plan y canal del guardián. Antes el envoltorio tenía su
 * propia lista y se quedaba atrás (no quitaba `LAZUNOX_GUARD_URL`/`LAZUNOX_GUARD_TOKEN`).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/x', getAppPath: () => process.cwd(), isPackaged: false } }))

import { MCP_ENV_WRAPPER } from './mcp-tasks'
import { HIDDEN_SHELL_ENV } from './hidden-env'
import { HIDDEN_SHELL_ENV as REEXPORTED } from './opencode-config'

describe('MCP_ENV_WRAPPER', () => {
  it('es /usr/bin/env y quita todas las variables de HIDDEN_SHELL_ENV', () => {
    expect(MCP_ENV_WRAPPER[0]).toBe('/usr/bin/env')
    const unset = MCP_ENV_WRAPPER.slice(1)
    const names = unset.filter((_, i) => i % 2 === 1)
    expect(unset.filter((_, i) => i % 2 === 0).every((f) => f === '-u')).toBe(true)
    expect(names.sort()).toEqual([...HIDDEN_SHELL_ENV].sort())
  })
  it('opencode-config reexporta la MISMA lista (el shell y los MCP no pueden divergir)', () => {
    expect(REEXPORTED).toBe(HIDDEN_SHELL_ENV)
  })
  it('incluye el canal del guardián (token y URL)', () => {
    expect(MCP_ENV_WRAPPER).toContain('LAZUNOX_GUARD_TOKEN')
    expect(MCP_ENV_WRAPPER).toContain('LAZUNOX_GUARD_URL')
  })
})
