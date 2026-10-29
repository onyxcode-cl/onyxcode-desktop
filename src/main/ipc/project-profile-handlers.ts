/** Canales `project:*`: Ficha del proyecto (nivel de acceso de la IA y Bóveda de variables). Solo la ventana principal; nunca el celular (clase X). */
import { app, dialog, type IpcMain } from 'electron'
import { basename } from 'node:path'
import type { LinkResult, PickLinkedResult, ProjectProfileView, VaultSetView } from '@shared/project-profile'
import { projectProfiles } from '../project-profile'
import { checkLinkedFolder } from '../project-profile/linked'
import { handle } from './handle'
import { windowOfSender } from './sender-window'

function viewOf(folder: string): ProjectProfileView {
  const s = projectProfiles()
  const p = s.getProfile(folder)
  return {
    name: p.name,
    access: p.access,
    vaultNames: s.vaultNames(folder),
    secure: s.secureAvailable(),
    linked: s.linkedOf(folder).map((l) => ({ path: l.path, name: basename(l.path), mode: l.mode }))
  }
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
  handle(ipcMain, 'project:pickLinked', async ({ folder }, event): Promise<PickLinkedResult> => {
    const win = windowOfSender(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return null
    const chk = checkLinkedFolder(res.filePaths[0], { project: folder, home: app.getPath('home'), userData: app.getPath('userData') })
    if (!chk.ok) return { reason: chk.reason }
    if (
      projectProfiles()
        .linkedOf(folder)
        .some((l) => l.path === chk.path)
    )
      return { reason: 'duplicate' }
    return { path: chk.path }
  })
  handle(ipcMain, 'project:link', ({ folder, path, mode }): LinkResult => {
    // Se vuelve a validar aquí: la pantalla solo propone, nunca decide.
    const chk = checkLinkedFolder(path, { project: folder, home: app.getPath('home'), userData: app.getPath('userData') })
    if (!chk.ok) return { ok: false, reason: chk.reason, profile: viewOf(folder) }
    const r = projectProfiles().addLinked(folder, chk.path, mode)
    return { ok: r === 'ok', ...(r === 'ok' ? {} : { reason: r }), profile: viewOf(folder) }
  })
  handle(ipcMain, 'project:unlink', ({ folder, path }) => {
    projectProfiles().removeLinked(folder, path)
    return viewOf(folder)
  })
}
