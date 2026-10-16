/**
 * Shell compartido de las tarjetas de permiso de escritorio (plan ND). Solo escritorio: se importa desde
 * las tarjetas `Desk` de Tareas y de Code, nunca desde la PWA. Anatomía según DESIGN.md y el plan:
 * cabecera (tile + título + consecuencia), comando literal en `bg-code`, alcance y acciones en posiciones
 * fijas. El teclado seguro lo resuelve `usePermGuard` (lib/perm-guard).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ShieldAlert, type LucideIcon } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isMacPlatform } from '../../lib/platform'
import { ARM_MS, decidePermKey, initialArmState, armState, type ArmState } from '../../lib/perm-guard'
import { Button } from '../Button'

/** Caracteres de control, marcas bidi y espacios invisibles que pueden ocultar el contenido real de un comando. */
const HIDDEN_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/

/** true si `text` contiene caracteres de control/unicode invisibles que podrían ocultar contenido. */
export function hasHiddenChars(text: string): boolean {
  return HIDDEN_CHARS_RE.test(text)
}

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
  preview,
  details,
  detailsOpen = false,
  onKeyDown,
  children
}: {
  id: string
  danger: boolean
  armed: boolean
  busy: boolean
  icon: LucideIcon
  title: string
  effect?: string
  /** Resumen de una línea (siempre visible), p. ej. el comando abreviado. */
  preview?: ReactNode
  /** Detalles plegables (comando completo, diff, alcance…). Siguen en el DOM, solo ocultos, para lectores y pruebas. */
  details?: ReactNode
  /** Abierto desde el principio (riesgo alto o comando que no cabe en una línea). */
  detailsOpen?: boolean
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(detailsOpen)
  // Si la misma tarjeta pasa a pedir el detalle abierto (el comando cambió a algo largo), se abre y ya no se cierra sola.
  useEffect(() => {
    if (detailsOpen) setOpen(true)
  }, [detailsOpen])
  const detailsId = `perm-details-${id}`
  return (
    <div
      id={`perm-${id}`}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={permTitleId(id)}
      aria-describedby={effect ? permEffectId(id) : undefined}
      aria-busy={busy || undefined}
      data-armed={armed || undefined}
      onKeyDown={onKeyDown}
      className={`flex flex-col gap-2 rounded-card p-3 outline-none focus-visible:shadow-focus ${
        danger ? 'bg-danger/[0.06] ring-1 ring-inset ring-danger/40' : 'bg-elevated ring-1 ring-inset ring-accent/40'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${
            danger ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <p id={permTitleId(id)} className="min-w-0 flex-1 truncate text-title-sm text-fg" title={title}>
          {title}
        </p>
        {details && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((o) => !o)}
            className="no-drag inline-flex shrink-0 items-center gap-1 rounded-ctl px-2 py-1 text-ui text-muted outline-none hover:bg-hover hover:text-fg focus-visible:shadow-focus"
          >
            {open ? t('perm.details.hide') : t('perm.details.show')}
            <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {effect && (
        <p id={permEffectId(id)} className={open || !details ? 'text-ui text-muted' : 'sr-only'}>
          {effect}
        </p>
      )}
      {preview}
      {details && (
        <div id={detailsId} hidden={!open} className="flex flex-col gap-3">
          {details}
        </div>
      )}
      {children}
    </div>
  )
}

/** Resumen de una línea: el comando o la ruta literales (abreviados con «…» si no caben; completos en el detalle y en el título). */
export function PermPreview({
  text,
  prompt,
  danger,
  extra
}: {
  text: string
  prompt?: boolean
  danger?: boolean
  extra?: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`flex items-center gap-2 rounded-ctl bg-code px-3 py-1.5 ring-1 ring-inset ${danger ? 'ring-danger/30' : 'ring-border'}`}
      title={text}
    >
      <p className="min-w-0 flex-1 truncate font-mono text-[13px] leading-5 text-fg">
        {prompt && (
          <span aria-hidden className="select-none text-subtle">
            ${' '}
          </span>
        )}
        {text.split('\n')[0]}
        {text.includes('\n') ? ' …' : ''}
      </p>
      {extra}
    </div>
  )
}

/** ¿El comando cabe entero en la línea de resumen? Si no (varias líneas, largo o con caracteres ocultos), el detalle nace abierto. */
export const PREVIEW_MAX_CHARS = 90
export function previewFits(text: string, hidden: boolean): boolean {
  return !hidden && !text.includes('\n') && text.length <= PREVIEW_MAX_CHARS
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
        <kbd aria-hidden className="ml-1 rounded border border-current/25 px-1 font-sans text-[10px] desk:text-meta leading-4 opacity-70">
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
  const domId = `perm-${id}`
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  const visibleRef = useRef(false)
  const observingRef = useRef(false)
  const replyRef = useRef(reply)
  replyRef.current = reply
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const el = document.getElementById(domId)
    if (!el || typeof IntersectionObserver === 'undefined') {
      // Sin observador: el clic se arma por tiempo; el teclado (⌘↵) queda desactivado (`observing` = false).
      observingRef.current = false
      visibleRef.current = false
      armedRef.current = false
      setArmed(false)
      const timer = setTimeout(() => {
        armedRef.current = true
        setArmed(true)
      }, ARM_MS)
      return () => clearTimeout(timer)
    }
    observingRef.current = true
    const root = scrollParent(el)
    let state: ArmState = initialArmState(Date.now(), el.getBoundingClientRect().top)
    // «Visible» se calcula midiendo la tarjeta contra el área de desplazamiento en cada vuelta (no solo cuando el observador avisa: este solo
    // avisa al cruzar sus umbrales, y una tarjeta más alta que la ventana se queda entre dos umbrales y nunca volvía a avisar). Cuenta como
    // visible si se ve al menos el 60 % de la tarjeta o, si es más alta que la ventana, al menos el 60 % de la altura visible.
    const measureVisible = (): boolean => {
      if (document.visibilityState === 'hidden') return false
      const r = el.getBoundingClientRect()
      const top = root ? root.getBoundingClientRect().top : 0
      const bottom = root ? root.getBoundingClientRect().bottom : window.innerHeight
      const shown = Math.min(r.bottom, bottom) - Math.max(r.top, top)
      if (shown <= 0 || r.height <= 0) return false
      return shown / r.height >= 0.6 || shown >= (bottom - top) * 0.6
    }
    const commit = (): void => {
      visibleRef.current = measureVisible()
      const y = el.getBoundingClientRect().top
      state = armState(state, { visible: visibleRef.current, now: Date.now(), y })
      if (state.armed !== armedRef.current) {
        armedRef.current = state.armed
        setArmed(state.armed)
      }
    }
    const io = new IntersectionObserver(() => commit(), { root, threshold: [0, 0.25, 0.6, 1] })
    io.observe(el)
    // El observador se dispara mucho con streaming: se limita la frecuencia con un sondeo barato que usa refs.
    const timer = setInterval(commit, 200)
    return () => {
      io.disconnect()
      clearInterval(timer)
      observingRef.current = false
      visibleRef.current = false
    }
  }, [domId])

  // Al resolverse (la tarjeta se desmonta), si el foco estaba en ella pasa al CONTENEDOR de la siguiente pendiente
  // (nunca a un botón Permitir) o al compositor si no queda ninguna. Layout effect: corre antes de quitar el DOM.
  useLayoutEffect(() => {
    return () => {
      const el = document.getElementById(domId)
      if (!el || !el.contains(document.activeElement)) return
      const next = [...document.querySelectorAll<HTMLElement>('[role="alertdialog"][id^="perm-"]')].find((n) => n.id !== domId)
      const target = next ?? document.querySelector<HTMLElement>('[data-kb-composer], [data-code-composer]')
      target?.focus({ preventScroll: true })
    }
  }, [domId])

  const focusCard = useCallback((): void => {
    document.getElementById(domId)?.focus({ preventScroll: true })
  }, [domId])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = e.target as HTMLElement | null
      const card = document.getElementById(domId)
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
    [domId]
  )

  return { armed, onKeyDown, focusCard }
}
