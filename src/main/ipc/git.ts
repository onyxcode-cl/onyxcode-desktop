import type { IpcMain } from 'electron'
import { notImplemented } from './handle'

/** Git status/diff/worktrees (fase 2): implementar en src/main/git/. */
export function registerGitHandlers(ipcMain: IpcMain): void {
  notImplemented(ipcMain, 'git:status')
  notImplemented(ipcMain, 'git:diff')
  notImplemented(ipcMain, 'git:worktrees')
}
