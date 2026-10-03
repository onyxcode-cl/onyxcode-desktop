/**
 * Confirmación local de vinculación («¿Vincular este dispositivo?»): cuando un celular pide vincularse, el
 * dueño ve su nombre y el código de 6 dígitos (el mismo que muestra el celular). Si no coincide, debe rechazar.
 * Se monta una vez en `App.tsx`; solo hace algo donde existe `window.api.remote` (macOS).
 */
import { useEffect } from 'react'
import { t } from '@shared/i18n'
import type { RemoteApi, RemotePairRequest } from '@shared/ipc-remote'
import { confirmDialog } from '../components/ConfirmDialog'

export function RemotePairHost(): null {
  useEffect(() => {
    const api = (window as unknown as { api?: { remote?: RemoteApi } }).api?.remote
    if (!api) return
    const shown = new Set<string>()
    const ask = async (req: RemotePairRequest): Promise<void> => {
      if (shown.has(req.requestId)) return
      shown.add(req.requestId)
      const accept = await confirmDialog({
        title: t('remote.pair.title'),
        message: (
          <div className="space-y-3">
            <p>{t('remote.pair.body', { name: req.deviceName })}</p>
            <p className="text-xs text-muted">{t('remote.pair.codeLabel')}</p>
            <p aria-label={req.code.split('').join(' ')} className="text-center font-mono text-3xl font-semibold tracking-[0.3em] text-fg">
              {req.code}
            </p>
            <p className="text-xs text-muted">{t('remote.pair.warn')}</p>
          </div>
        ),
        confirmLabel: t('remote.pair.accept'),
        cancelLabel: t('remote.pair.reject'),
        focusCancel: true
      })
      await api.invoke('remote:confirmPair', { requestId: req.requestId, accept }).catch(() => undefined)
    }
    const offReq = api.on('remote:pairRequest', (req) => void ask(req))
    // Respaldo: si el evento llegó antes de montar, el estado conserva la petición pendiente.
    const offState = api.on('remote:changed', (s) => {
      if (s.pendingPair) void ask(s.pendingPair)
    })
    void api
      .invoke('remote:getState')
      .then((s) => s.pendingPair && void ask(s.pendingPair))
      .catch(() => undefined)
    return () => {
      offReq()
      offState()
    }
  }, [])
  return null
}
