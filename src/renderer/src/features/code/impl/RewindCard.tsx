/**
 * «Cambios de este turno» (tarjeta plegada al final de cada turno que cambió archivos) y el aviso que queda después de volver atrás.
 * Presentacional: no conoce ningún store (quien la usa le pasa `loadDiff`, `onRewind`, `onUndo`…).
 *
 * Los nombres de archivo y los motivos vienen del motor y del proyecto (no son de confianza): se muestran SIEMPRE como nodos de texto
 * de React, sin Markdown, sin HTML y sin enlaces activos. Los números llevan además su texto completo para lectores de pantalla (el
 * color nunca es la única señal: `+N −N` y la etiqueta de estado van en texto).
 */
import { useId, useRef, useState } from 'react'
import { ChevronRight, History, Undo2, X } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import { turnHasCommandOrigin, turnTotals, type TurnDiffResult, type TurnFile, type TurnFileDiff, type TurnSummary } from '@shared/rewind'
import { Button } from '../../../components/Button'
import { DiffView } from '../../../components/DiffView'
import { useT } from '../../../lib/i18n'
import type { RewindNotice } from './rewind-logic'

const STATUS_KEY: Record<TurnFile['status'], MsgKey> = {
  added: 'code.turn.status.added',
  deleted: 'code.turn.status.deleted',
  modified: 'code.turn.status.modified'
}

const ORIGIN_KEY: Record<TurnFile['origen'], MsgKey> = {
  herramienta: 'code.turn.origin.herramienta',
  comando: 'code.turn.origin.comando',
  otro: 'code.turn.origin.otro'
}

const NOT_RESTORABLE_KEY = {
  'sin-git': 'code.turn.notRestorable.sin-git',
  'sin-instantaneas': 'code.turn.notRestorable.sin-instantaneas',
  caducado: 'code.turn.notRestorable.caducado'
} as const satisfies Record<string, MsgKey>

type DiffState = { state: 'loading' } | { state: 'ok'; diff: TurnFileDiff } | { state: 'error'; expired: boolean }

/** Cuántos archivos se listan antes de «y N más» (el motor ya acota a 500 por turno). */
const LIST_MAX = 200

function FileRow({
  file,
  open,
  diff,
  reverted,
  onToggle
}: {
  file: TurnFile
  reverted: boolean
  open: boolean
  diff: DiffState | undefined
  onToggle: () => void
}): React.JSX.Element {
  const t = useT()
  const panelId = useId()
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('code.turn.file.aria', { file: file.file })}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight size={12} aria-hidden className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 font-mono text-[12px] break-all" title={file.file}>
          {file.file}
        </span>
        <span className="shrink-0 rounded border border-border px-1.5 text-meta text-muted">
          {reverted ? t('code.turn.reverted') : t(STATUS_KEY[file.status])}
        </span>
        <span className="shrink-0 rounded border border-border px-1.5 text-meta text-muted">{t(ORIGIN_KEY[file.origen])}</span>
        <span className="shrink-0 font-mono text-meta tabular-nums" aria-hidden>
          {t('code.turn.totals', { add: file.additions, del: file.deletions })}
        </span>
        <span className="sr-only">{t('code.turn.totals.aria', { add: file.additions, del: file.deletions })}</span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-border bg-bg px-3 py-2 text-sm">
          {(!diff || diff.state === 'loading') && <p className="text-muted">{t('code.turn.diff.loading')}</p>}
          {diff?.state === 'error' && (
            <p role="alert" className="text-danger">
              {diff.expired ? t('code.turn.diff.expired') : t('code.turn.diff.error')}
            </p>
          )}
          {diff?.state === 'ok' && diff.diff.binary && <p className="text-muted">{t('code.turn.diff.binary')}</p>}
          {diff?.state === 'ok' && !diff.diff.binary && (
            <>
              {diff.diff.truncated && <p className="mb-1 text-muted">{t('code.turn.diff.truncated')}</p>}
              <DiffView patch={diff.diff.patch} path={file.file} hideFileHeaders />
            </>
          )}
        </div>
      )}
    </li>
  )
}

export interface RewindCardProps {
  summary: TurnSummary
  /** Parche de un archivo del turno (bajo demanda). */
  loadDiff: (file: string) => Promise<TurnDiffResult>
  /** Abre el diálogo «Volver a antes de este turno». */
  onRewind: () => void
  /** La conversación está trabajando: no se puede volver atrás ahora. */
  disabled?: boolean
  /** Archivos que un rebobinado activo ya dejó como estaban antes: se marcan «ya revertido» hasta que se deshaga. */
  revertedFiles?: ReadonlySet<string>
}

