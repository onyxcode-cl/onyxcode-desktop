/**
 * Handlers del Modo auto (`tasks:auto:*`, Lote C / paquete C3). La lógica vive en
 * `tasks/auto-approver.ts` (motor) y `tasks/auto-mode.ts` (clasificador puro); aquí se crea la
 * instancia única (`createAutoApprover`, expuesta también como `getAutoApprover()` para que la use
 * el monitor y `ComputerService.autoAccess`) y se conecta al IPC.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { createAutoApprover } from '../tasks/auto-approver'
import { tasksMcpPrefs } from '../tasks/mcp-tasks'
import { loadManagedPolicy } from '../tasks/policy'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksAutoHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, send, tasks, computer } = ctx

  const approver = createAutoApprover({
    file: join(app.getPath('userData'), 'tasks-auto.json'),
    // MCP del usuario marcados "Disponible en Tareas" y activos (nunca `computer`/`browser`, que no
    // pasan por `tasksMcpPrefs`).
    mcpServers: () =>
      tasksMcpPrefs
        .list()
        .filter((m) => m.tasks && m.enabled)
        .map((m) => m.name),
    servers: () => tasks.liveServers(),
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
