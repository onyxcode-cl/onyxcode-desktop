/**
 * Confirmación en el Mac de lo que pide el celular (T6): acciones peligrosas («D») y cada conexión nueva.
 * Muestra el nombre y la huella del dispositivo, la acción en lenguaje humano, el detalle y la hora. Reglas de seguridad:
 *  - «Rechazar» tiene el foco por defecto (Enter/Esc rechazan); «Permitir» se activa tras 1,5 s (evita un Enter por inercia).
 *  - Cuenta regresiva visible; a los 90 s main la rechaza sola (aquí solo se cierra el diálogo).
 *  - «Recordar 12 h» solo aparece en la confirmación de una conexión nueva.
 * Se monta una vez en `App.tsx`; solo hace algo donde existe `window.api.remote` (macOS).
 */
import { useEffect, useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { getLang } from '@shared/i18n'
import { REMOTE_CONNECT_CHANNEL as CONNECT_CHANNEL, type RemoteApi, type RemoteConfirmRequest } from '@shared/ipc-remote'
import { Button } from '../components/Button'
import { useT } from '../lib/i18n'

/** Margen antes de poder pulsar «Permitir». */
export const ALLOW_DELAY_MS = 1500

/** Estado visible del diálogo en un instante (puro, para pruebas). */
export function confirmView(
  req: RemoteConfirmRequest,
  shownAt: number,
  now: number
): { canAllow: boolean; secondsLeft: number; expired: boolean } {
  return {
    canAllow: now - shownAt >= ALLOW_DELAY_MS,
    secondsLeft: Math.max(0, Math.ceil((req.expiresAt - now) / 1000)),
    expired: now >= req.expiresAt
  }
}

export function RemoteConfirmHost(): React.JSX.Element | null {
  const t = useT()
  const [queue, setQueue] = useState<Array<{ req: RemoteConfirmRequest; shownAt: number }>>([])
  const [now, setNow] = useState(() => Date.now())
  const [remember, setRemember] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const current = queue[0] ?? null

  useEffect(() => {
    const api = (window as unknown as { api?: { remote?: RemoteApi } }).api?.remote
    if (!api) return
    const offReq = api.on('remote:confirmRequest', (req) =>
      setQueue((q) => (q.some((x) => x.req.requestId === req.requestId) ? q : [...q, { req, shownAt: Date.now() }]))
    )
    const offDismiss = api.on('remote:confirmDismiss', ({ requestId }) => setQueue((q) => q.filter((x) => x.req.requestId !== requestId)))
    return () => {
      offReq()
      offDismiss()
    }
  }, [])

  const id = current?.req.requestId
  useEffect(() => {
    if (!id) return
    setRemember(false)
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    // El foco inicial va a «Rechazar».
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-reject]')?.focus()
    return () => clearInterval(timer)
  }, [id])

  // Caducó: main ya la rechazó; se cierra aquí.
  useEffect(() => {
    if (current && now >= current.req.expiresAt) setQueue((q) => q.filter((x) => x.req.requestId !== current.req.requestId))
  }, [now, current])

  const answer = (accept: boolean): void => {
    if (!current) return
    const api = (window as unknown as { api?: { remote?: RemoteApi } }).api?.remote
    const { requestId, channel } = current.req
    setQueue((q) => q.filter((x) => x.req.requestId !== requestId))
    void api
      ?.invoke('remote:confirmAction', {
        requestId,
        accept,
        ...(accept && remember && channel === CONNECT_CHANNEL ? { remember: true } : {})
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  if (!current) return null
  const { req, shownAt } = current
  const view = confirmView(req, shownAt, now)
  const lang = getLang() === 'en' ? 'en' : 'es'
  const when = new Date(req.createdAt).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" data-confirm-scrim="">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remote-confirm-title"
        aria-describedby="remote-confirm-body"
        className="flex max-h-full w-full max-w-md flex-col rounded-2xl border border-border bg-elevated p-5 shadow-2xl"
      >
        <div className="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <ShieldAlert size={20} />
        </div>
        <h3 id="remote-confirm-title" className="shrink-0 text-base font-semibold">
          {t('remote.confirm.title')}
        </h3>
        <p className="mt-1 shrink-0 text-xs text-muted">
          {t('remote.confirm.from', { name: req.deviceName, fingerprint: req.deviceFingerprint, time: when })}
        </p>
        <div id="remote-confirm-body" className="mt-3 min-h-0 space-y-2 overflow-y-auto overscroll-contain">
          <p className="text-sm font-medium text-fg">{req.summary[lang]}</p>
          {req.detail.length > 0 && (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-muted">
              {req.detail.map((d, i) => (
                <li key={i} className="break-all">
                  {d}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{t('remote.confirm.warn')}</p>
        </div>
        {req.channel === CONNECT_CHANNEL && (
          <label className="mt-3 flex shrink-0 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('remote.confirm.remember')}
          </label>
        )}
        <p className="mt-3 shrink-0 text-xs font-medium text-fg" aria-live="off">
          {t('remote.confirm.expiresIn', { seconds: view.secondsLeft })}
        </p>
        <div data-remote-confirm-actions="" className="mt-4 flex shrink-0 justify-end gap-2">
          <Button data-reject variant="secondary" onClick={() => answer(false)} autoFocus>
            {t('remote.confirm.reject')}
          </Button>
          <Button variant="primary" disabled={!view.canAllow} onClick={() => answer(true)}>
            {t('remote.confirm.allow')}
          </Button>
        </div>
      </div>
    </div>
  )
}
