/** Carpetas añadidas a un proyecto de Code: las guarda main (validadas allí) y las reglas de permisos de cada sesión las dejan pasar. */
import { useEffect } from 'react'
import { t } from '@shared/i18n'
import type { MsgKey } from '@shared/i18n'
import type { ProjectFolders } from './ProjectDialog'
import { useProjectProfile } from './store'

const reasonText = (reason: string): string => t(`project.linked.reason.${reason}` as MsgKey)

export function useLinkedFolders(folder: string): ProjectFolders {
  const profile = useProjectProfile((s) => s.byFolder[folder])
  // Se carga al mostrar el proyecto: así las reglas de la primera sesión ya llevan las carpetas añadidas.
  useEffect(() => {
    void useProjectProfile.getState().ensure(folder)
  }, [folder])
  return {
    linked: profile?.linked ?? [],
    applied: true,
    pick: async () => {
      const r = await useProjectProfile.getState().pickLinked(folder)
      if (!r) return null
      return 'reason' in r ? { error: reasonText(r.reason) } : { path: r.path }
    },
    link: async (path, mode) => {
      const r = await useProjectProfile.getState().link(folder, path, mode)
      return r.ok ? true : { error: reasonText(r.reason ?? 'not-absolute') }
    },
    unlink: (path) => useProjectProfile.getState().unlink(folder, path)
  }
}
