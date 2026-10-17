/** Estado y acciones de las habilidades (incluidas y propias). Todo pasa por `main`: el renderer nunca manda una ruta. */
import { useCallback, useEffect, useState } from 'react'
import type { SkillFolderPreview, SkillsState } from '@shared/ipc-extras'
import { errorMessage } from '../../lib/opencode'
import { getExtras, requireExtras } from '../settings/impl/extras'

export interface SkillsApi {
  state: SkillsState | null
  loading: boolean
  loaded: boolean
  error: string | null
  setError: (e: string | null) => void
  refresh: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** Abre el diálogo nativo y devuelve la vista previa (nada se copia). `null` si se cancela. */
  pick: () => Promise<SkillFolderPreview | null>
  install: (token: string) => Promise<void>
  remove: (name: string) => Promise<void>
}

export function useSkills(): SkillsApi {
  const [state, setState] = useState<SkillsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setState(await requireExtras().invoke('personalizacion:skills:list'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!getExtras()) {
      setLoaded(true)
      return
    }
    void refresh()
  }, [refresh])

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    setState(await requireExtras().invoke('personalizacion:skills:setEnabled', { id, enabled }))
  }, [])
  const pick = useCallback(() => requireExtras().invoke('personalizacion:skills:pick'), [])
  const install = useCallback(async (token: string) => {
    setState(await requireExtras().invoke('personalizacion:skills:install', { token }))
  }, [])
  const remove = useCallback(async (name: string) => {
    setState(await requireExtras().invoke('personalizacion:skills:remove', { name }))
  }, [])

  return { state, loading, loaded, error, setError, refresh, setEnabled, pick, install, remove }
}
