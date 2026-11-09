/**
 * Tablero «Ayudantes»: lista de los subagentes de la conversación activa con estado, modelo, tokens, costo y tiempo, y las acciones
 * «Ver» (su conversación, solo lectura), «Detener» y «Detener todos». Es presentación: `CodeHelpersBoard` le da los datos del almacén
 * y decide si hay permiso para pedir algo al motor (carpeta con foco y confianza vigente). Lo que no se sabe sale como «sin dato».
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Ban, Bot, Check, ChevronDown, ChevronRight, Loader2, OctagonX, ShieldQuestion, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { formatCost, formatTokens } from '../../../lib/format'
import { isRemoteSurface } from '../../../lib/platform'
import { formatElapsed } from './background-jobs'
import { MAX_HELPER_ROWS, type HelperBoard, type HelperRow, type HelperState } from './helpers-board'

/** Un mensaje de la conversación del ayudante, ya reducido a texto plano para mostrarlo. */
export interface HelperLine {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: string[]
}

interface Props {
  board: HelperBoard
  /** Se puede pedir algo al motor (carpeta con foco y confianza vigente). Sin esto solo se ve el tablero. */
  canAct: boolean
  onStop: (id: string) => Promise<void> | void
  onStopAll: () => Promise<void> | void
  /** Mensajes de un ayudante, solo lectura. */
  onLoadConversation: (id: string) => Promise<HelperLine[]>
  /** Cambia cuando llega algo nuevo del ayudante abierto: se recarga su conversación (sin sondeo). */
  conversationVersion?: (id: string) => string
}

const STATE_KEY = {
  working: 'helpers.state.working',
  waiting: 'helpers.state.waiting',
  blocked: 'helpers.state.blocked',
  done: 'helpers.state.done',
  error: 'helpers.state.error',
  stopped: 'helpers.state.stopped'
} as const satisfies Record<HelperState, string>

function StateIcon({ state }: { state: HelperState }): React.JSX.Element {
  switch (state) {
    case 'working':
      return <Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
    case 'waiting':
      return <ShieldQuestion size={13} className="text-warning" aria-hidden />
    case 'blocked':
      return <OctagonX size={13} className="text-warning" aria-hidden />
    case 'done':
      return <Check size={13} className="text-accent" aria-hidden />
    case 'stopped':
      return <Ban size={13} className="text-muted" aria-hidden />
    default:
      return <AlertCircle size={13} className="text-danger" aria-hidden />
  }
}

