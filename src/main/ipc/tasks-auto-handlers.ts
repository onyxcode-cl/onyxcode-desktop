/**
 * Handlers del Modo auto (`tasks:auto:*`, Lote C / paquete C3). La lógica vive en
 * `cowork/auto-approver.ts` (motor) y `cowork/auto-mode.ts` (clasificador puro); aquí se crea la
 * instancia única (`createAutoApprover`, expuesta también como `getAutoApprover()` para que la use
 * el monitor y `ComputerService.autoAccess`) y se conecta al IPC.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { createAutoApprover } from '../tasks/auto-approver'
import { coworkMcpPrefs } from '../tasks/mcp-tasks'
import { loadManagedPolicy } from '../tasks/policy'
import type { CoworkIpcContext, CoworkSubmodule } from './tasks-handle'

export function registerCoworkAutoHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, send, cowork, computer } = ctx

  const approver = createAutoApprover({
    file: join(app.getPath('userData'), 'tasks-auto.json'),
    // MCP del usuario marcados "Disponible en Cowork" y activos (nunca `computer`/`browser`, que no
    // pasan por `coworkMcpPrefs`).
    mcpServers: () =>
      coworkMcpPrefs
        .list()
        .filter((m) => m.tasks && m.enabled)
        .map((m) => m.name),
    servers: () => cowork.liveServers(),
    policyDisabled: () => loadManagedPolicy()?.disableAutoMode === true,
    onApproved: (r) => send('tasks:auto:approved', r),
    grantAutoView: (sessionId, bundleIds) => computer.grantAutoView(sessionId, bundleIds),
    revokeAutoView: (sessionId, bundleId) => computer.revokeAutoView(sessionId, bundleId),
    log: (...args) => console.log(...args)
  })

  handle('tasks:auto:state', () => approver.state())
  handle('tasks:auto:set', (req) => approver.set(req))
  handle('tasks:auto:revoke', ({ id }) => approver.revoke(id))
  handle('tasks:auto:clearLog', () => approver.clearLog())
  handle('tasks:auto:consider', async ({ folder, fullAccess, requestId }) => ({
    auto: await approver.considerOne(folder, fullAccess, requestId)
  }))

  return {}
}
