/**
 * Canales de funciones que solo existen en macOS (Tareas, Control del PC, actualizador) cuando la
 * plataforma no las tiene (`capsFor(process.platform)`): el guard de IPC rechaza un canal sin handler
 * con un error opaco, así que aquí cada canal responde `PLATFORM_UNSUPPORTED` (con mensaje es/en) y las
 * lecturas que el renderer hace al arrancar devuelven valores neutros (`[]`, `null`, preferencias por
 * defecto, «sin actualización»). No importa nada de Tareas, Control del PC ni del actualizador.
 * Los canales `routines:*` NO se simulan: los registra `registerRoutinesHandlers`.
 */
import { app, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { DEFAULT_COMPUTER_PREFS, DEFAULT_TASKS_PREFS, TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { IDLE_INSTALL } from '@shared/update-install'
import type { PlatformCaps } from '@shared/platform-caps'
import { handle, IpcError } from './handle'
import { makeTasksHandle } from './tasks-handle'

/** Lecturas que el renderer hace al arrancar: valor neutro en vez de error. */
const NEUTRAL_TASKS: Record<string, () => unknown> = {
  'tasks:listFolders': () => [],
  'tasks:trusted:list': () => [],
  'tasks:policy': () => null,
  'tasks:tasks:list': () => [],
  'tasks:mcp:list': () => [],
  'tasks:rules:list': () => [],
  'computer:approvedPlans': () => [],
  'tasks:prefs:get': () => ({ ...DEFAULT_TASKS_PREFS }),
  'computer:prefs:get': () => ({ ...DEFAULT_COMPUTER_PREFS }),
  // Avisos «fire and forget» del renderer: sin efecto.
  'tasks:viewing': () => undefined,
  'computer:session': () => undefined
}

/** Canales `app:*` del actualizador. */
export const UPDATER_CHANNELS = [
  'app:updateState',
  'app:checkUpdates',
  'app:dismissUpdate',
  'app:updateDownload',
  'app:updateCancel',
  'app:updateInstall',
  'app:bootConfirm'
] as const

const idleUpdateState = () => ({
  available: false,
  configured: false,
  enabled: false,
  current: app.getVersion(),
  latest: null,
  dismissed: null,
  lastCheck: null,
  checking: false,
  installable: false,
  install: IDLE_INSTALL
})

const unsupported = (): never => {
  throw new IpcError('PLATFORM_UNSUPPORTED', t('merr.platform.unsupported'))
}

/** Canales (invoke) de Tareas y Control del PC que no son de Rutinas. */
export function tasksOnlyChannels(): string[] {
  return TASKS_INVOKE_CHANNELS.filter((c) => !c.startsWith('routines:'))
}

/** Registra los stubs de lo que `caps` no ofrece. Devuelve los canales registrados (para pruebas). */
export function registerUnsupportedHandlers(ipcMain: IpcMain, caps: PlatformCaps): string[] {
  const registered: string[] = []
  if (!caps.tasks || !caps.computer) {
    const h = makeTasksHandle(ipcMain) as unknown as (ch: string, fn: () => unknown) => void
    for (const ch of tasksOnlyChannels()) {
      // `caps.tasks` y `caps.computer` se desactivan juntos en la práctica; si solo uno falta, solo sus prefijos.
      const isComputer = ch.startsWith('computer:')
      if (isComputer ? caps.computer : caps.tasks) continue
      h(ch, NEUTRAL_TASKS[ch] ?? unsupported)
      registered.push(ch)
    }
  }
  if (!caps.updater) {
    const h = handle as unknown as (ipc: IpcMain, ch: string, fn: () => unknown) => void
    for (const ch of UPDATER_CHANNELS) {
      if (!(IPC_INVOKE_CHANNELS as readonly string[]).includes(ch)) continue
      h(
        ipcMain,
        ch,
        ch === 'app:updateState' || ch === 'app:checkUpdates' ? idleUpdateState : ch === 'app:bootConfirm' ? () => undefined : unsupported
      )
      registered.push(ch)
    }
  }
  return registered
}
