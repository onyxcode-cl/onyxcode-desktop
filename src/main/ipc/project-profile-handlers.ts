/** Canales `project:*`: Ficha del proyecto (nivel de acceso de la IA y Bóveda de variables). Solo la ventana principal; nunca el celular (clase X). */
import type { IpcMain } from 'electron'
import type { ProjectProfileView, VaultSetView } from '@shared/project-profile'
import { projectProfiles } from '../project-profile'
import { handle } from './handle'

function viewOf(folder: string): ProjectProfileView {
  const s = projectProfiles()
  const p = s.getProfile(folder)
  return { name: p.name, access: p.access, vaultNames: s.vaultNames(folder), secure: s.secureAvailable() }
}

export function registerProjectProfileHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'project:profile', ({ folder }) => viewOf(folder))
  handle(ipcMain, 'project:setAccess', ({ folder, access }) => {
    projectProfiles().setAccess(folder, access)
    return viewOf(folder)
  })
  handle(ipcMain, 'project:setName', ({ folder, name }) => {
    projectProfiles().setName(folder, name)
    return viewOf(folder)
  })
  handle(ipcMain, 'project:vaultSet', ({ folder, text }): VaultSetView => {
    const r = projectProfiles().vaultSet(folder, text)
    return { ...r, profile: viewOf(folder) }
  })
  handle(ipcMain, 'project:vaultDelete', ({ folder, name }) => {
    projectProfiles().vaultDelete(folder, name)
    return viewOf(folder)
  })
}
