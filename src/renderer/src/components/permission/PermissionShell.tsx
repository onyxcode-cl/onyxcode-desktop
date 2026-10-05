/**
 * Shell compartido de las tarjetas de permiso de escritorio (plan ND). Solo escritorio: se importa desde
 * las tarjetas `Desk` de Tareas y de Code, nunca desde la PWA. Anatomía según DESIGN.md y el plan:
 * cabecera (tile + título + consecuencia), comando literal en `bg-code`, alcance y acciones en posiciones
 * fijas. El teclado seguro lo resuelve `usePermGuard` (lib/perm-guard).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ShieldAlert, type LucideIcon } from 'lucide-react'
import { isMacPlatform } from '../../lib/platform'
import { decidePermKey, initialArmState, armState, type ArmState } from '../../lib/perm-guard'
import { Button } from '../Button'

export const permTitleId = (id: string): string => `perm-title-${id}`
export const permEffectId = (id: string): string => `perm-effect-${id}`

// ───────────────────────────── Marco de la tarjeta ─────────────────────────────

export function PermCardFrame({
  id,
  danger,
  armed,
  busy,
  icon: Icon,
  title,
  effect,
  onKeyDown,
  children
}: {
  id: string
  danger: boolean
  armed: boolean
  busy: boolean
  icon: LucideIcon
  title: string
  effect: string
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div
      id={id}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={permTitleId(id)}
      aria-describedby={permEffectId(id)}
      aria-busy={busy || undefined}
      data-armed={armed || undefined}
      onKeyDown={onKeyDown}
      className={`flex flex-col gap-3.5 rounded-card p-4 outline-none focus-visible:shadow-focus ${
        danger ? 'bg-danger/[0.06] ring-1 ring-inset ring-danger/40' : 'bg-elevated ring-1 ring-inset ring-accent/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
            danger ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p id={permTitleId(id)} className="text-title-sm text-fg">
            {title}
          </p>
          <p id={permEffectId(id)} className="mt-0.5 text-ui text-muted">
            {effect}
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

// ───────────────────────────── Comando literal ─────────────────────────────

export const COMMAND_MAX_LINES = 200
export const COMMAND_MAX_CHARS = 20_000

export function PermCommand({
  text,
  prompt,
  hasHidden,
  hiddenMessage,
  longMessage
}: {
  text: string
  /** Prefijo `$` (comando bash). */
  prompt?: boolean
  hasHidden: boolean
  hiddenMessage: string
  longMessage: (n: number) => string
}): React.JSX.Element {
  const lines = text.split('\n').length
  const long = lines > COMMAND_MAX_LINES || text.length > COMMAND_MAX_CHARS
  const body = (
    <pre className="whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-fg">
      {prompt && (
        <span aria-hidden className="select-none text-subtle">
          ${' '}
        </span>
      )}
      {text}
    </pre>
  )
  return (
    <div>
      {long ? (
        <div tabIndex={0} className="max-h-96 overflow-auto rounded-ctl bg-code ring-1 ring-inset ring-border">
          <div className="px-3 py-2.5">{body}</div>
        </div>
      ) : (
        <div className="rounded-ctl bg-code ring-1 ring-inset ring-border">
          <div className="px-3 py-2.5">{body}</div>
        </div>
      )}
      {long && <p className="mt-1.5 text-meta text-muted">{longMessage(lines)}</p>}
      {hasHidden && (
        <p className="mt-1.5 flex items-start gap-1.5 text-meta text-danger">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {hiddenMessage}
        </p>
      )}
    </div>
  )
}

// ───────────────────────────── Alcance ─────────────────────────────

export function PermScope({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted">{children}</div>
}

// ───────────────────────────── Acciones ─────────────────────────────

export interface PermAction {
  label: string
  variant: 'primary' | 'danger' | 'secondary' | 'ghost'
  side: 'left' | 'right'
  /** Botón «Permitir»: se deshabilita hasta el armado y el contenedor bloquea Enter. */
  permit?: boolean
  /** Marca `data-perm-act` para que el contenedor bloquee Enter sobre él. */
  act?: 'once' | 'always'
  kbd?: string
  ariaKeyshortcuts?: string
  title?: string
  onClick: () => void
}

export function PermActions({ actions, armed, busy }: { actions: PermAction[]; armed: boolean; busy: boolean }): React.JSX.Element {
  const render = (a: PermAction): React.JSX.Element => (
    <Button
      key={a.label}
      variant={a.variant}
      size="md"
      disabled={busy || (a.permit && !armed)}
      title={a.title}
      aria-keyshortcuts={a.ariaKeyshortcuts}
      {...(a.act ? { 'data-perm-act': a.act } : {})}
      onClick={a.onClick}
    >
      {a.label}
      {a.kbd && (
        <kbd aria-hidden className="ml-1 rounded border border-current/25 px-1 font-sans text-[10px] leading-4 opacity-70">
          {a.kbd}
        </kbd>
      )}
    </Button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.filter((a) => a.side === 'left').map(render)}
      <span className="flex-1" />
      {actions.filter((a) => a.side === 'right').map(render)}
    </div>
  )
}

// ───────────────────────────── Guardia (teclado + armado) ─────────────────────────────

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

export function usePermGuard({ id, reply, busy }: { id: string; reply: (kind: 'once' | 'reject') => void; busy: boolean }): {
  armed: boolean
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  focusCard: () => void
} {
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  const visibleRef = useRef(false)
  const observingRef = useRef(false)
  const replyRef = useRef(reply)
  replyRef.current = reply
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const el = document.getElementById(id)
    if (!el || typeof IntersectionObserver === 'undefined') {
      observingRef.current = false
      visibleRef.current = false
      armedRef.current = false
      setArmed(false)
      return
    }
    observingRef.current = true
    const root = scrollParent(el)
    let state: ArmState = initialArmState(Date.now(), el.getBoundingClientRect().top)
    const commit = (): void => {
      const y = el.getBoundingClientRect().top
      state = armState(state, { visible: visibleRef.current, now: Date.now(), y })
      if (state.armed !== armedRef.current) {
        armedRef.current = state.armed
        setArmed(state.armed)
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.6)
        commit()
      },
      { root, threshold: [0, 0.6, 1] }
    )
    io.observe(el)
    // El observador se dispara mucho con streaming: se limita la frecuencia con un sondeo barato que usa refs.
    const timer = setInterval(commit, 200)
    return () => {
      io.disconnect()
      clearInterval(timer)
      observingRef.current = false
      visibleRef.current = false
    }
  }, [id])

  const focusCard = useCallback((): void => {
    document.getElementById(id)?.focus({ preventScroll: true })
  }, [id])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = e.target as HTMLElement | null
      const card = document.getElementById(id)
      const dec = decidePermKey(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          repeat: e.repeat,
          isComposing: e.nativeEvent.isComposing ?? false,
          targetIsNote: !!target?.closest?.('[data-perm-note]'),
          targetIsPermit: !!target?.closest?.('[data-perm-act]')
        },
        {
          mac: isMacPlatform(),
          focusInCard: !!card?.contains(target),
          windowFocused: typeof document !== 'undefined' && document.hasFocus(),
          visible: visibleRef.current,
          armed: armedRef.current,
          busy: busyRef.current,
          observing: observingRef.current
        }
      )
      if (dec === 'once') {
        e.preventDefault()
        replyRef.current('once')
      } else if (dec === 'reject') {
        e.stopPropagation()
        replyRef.current('reject')
      } else if (dec === 'block-enter') {
        e.preventDefault()
      }
    },
    [id]
  )

  return { armed, onKeyDown, focusCard }
}
