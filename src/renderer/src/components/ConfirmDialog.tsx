/**
 * Diálogo de confirmación compartido: reemplaza `window.confirm` / `window.alert` / `window.prompt`
 * nativos con un componente propio (mismo estilo que `TrustGate` / `FullAccessDialog` en Tareas).
 * Se monta una única vez en `App.tsx` (`<ConfirmDialogHost />`) y se usa desde cualquier parte vía
 * `confirmDialog({ title, message, ... })` (devuelve `boolean`) o `promptDialog({ title, ... })`
 * (devuelve `string | null`).
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Pencil } from 'lucide-react'
import { useT } from '../lib/i18n'

export interface ConfirmDialogOptions {
  title: string
  message?: React.ReactNode
  /** Texto del botón de confirmación. Por defecto "Aceptar". */
  confirmLabel?: string
  /** Texto del botón de cancelar. Pasa `null` para ocultarlo (uso tipo `alert`). Por defecto "Cancelar". */
  cancelLabel?: string | null
  /** Estilo de advertencia (icono/botón en rojo) para acciones destructivas. */
  danger?: boolean
  /** Foco inicial en «Cancelar» (y Enter respeta el botón enfocado) sin el estilo de peligro. */
  focusCancel?: boolean
}

export interface PromptDialogOptions {
  title: string
  message?: React.ReactNode
  /** Valor inicial del campo de texto (seleccionado al enfocar). */
  defaultValue?: string
  placeholder?: string
  /** Texto del botón de confirmación. Por defecto "Aceptar". */
  confirmLabel?: string
  cancelLabel?: string
}

interface PendingConfirm extends ConfirmDialogOptions {
  kind: 'confirm'
  id: number
  resolve: (value: boolean) => void
}

interface PendingPrompt extends PromptDialogOptions {
  kind: 'prompt'
  id: number
  resolve: (value: string | null) => void
}

type PendingRequest = PendingConfirm | PendingPrompt

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
    setPending({ ...options, kind: 'confirm', id: nextId++, resolve })
  })
}

/**
 * Pide un texto al usuario mediante el diálogo propio (reemplaza `window.prompt`, que bloquea el
 * hilo y no se puede estilizar). Resuelve el texto introducido, o `null` si cancela o cierra con
 * Esc. Requiere que `<ConfirmDialogHost />` esté montado (ver `App.tsx`).
 */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    setPending({ ...options, kind: 'prompt', id: nextId++, resolve })
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

/** Host del diálogo de confirmación/prompt compartido. Montar una sola vez (en `App.tsx`). */
export function ConfirmDialogHost(): React.JSX.Element | null {
  const t = useT()
  const req = usePending()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  const finishConfirm = (value: boolean): void => {
    if (req?.kind !== 'confirm') return
    req.resolve(value)
    setPending(null)
  }

  const finishPrompt = (value: string | null): void => {
    if (req?.kind !== 'prompt') return
    req.resolve(value)
    setPending(null)
  }

  useEffect(() => {
    if (!req) return
    if (req.kind === 'prompt') {
      setText(req.defaultValue ?? '')
      // Autofocus + selección del texto (equivalente a `window.prompt`).
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => clearTimeout(timer)
    }
    // Foco inicial: en acciones destructivas, cancelar es lo seguro por defecto.
    const target = req.danger || req.focusCancel ? cancelRef.current : confirmRef.current
    target?.focus()
    return undefined
  }, [req])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (req.kind === 'confirm') finishConfirm(false)
        else finishPrompt(null)
        return
      }
      if (e.key === 'Enter') {
        if (req.kind === 'prompt') {
          // El input ya maneja Enter con su propio onKeyDown; evitar doble disparo aquí.
          if (document.activeElement === inputRef.current) return
          e.preventDefault()
          finishPrompt(text)
          return
        }
        // Evita confirmar sin querer si el foco está en un elemento que ya maneja Enter (p.ej. un link).
        e.preventDefault()
        // Con `focusCancel`, Enter actúa sobre el botón enfocado: por defecto, Cancelar.
        finishConfirm(req.focusCancel && document.activeElement === cancelRef.current ? false : true)
        return
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current
        if (!root) return
        const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'))
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
  }, [req, text])

  if (!req) return null

  if (req.kind === 'prompt') {
    return (
      <div
        className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"
        onMouseDown={() => finishPrompt(null)}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby={req.message ? 'confirm-dialog-message' : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Pencil size={20} />
          </div>
          <h3 id="confirm-dialog-title" className="text-base font-semibold">
            {req.title}
          </h3>
          {req.message && (
            <p id="confirm-dialog-message" className="mt-2 text-sm leading-relaxed text-muted whitespace-pre-line">
              {req.message}
            </p>
          )}
          <input
            ref={inputRef}
            type="text"
            aria-labelledby="confirm-dialog-title"
            value={text}
            placeholder={req.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                finishPrompt(text)
              }
            }}
            className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => finishPrompt(null)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
            >
              {req.cancelLabel ?? t('common.cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => finishPrompt(text)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              {req.confirmLabel ?? t('common.accept')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const danger = req.danger ?? false

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"
      onMouseDown={() => finishConfirm(false)}
    >
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
              onClick={() => finishConfirm(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
            >
              {req.cancelLabel ?? t('common.cancel')}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => finishConfirm(true)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-90 ${
              danger ? 'bg-danger text-danger-fg' : 'bg-accent text-accent-fg'
            }`}
          >
            {req.confirmLabel ?? t('common.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}
