import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/update-check'
import { api, call } from './api'
import { downloadUrl, type UpdateActionId } from './update-notice'
import { isRemoteSurface } from './platform'
import { t } from '@shared/i18n'

/** Estado del aviso de versión nueva: lectura inicial + evento `app:updateState`. */
export function useUpdateState(): [UpdateState | null, (s: UpdateState) => void] {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    // PWA del celular: no hay actualizador (el Mac se actualiza solo desde el Mac); ni se pide el estado ni se escuchan eventos.
    if (isRemoteSurface()) return
    let alive = true
    call('app:updateState')
      .then((s) => alive && setState((cur) => cur ?? s))
      .catch(() => undefined)
    const off = api.on('app:updateState', (s) => setState(s))
    // Progreso de la descarga: solo cambia la parte `install` del estado.
    const offProgress = api.on('app:updateProgress', (install) => setState((cur) => (cur ? { ...cur, install } : cur)))
    return () => {
      alive = false
      off()
      offProgress()
    }
  }, [])
  return [state, setState]
}

/** Ejecuta la acción de un botón del aviso. El renderer solo pide acciones: URLs y rutas las decide main. */
export function runUpdateAction(
  id: UpdateActionId,
  state: UpdateState,
  setState: (s: UpdateState) => void,
  onError?: (message: string) => void
): void {
  const apply = (p: Promise<UpdateState>): void => {
    onError?.('')
    p.then(setState).catch((err: unknown) => {
      // Si main rechaza (p.ej. la copia no se puede actualizar sola), se dice por qué y se relee el estado: «installable» habrá cambiado.
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
      onError?.(msg || t('notices.update.actionFailed'))
      call('app:updateState')
        .then(setState)
        .catch(() => undefined)
    })
  }
  switch (id) {
    case 'install':
    case 'retry':
      return apply(call('app:updateDownload'))
    case 'cancel':
      return apply(call('app:updateCancel'))
    case 'restart':
      return apply(call('app:updateInstall'))
    case 'download-manual': {
      const url = downloadUrl(state)
      if (url) void api.invoke('app:openExternal', { url })
      return
    }
    case 'later':
      if (state.install.phase === 'error') return apply(call('app:updateCancel'))
      if (state.latest) return apply(call('app:dismissUpdate', { version: state.latest.version }))
  }
}
