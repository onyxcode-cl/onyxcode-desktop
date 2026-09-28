/**
 * Diálogo de confirmación compartido: reemplaza `window.confirm` / `window.alert` nativos con un
 * componente propio (mismo estilo que `TrustGate` / `FullAccessDialog` en Cowork). Se monta una
 * única vez en `App.tsx` (`<ConfirmDialogHost />`) y se usa desde cualquier parte vía
 * `confirmDialog({ title, message, ... })`, que devuelve una promesa `boolean`.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'

export interface ConfirmDialogOptions {
  title: string
  message?: React.ReactNode
  /** Texto del botón de confirmación. Por defecto "Aceptar". */
  confirmLabel?: string
  /** Texto del botón de cancelar. Pasa `null` para ocultarlo (uso tipo `alert`). Por defecto "Cancelar". */
  cancelLabel?: string | null
  /** Estilo de advertencia (icono/botón en rojo) para acciones destructivas. */
  danger?: boolean
}

interface PendingRequest extends ConfirmDialogOptions {
  id: number
  resolve: (value: boolean) => void
}

let nextId = 1
let pending: PendingRequest | null = null
const listeners = new Set<(req: PendingRequest | null) => void>()

function setPending(req: PendingRequest | null): void {
  pending = req
  for (const l of listeners) l(req)
}

/**
 * Pide confirmación al usuario mediante el diálogo propio (no bloquea el hilo, a diferencia de
 * `window.confirm`). Resuelve `true` si confirma, `false` si cancela o cierra con Esc.
 * Requiere que `<ConfirmDialogHost />` esté montado (ver `App.tsx`).
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setPending({ ...options, id: nextId++, resolve })
  })
}

function usePending(): PendingRequest | null {
  const [req, setReq] = useState(pending)
  useEffect(() => {
    listeners.add(setReq)
    return () => {
      listeners.delete(setReq)
    }
  }, [])
  return req
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Host del diálogo de confirmación compartido. Montar una sola vez (en `App.tsx`). */
export function ConfirmDialogHost(): React.JSX.Element | null {
  const req = usePending()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const finish = (value: boolean): void => {
    req?.resolve(value)
    setPending(null)
  }

  useEffect(() => {
    if (!req) return
    // Foco inicial: en acciones destructivas, cancelar es lo seguro por defecto.
    const target = req.danger ? cancelRef.current : confirmRef.current
    target?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
        return
      }
      if (e.key === 'Enter') {
        // Evita confirmar sin querer si el foco está en un elemento que ya maneja Enter (p.ej. un link).
        e.preventDefault()
        finish(true)
        return
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current
        if (!root) return
        const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute('disabled')
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])

  if (!req) return null
  const danger = req.danger ?? false

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" onMouseDown={() => finish(false)}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={req.message ? 'confirm-dialog-message' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl"
      >
        <div
          className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${
            danger ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent'
          }`}
        >
          {danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
        </div>
        <h3 id="confirm-dialog-title" className="text-base font-semibold">
          {req.title}
        </h3>
        {req.message && (
          <p id="confirm-dialog-message" className="mt-2 text-sm leading-relaxed text-muted whitespace-pre-line">
            {req.message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {req.cancelLabel !== null && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => finish(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
            >
              {req.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => finish(true)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-90 ${
              danger ? 'bg-danger text-white' : 'bg-accent text-accent-fg'
            }`}
          >
            {req.confirmLabel ?? 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  )
}
