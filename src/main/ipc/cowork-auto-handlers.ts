/**
 * Handlers del Modo auto (`cowork:auto:*`, Lote C / paquete C3). La lógica vive en
 * `cowork/auto-approver.ts` (motor) y `cowork/auto-mode.ts` (clasificador puro); aquí se crea la
 * instancia única (`createAutoApprover`, expuesta también como `getAutoApprover()` para que la use
 * el monitor y `ComputerService.autoAccess`) y se conecta al IPC.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { createAutoApprover } from '../cowork/auto-approver'
import { coworkMcpPrefs } from '../cowork/mcp-cowork'
import { loadManagedPolicy } from '../cowork/policy'
import type { CoworkIpcContext, CoworkSubmodule } from './cowork-handle'

export function registerCoworkAutoHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, send, cowork, computer } = ctx

  const approver = createAutoApprover({
    file: join(app.getPath('userData'), 'cowork-auto.json'),
    // MCP del usuario marcados "Disponible en Cowork" y activos (nunca `computer`/`browser`, que no
    // pasan por `coworkMcpPrefs`).
    mcpServers: () =>
      coworkMcpPrefs
        .list()
        .filter((m) => m.cowork && m.enabled)
        .map((m) => m.name),
    servers: () => cowork.liveServers(),
    policyDisabled: () => loadManagedPolicy()?.disableAutoMode === true,
    onApproved: (r) => send('cowork:auto:approved', r),
    grantAutoView: (sessionId, bundleIds) => computer.grantAutoView(sessionId, bundleIds),
    revokeAutoView: (sessionId, bundleId) => computer.revokeAutoView(sessionId, bundleId),
    log: (...args) => console.log(...args)
  })

  handle('cowork:auto:state', () => approver.state())
  handle('cowork:auto:set', (req) => approver.set(req))
  handle('cowork:auto:revoke', ({ id }) => approver.revoke(id))
  handle('cowork:auto:clearLog', () => approver.clearLog())
  handle('cowork:auto:consider', async ({ folder, fullAccess, requestId }) => ({
    auto: await approver.considerOne(folder, fullAccess, requestId)
  }))

  return {}
}
