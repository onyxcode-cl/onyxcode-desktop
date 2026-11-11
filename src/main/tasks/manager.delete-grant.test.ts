/** Persistencia real del permiso; arranque simulado: ningún motor, puerto ni modelo. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => m.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: {} }))
import { TasksManager } from './manager'
let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-delete-grant-')))
  m.userData = join(root, 'ud')
  mkdirSync(m.userData)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
describe('permiso de borrar por carpeta', () => {
  it('persiste conceder y retirar; exige cambiar el servidor aislado solo si cambia el permiso', async () => {
    const manager = new TasksManager({ platform: 'darwin' })
    const restart = vi.spyOn(manager, 'restartSandbox').mockResolvedValue(true)
    const folder = join(root, 'carpeta')
    mkdirSync(folder)
    expect(manager.hasDeleteGrant(folder)).toBe(false)
    await manager.setDeleteGrant(folder, true)
    expect(restart).toHaveBeenCalledExactlyOnceWith(folder)
    expect(new TasksManager({ platform: 'darwin' }).hasDeleteGrant(folder)).toBe(true)
    await manager.setDeleteGrant(folder, true)
    expect(restart).toHaveBeenCalledTimes(1)
    await manager.setDeleteGrant(folder, false)
    expect(restart).toHaveBeenCalledTimes(2)
    expect(new TasksManager({ platform: 'darwin' }).hasDeleteGrant(folder)).toBe(false)
    expect(JSON.parse(readFileSync(join(m.userData, 'tasks-folders.json'), 'utf8')).deleteGrants).toEqual([])
  })
})
