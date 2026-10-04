import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { create } from 'zustand'
import { isRemoteSurface } from '../../lib/platform'

export type ToastTone = 'default' | 'danger' | 'success'

interface ToastState {
  current: { id: number; text: string; tone: ToastTone; leaving: boolean } | null
}

/** Duración de la salida (ms). */
export const TOAST_LEAVE_MS = 160

const useToastStore = create<ToastState>(() => ({ current: null }))
let nextId = 1
let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers(): void {
  for (const t of timers) clearTimeout(t)
  timers = []
}

/** Aviso breve de la interfaz completa en el celular. Solo uno a la vez: el nuevo sustituye al anterior. */
export function showToast(text: string, tone: ToastTone = 'default', ms = 2600): void {
  clearTimers()
  const id = nextId++
  useToastStore.setState({ current: { id, text, tone, leaving: false } })
  timers.push(
    setTimeout(() => {
      useToastStore.setState((s) => (s.current?.id === id ? { current: { ...s.current, leaving: true } } : s))
      timers.push(setTimeout(() => useToastStore.setState((s) => (s.current?.id === id ? { current: null } : s)), TOAST_LEAVE_MS))
    }, ms)
  )
}

/** Quita el aviso actual (para pruebas y para cambios de pantalla). */
export function clearToast(): void {
  clearTimers()
  useToastStore.setState({ current: null })
}

/** Pastilla del aviso (separada del host para poder probar su marcado). */
export function ToastView({
  text,
  tone = 'default',
  leaving = false
}: {
  text: string
  tone?: ToastTone
  leaving?: boolean
}): React.JSX.Element {
  return (
    <div
      data-m-toast=""
      data-leaving={leaving ? '' : undefined}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={`pointer-events-none fixed inset-x-0 z-[320] flex justify-center px-4 ${leaving ? '' : 'animate-rise-in'}`}
      style={{
        bottom: 'calc(var(--m-tab, 56px) + var(--sab, 0px) + 12px)',
        ...(leaving ? { opacity: 0, transition: `opacity ${TOAST_LEAVE_MS}ms var(--ease-out)` } : null)
      }}
    >
      <span className="flex max-w-full items-center gap-2 rounded-full bg-fg px-4 py-2.5 text-[15px] leading-snug text-bg shadow-lg">
        {tone === 'danger' && <AlertCircle size={16} className="shrink-0" aria-hidden="true" />}
        {tone === 'success' && <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0 break-words">{text}</span>
      </span>
    </div>
  )
}

/** Host de los avisos: solo pinta algo en el celular. Se monta una vez (lo trae `ConfirmDialogHost`). */
export function MobileToastHost(): React.JSX.Element | null {
  const current = useToastStore((s) => s.current)
  if (!current || !isRemoteSurface()) return null
  return <ToastView text={current.text} tone={current.tone} leaving={current.leaving} />
}
