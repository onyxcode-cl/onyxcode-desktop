/** Estado de la Ficha del proyecto en la pantalla: por carpeta, lo que main devuelve (nombre, nivel y NOMBRES de las variables; jamás valores). */
import { create } from 'zustand'
import type { AccessLevel, ProjectProfileView, VaultSetView } from '@shared/project-profile'
import { call } from '../../lib/api'

interface State {
  byFolder: Record<string, ProjectProfileView>
  load: (folder: string) => Promise<void>
  setAccess: (folder: string, access: AccessLevel) => Promise<void>
  setName: (folder: string, name: string) => Promise<void>
  vaultSet: (folder: string, text: string) => Promise<VaultSetView>
  vaultDelete: (folder: string, name: string) => Promise<void>
}

export const useProjectProfile = create<State>((set) => {
  const put = (folder: string, p: ProjectProfileView): void => set((s) => ({ byFolder: { ...s.byFolder, [folder]: p } }))
  return {
    byFolder: {},
    load: async (folder) => put(folder, await call('project:profile', { folder })),
    setAccess: async (folder, access) => put(folder, await call('project:setAccess', { folder, access })),
    setName: async (folder, name) => put(folder, await call('project:setName', { folder, name })),
    vaultSet: async (folder, text) => {
      const r = await call('project:vaultSet', { folder, text })
      put(folder, r.profile)
      return r
    },
    vaultDelete: async (folder, name) => put(folder, await call('project:vaultDelete', { folder, name }))
  }
})

/** El nivel que ve la persona: «Control total» (modo existente de Tareas) manda sobre lo guardado en la ficha. */
export function effectiveLevel(profile: ProjectProfileView | undefined, full: boolean): AccessLevel {
  return full ? 'total' : profile?.access === 'aislado' ? 'aislado' : 'comandos'
}