function Conversation({ row, load, version }: { row: HelperRow; load: Props['onLoadConversation']; version: string }): React.JSX.Element {
  const t = useT()
  const [lines, setLines] = useState<HelperLine[] | null>(null)
  const [failed, setFailed] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    let alive = true
    const run = (): void => {
      load(row.id).then(
        (l) => {
          if (!alive) return
          setLines(l)
          setFailed(false)
        },
        () => alive && setFailed(true)
      )
    }
    // La primera carga es inmediata; las siguientes esperan un poco para juntar varios eventos seguidos del ayudante en una sola.
    if (first.current) {
      first.current = false
      run()
      return () => {
        alive = false
      }
    }
    const id = setTimeout(run, 1200)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [row.id, version, load])
  return (
    <div
      role="region"
      aria-label={t('helpers.conv.title', { title: row.title })}
      className="mt-1 rounded-lg border border-border bg-bg/60 p-2"
    >
      <p className="mb-1 text-xs font-medium text-muted">{t('helpers.conv.title', { title: row.title })}</p>
      <div className="max-h-64 overflow-y-auto text-xs">
        {failed && (
          <p role="alert" className="text-danger">
            {t('helpers.conv.failed')}
          </p>
        )}
        {!failed && lines === null && <p className="text-subtle">{t('helpers.conv.loading')}</p>}
        {!failed && lines?.length === 0 && <p className="text-subtle">{t('helpers.conv.empty')}</p>}
        {lines?.map((l) => (
          <div key={l.id} className="mb-2">
            <div className="font-medium text-muted">{t(l.role === 'user' ? 'helpers.conv.user' : 'helpers.conv.assistant')}</div>
            {l.text && <div className="whitespace-pre-wrap break-words text-fg">{l.text}</div>}
            {l.tools.length > 0 && <div className="text-subtle">{l.tools.map((tool) => t('helpers.conv.tool', { tool })).join(' · ')}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function HelpersBoard({
  board,
  canAct,
  onStop,
  onStopAll,
  onLoadConversation,
  conversationVersion
}: Props): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(true)
  const [viewing, setViewing] = useState<string | null>(null)
  const [stopping, setStopping] = useState<Record<string, boolean>>({})
  const [stopFailed, setStopFailed] = useState<Record<string, boolean>>({})
  const [allFailed, setAllFailed] = useState(false)
  if (board.rows.length === 0) return null

  const touch = isRemoteSurface()
  const shown = board.rows.slice(0, MAX_HELPER_ROWS)
  const hidden = board.rows.length - shown.length
  const btn = `flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${touch ? 'h-11' : 'h-6'}`

  const stop = async (id: string): Promise<void> => {
    setStopping((c) => ({ ...c, [id]: true }))
    setStopFailed((f) => ({ ...f, [id]: false }))
    try {
      await onStop(id)
    } catch {
      setStopFailed((f) => ({ ...f, [id]: true }))
    } finally {
      setStopping((c) => ({ ...c, [id]: false }))
    }
  }
  const stopAll = async (): Promise<void> => {
    setAllFailed(false)
    try {
      await onStopAll()
    } catch {
      setAllFailed(true)
    }
  }

  return (
    <section
      aria-label={t('helpers.title')}
      className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${touch ? 'px-3' : 'px-6'}`}
    >
      <div className="rounded-xl border border-border bg-elevated/60 px-3 py-2 text-[13px]">
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(open ? 'helpers.toggleClose' : 'helpers.toggleOpen')}
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
          >
            {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            <Bot size={13} aria-hidden />
            <h3 className="font-medium">{t('helpers.title')}</h3>
          </button>
          <span className="text-subtle">
            {t('helpers.total', { count: board.rows.length })}
            {board.liveCount > 0 && ` · ${t('helpers.count', { count: board.liveCount })}`}
          </span>
          <span className="flex-1" />
          {allFailed && (
            <span role="alert" className="text-danger">
              {t('helpers.stopAllFailed')}
            </span>
          )}
          {canAct && board.liveCount > 0 && (
            <button type="button" className={btn} onClick={() => void stopAll()}>
              <X size={12} aria-hidden />
              {t('helpers.stopAll')}
            </button>
          )}
        </div>
        {open && (
          <>
            <p className="mt-1 text-xs text-subtle" data-testid="helpers-totals">
              {board.totalTokens === null
                ? t('helpers.tokensNone')
                : t('helpers.totals', { tokens: formatTokens(board.totalTokens) }) +
                  (board.totalCost !== null ? t('helpers.totalsCost', { cost: formatCost(board.totalCost) }) : '')}
              {board.totalTokens !== null && board.unknownTokens > 0 && ` · ${t('helpers.partial', { count: board.unknownTokens })}`}
            </p>
            {!canAct && (
              <p role="status" className="mt-1 text-xs text-warning">
                {t('helpers.noFocus')}
              </p>
            )}
            <ul className="mt-1 flex max-h-72 flex-col gap-1 overflow-y-auto">
              {shown.map((row) => (
                <li key={row.id} className="flex flex-col">
                  <div className={`flex items-center gap-2 ${touch ? 'min-h-11 flex-wrap' : ''}`}>
                    <StateIcon state={row.state} />
                    <span className={`min-w-0 flex-1 truncate ${row.live ? 'text-fg' : 'text-muted'}`} title={row.title}>
                      {row.title}
                      {row.agent && <span className="text-subtle"> · {t('helpers.agent', { agent: row.agent })}</span>}
                      {row.background && <span className="text-subtle"> · {t('helpers.background')}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{t(STATE_KEY[row.state])}</span>
                    <span className="shrink-0 text-xs text-subtle" title={row.model ?? undefined}>
                      {t('helpers.model', { model: row.model ?? t('helpers.noData') })}
                    </span>
                    <span
                      className="shrink-0 text-xs tabular-nums text-subtle"
                      title={
                        row.tokens
                          ? t('helpers.tokensTitle', { input: formatTokens(row.tokens.input), output: formatTokens(row.tokens.output) })
                          : undefined
                      }
                    >
                      {row.tokens
                        ? t('helpers.tokens', { count: row.tokens.total, tokens: formatTokens(row.tokens.total) })
                        : t('helpers.tokensNone')}
                    </span>
                    {row.cost !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-subtle">{t('helpers.cost', { cost: formatCost(row.cost) })}</span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums text-subtle">{formatElapsed(row.elapsedMs)}</span>
                    {stopFailed[row.id] && (
                      <span role="alert" className="shrink-0 text-xs text-danger">
                        {t('helpers.stopFailed')}
                      </span>
                    )}
                    {canAct && (
                      <button
                        type="button"
                        aria-expanded={viewing === row.id}
                        aria-label={t('helpers.viewFor', { title: row.title })}
                        onClick={() => setViewing((v) => (v === row.id ? null : row.id))}
                        className={btn}
                      >
                        {viewing === row.id ? t('helpers.hide') : t('helpers.view')}
                      </button>
                    )}
                    {canAct && row.live && (
                      <button
                        type="button"
                        disabled={stopping[row.id]}
                        aria-label={t('helpers.stopFor', { title: row.title })}
                        onClick={() => void stop(row.id)}
                        className={btn}
                      >
                        <X size={12} aria-hidden />
                        {t('helpers.stop')}
                      </button>
                    )}
                  </div>
                  {canAct && viewing === row.id && (
                    <Conversation row={row} load={onLoadConversation} version={conversationVersion?.(row.id) ?? ''} />
                  )}
                </li>
              ))}
            </ul>
            {hidden > 0 && <p className="mt-1 text-xs text-subtle">{t('helpers.more', { count: hidden })}</p>}
          </>
        )}
      </div>
    </section>
  )
}
