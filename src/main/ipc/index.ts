import type { IpcMain } from 'electron'
import type { OpencodeServer } from '../opencode/server'
import type { MainWindowDeps } from '../extras/windows'
import { registerAppHandlers } from './app'
import { registerAttachHandlers } from './attach-handlers'
import { registerTranslatePdfHandlers } from './translate-pdf-handlers'
import { registerClipboardHandlers } from './clipboard-handlers'
import { registerDiagnosticsHandlers } from './diagnostics'
import { registerEngineCodeExtrasHandlers } from './engine-code-extras'
import { registerEngineJobsHandlers } from './engine-jobs'
import { registerHelperAgentsHandlers } from './helper-agents'
import { registerNotifyHandlers } from './notify'
import { registerOnboardingHandlers } from './onboarding'
import { registerOpencodeHandlers } from './opencode'
import { registerProviderHandlers } from './providers'
import { registerSettingsHandlers } from './settings'

export interface IpcContext extends MainWindowDeps {
  server: OpencodeServer
  chatDirectory: string
}

/**
 * Registra todos los módulos IPC comunes a todas las plataformas. Un módulo nuevo = una línea aquí.
 * El actualizador (`./update`), Tareas (`./tasks-handlers`) y sus stubs los carga `main/index.ts` según
 * `capsFor(process.platform)` con `import()` dinámico, para no cargar código de macOS en otras plataformas.
 */
export function registerAllHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  registerAppHandlers(ipcMain, ctx)
  registerOnboardingHandlers(ipcMain)
  registerOpencodeHandlers(ipcMain, ctx.server)
  registerDiagnosticsHandlers(ipcMain, ctx.server)
  registerEngineJobsHandlers(ipcMain, ctx.server)
  registerEngineCodeExtrasHandlers(ipcMain, ctx.server)
  registerHelperAgentsHandlers(ipcMain, ctx.server)
  registerClipboardHandlers(ipcMain)
  registerAttachHandlers(ipcMain)
  registerTranslatePdfHandlers(ipcMain)
  registerProviderHandlers(ipcMain, ctx.server)
  registerSettingsHandlers(ipcMain)
  registerNotifyHandlers(ipcMain, ctx)
}
