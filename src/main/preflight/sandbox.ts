/** Inventario de arranque, sin seleccionar el backend ni cargar, escribir o encender la distro. No autoriza ejecutar Tareas. */
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import { classifyWslStatus, type RunResult } from '../tasks/backends/wsl-status'

export const STARTUP_WSL_TIMEOUT_MS = 20_000

export async function readStartupSandbox(d: {
  platform: string
  available: boolean
  policyDisabled: () => boolean
  run: (kind: 'version' | 'list', ms: number) => Promise<RunResult>
}): Promise<TasksSandboxStatus> {
  const result = (state: TasksSandboxStatus['state'], detail?: string): TasksSandboxStatus => ({
    backend: 'wsl',
    state,
    ...(detail ? { detail } : {}),
    setup: null
  })
  if (d.platform !== 'win32' || !d.available) return result('unsupported')
  if (d.policyDisabled()) return result('policyDisabled')
  const [version, list] = await Promise.all([d.run('version', STARTUP_WSL_TIMEOUT_MS), d.run('list', STARTUP_WSL_TIMEOUT_MS)])
  const status = classifyWslStatus({ version, list })
  // El clasificador completo pide el probe cuando encuentra nuestra distro WSL2. En el inventario basta con su existencia.
  if (status.state === 'broken' && status.detail === 'probe') return result('ready')
  return result(status.state, status.detail)
}