export function RewindCard({ summary, loadDiff, onRewind, disabled, revertedFiles }: RewindCardProps): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(new Set())
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({})
  const requested = useRef(new Set<string>())
  const listId = useId()
  if (summary.files.length === 0) return null
  const totals = turnTotals(summary.files)
  const shown = summary.files.slice(0, LIST_MAX)
  const isReverted = (f: string): boolean => !!revertedFiles?.has(f)
  const anyReverted = summary.files.some((f) => isReverted(f.file))
  const allReverted = summary.files.every((f) => isReverted(f.file))

  const toggleFile = (file: string): void => {
    const opening = !openFiles.has(file)
    setOpenFiles((prev) => {
      const next = new Set(prev)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
    if (!opening || requested.current.has(file)) return
    requested.current.add(file)
    setDiffs((d) => ({ ...d, [file]: { state: 'loading' } }))
    void loadDiff(file).then((r) => {
      const state: DiffState = r.ok
        ? { state: 'ok', diff: r.diff }
        : { state: 'error', expired: r.kind === 'conflict' && r.motivo === 'caducado' }
      // Un error se puede reintentar al volver a abrir el archivo.
      if (!r.ok) requested.current.delete(file)
      setDiffs((d) => ({ ...d, [file]: state }))
    })
  }

  return (
    <section aria-label={t('code.turn.title')} className="rounded-xl border border-border bg-elevated text-sm" data-testid="turn-changes">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight size={14} aria-hidden className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <History size={14} aria-hidden className="shrink-0 text-muted" />
        <span className="font-medium">{t('code.turn.title')}</span>
        <span className="text-muted">· {t('code.turn.count', { count: totals.files })}</span>
        <span className="font-mono text-meta tabular-nums text-muted" aria-hidden>
          · {t('code.turn.totals', { add: totals.additions, del: totals.deletions })}
        </span>
        <span className="sr-only">{t('code.turn.totals.aria', { add: totals.additions, del: totals.deletions })}</span>
      </button>
      {open && (
        <div id={listId} className="border-t border-border">
          <ul aria-label={t('code.turn.list.aria')} className="max-h-96 overflow-y-auto">
            {shown.map((f) => (
              <FileRow
                key={f.file}
                file={f}
                open={openFiles.has(f.file)}
                diff={diffs[f.file]}
                reverted={isReverted(f.file)}
                onToggle={() => toggleFile(f.file)}
              />
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-xs text-muted">
            {summary.files.length > shown.length && <p>{t('code.rewind.files.more', { count: summary.files.length - shown.length })}</p>}
            {summary.truncated && <p>{t('code.turn.truncated')}</p>}
            {turnHasCommandOrigin(summary.files) && <p>{t('code.turn.commandWarn')}</p>}
            {summary.files.some((f) => f.origen === 'otro') && <p>{t('code.turn.otherWarn')}</p>}
            {anyReverted && <p>{allReverted ? t('code.turn.revertedAll') : t('code.turn.revertedSome')}</p>}
            {!summary.restaurable && summary.motivo && <p>{t(NOT_RESTORABLE_KEY[summary.motivo])}</p>}
          </div>
          <div className="flex justify-end border-t border-border px-3 py-2">
            <Button variant="secondary" size="sm" disabled={disabled || allReverted} onClick={onRewind}>
              <Undo2 size={13} aria-hidden /> {t('code.turn.rewind')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

const SKIP_KEY: Record<string, MsgKey> = {
  conflicto: 'code.rewind.skip.conflicto',
  protegido: 'code.rewind.skip.protegido',
  'enlace-simbolico': 'code.rewind.skip.enlace-simbolico',
  'fuera-del-proyecto': 'code.rewind.skip.fuera-del-proyecto',
  git: 'code.rewind.skip.git',
  'enlace-fuera-del-proyecto': 'code.rewind.skip.enlace-fuera-del-proyecto',
  'era-una-carpeta': 'code.rewind.skip.era-una-carpeta',
  'no-se-pudo-restaurar': 'code.rewind.skip.no-se-pudo-restaurar'
}

/** Cuántos omitidos se listan en el aviso. */
const SKIPPED_SHOWN = 8

export interface RewindResultNoticeProps {
  notice: RewindNotice
  /** Se está deshaciendo (o la conversación trabaja): «Deshacer» no se ofrece. */
  busy?: boolean
  onUndo: () => void | Promise<unknown>
  onDismiss: () => void
}

/** Aviso después de volver atrás (con «Deshacer» si el motor lo permite) o de deshacer. Región `status` (se anuncia sola). */
export function RewindResultNotice({ notice, busy, onUndo, onDismiss }: RewindResultNoticeProps): React.JSX.Element {
  const t = useT()
  const [undoing, setUndoing] = useState(false)
  const summary =
    notice.kind === 'undone'
      ? t('code.rewind.notice.undone', { restored: notice.restaurados, deleted: notice.borrados })
      : notice.modo === 'conversacion'
        ? t('code.rewind.notice.doneConv', { hidden: notice.mensajesOcultos })
        : t('code.rewind.notice.done', { restored: notice.restaurados, deleted: notice.borrados, hidden: notice.mensajesOcultos })
  const skipped = notice.omitidos.slice(0, SKIPPED_SHOWN)
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('code.rewind.notice.aria')}
      className="flex flex-col gap-1.5 rounded-xl border border-border-strong bg-elevated px-3 py-2 text-sm"
      data-testid="rewind-notice"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1">{summary}</p>
        {notice.kind === 'done' && notice.puedeDeshacer && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || undoing}
            onClick={() => {
              setUndoing(true)
              void Promise.resolve(onUndo()).finally(() => setUndoing(false))
            }}
          >
            <Undo2 size={13} aria-hidden /> {undoing ? t('code.rewind.notice.undoing') : t('code.rewind.notice.undo')}
          </Button>
        )}
        <button
          type="button"
          aria-label={t('code.rewind.notice.dismiss')}
          title={t('code.rewind.notice.dismiss')}
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {skipped.length > 0 && (
        <div className="text-xs text-muted">
          <p>{t('code.rewind.notice.skipped', { count: notice.omitidos.length })}</p>
          <ul className="mt-0.5 list-disc pl-5">
            {skipped.map((o, i) => (
              <li key={`${o.file}-${i}`} className="font-mono break-all">
                {t('code.rewind.notice.skippedItem', {
                  file: o.file,
                  reason: t(Object.hasOwn(SKIP_KEY, o.motivo) ? SKIP_KEY[o.motivo] : 'code.rewind.skip.other')
                })}
              </li>
            ))}
            {notice.omitidos.length > skipped.length && (
              <li className="list-none">{t('code.rewind.notice.more', { count: notice.omitidos.length - skipped.length })}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
