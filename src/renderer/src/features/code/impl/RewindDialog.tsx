/**
 * Diálogo «Volver a antes de este turno». Presentacional: quien lo monta le pasa `loadReview` (revisión previa, solo lectura),
 * `onConfirm` (rebobina) y `onFallback` (el motor no tiene estas rutas: se sigue con «Revertir» de siempre).
 *
 * Reglas (plan `docs/PLAN-REBOBINAR-Y-COMPACTACION.md`, 2.A.8, y `docs/SEGURIDAD.md`, «Rebobinar por turno»):
 *  - Tres modos explicados en llano. Sin soporte de archivos (carpeta sin git, sin copias, punto caducado) solo se ofrece «Solo la
 *    conversación» y el diálogo lo dice: nunca promete deshacer archivos que no puede.
 *  - Los archivos que cambiaron después del turno (conflictos) y las rutas protegidas llegan DESMARCADOS: se saltan salvo que la
 *    persona los marque uno por uno. Solo viajan en `sobrescribir` los marcados (`overwriteSelection`).
 *  - Los nombres de archivo y los asuntos de commit no son de confianza: texto plano, sin Markdown ni enlaces.
 *  - Accesible: `role="dialog"` con el foco atrapado (DialogFrame), Esc cancela, el primer radio recibe el foco al estar lista la
 *    revisión y los estados (revisando, error, resultado) se anuncian en una región `aria-live`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MsgKey } from '@shared/i18n'
import {
  availableModes,
  filesToRestore,
  overwriteSelection,
  type RewindBlocked,
  type RewindMode,
  type RewindOutcome,
  type RewindReview,
  type RewindReviewResult
} from '@shared/rewind'
import { Button } from '../../../components/Button'
import { DialogFrame } from '../../../components/DialogFrame'
import { useT } from '../../../lib/i18n'

const MODE_KEY: Record<RewindMode, { label: MsgKey; hint: MsgKey; confirm: MsgKey; summary: MsgKey }> = {
  todo: {
    label: 'code.rewind.mode.todo',
    hint: 'code.rewind.mode.todo.hint',
    confirm: 'code.rewind.confirm.todo',
    summary: 'code.rewind.summary.todo'
  },
  conversacion: {
    label: 'code.rewind.mode.conversacion',
    hint: 'code.rewind.mode.conversacion.hint',
    confirm: 'code.rewind.confirm.conversacion',
    summary: 'code.rewind.summary.conversacion'
  },
  codigo: {
    label: 'code.rewind.mode.codigo',
    hint: 'code.rewind.mode.codigo.hint',
    confirm: 'code.rewind.confirm.codigo',
    summary: 'code.rewind.summary.codigo'
  }
}

const MODE_ORDER: readonly RewindMode[] = ['todo', 'codigo', 'conversacion']

const BLOCKED_KEY: Record<RewindBlocked, MsgKey> = {
  ocupada: 'code.rewind.blocked.ocupada',
  'hija-ocupada': 'code.rewind.blocked.hija-ocupada',
  'trabajo-vivo': 'code.rewind.blocked.trabajo-vivo',
  pendiente: 'code.rewind.blocked.pendiente'
}

const NO_FILES_KEY = {
  'sin-git': 'code.rewind.noFiles.sin-git',
  'sin-instantaneas': 'code.rewind.noFiles.sin-instantaneas',
  caducado: 'code.rewind.noFiles.caducado'
} as const satisfies Record<string, MsgKey>

const CONFLICT_KEY = {
  ocupada: 'code.rewind.conflict.ocupada',
  'hija-ocupada': 'code.rewind.conflict.hija-ocupada',
  'trabajo-vivo': 'code.rewind.conflict.trabajo-vivo',
  pendiente: 'code.rewind.conflict.pendiente',
  caducado: 'code.rewind.conflict.caducado',
  'sin-git': 'code.rewind.conflict.sin-git',
  'sin-instantaneas': 'code.rewind.conflict.sin-instantaneas',
  'revert-pendiente': 'code.rewind.conflict.revert-pendiente',
  'nada-que-deshacer': 'code.rewind.conflict.nada-que-deshacer'
} as const satisfies Record<string, MsgKey>

/** Archivos que se listan antes de «y N más». */
const LIST_SHOWN = 12

function PathList({ paths }: { paths: readonly string[] }): React.JSX.Element {
  const t = useT()
  return (
    <ul className="mt-1 list-disc pl-5 font-mono text-xs break-all">
      {paths.slice(0, LIST_SHOWN).map((p, i) => (
        <li key={`${p}-${i}`}>{p}</li>
      ))}
      {paths.length > LIST_SHOWN && <li className="list-none">{t('code.rewind.files.more', { count: paths.length - LIST_SHOWN })}</li>}
    </ul>
  )
}

function OverwriteList({
  intro,
  paths,
  marked,
  onToggle,
  disabled
}: {
  intro: string
  paths: readonly string[]
  marked: ReadonlySet<string>
  onToggle: (path: string) => void
  disabled: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <p className="text-fg">{intro}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {paths.map((p, i) => (
          <li key={`${p}-${i}`}>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={marked.has(p)}
                disabled={disabled}
                onChange={() => onToggle(p)}
                aria-label={t('code.rewind.overwrite', { file: p })}
                className="mt-0.5 shrink-0"
              />
              <span className="font-mono break-all">{p}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface RewindDialogProps {
  loadReview: () => Promise<RewindReviewResult>
  onConfirm: (modo: RewindMode, overwrite: readonly string[]) => Promise<RewindOutcome>
  /** El motor no tiene las rutas (404): quien monta cierra esto y sigue con el «Revertir» de siempre. */
  onFallback: () => void
  onClose: () => void
}

export function RewindDialog({ loadReview, onConfirm, onFallback, onClose }: RewindDialogProps): React.JSX.Element {
  const t = useT()
  const [review, setReview] = useState<RewindReview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<RewindMode>('conversacion')
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const firstRadio = useRef<HTMLInputElement | null>(null)
  const fallbackRef = useRef(onFallback)
  fallbackRef.current = onFallback

  useEffect(() => {
    let cancelled = false
    void loadReview().then((r) => {
      if (cancelled) return
      if (r.ok) {
        setReview(r.review)
        // Lo más completo cuando se puede; si no hay soporte de archivos, solo la conversación.
        setMode(availableModes(r.review)[0])
      } else if (r.kind === 'unavailable') fallbackRef.current()
      else if (r.kind === 'conflict') setLoadError(r.motivo ? t(CONFLICT_KEY[r.motivo]) : r.message)
      else setLoadError(r.kind === 'error' ? r.error : r.message)
    })
    return () => {
      cancelled = true
    }
    // La revisión se pide una sola vez al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El primer radio recibe el foco cuando la revisión está lista (mientras se carga el foco queda en el marco del diálogo).
  useEffect(() => {
    if (review) firstRadio.current?.focus()
  }, [review])

  const modes = useMemo(() => (review ? MODE_ORDER.filter((m) => availableModes(review).includes(m)) : []), [review])
  const overwrite = useMemo(() => (review ? overwriteSelection(review, marked) : []), [review, marked])
  const restoring = useMemo(() => (review ? filesToRestore(review, overwrite) : []), [review, overwrite])
  const blocked = review?.bloqueado
  const filesMode = mode !== 'conversacion'
  const canConfirm = !!review && !blocked && !submitting && (mode === 'conversacion' || review.restaurable)

  const toggle = (path: string): void =>
    setMarked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return
    setSubmitting(true)
    setFailure(null)
    try {
      const res = await onConfirm(mode, filesMode ? overwrite : [])
      if (res.ok) {
        onClose()
        return
      }
      if (res.kind === 'unavailable') {
        onFallback()
        return
      }
      setFailure(
        t('code.rewind.failed', {
          error:
            res.kind === 'conflict'
              ? res.motivo
                ? t(CONFLICT_KEY[res.motivo])
                : res.message
              : res.kind === 'error'
                ? res.error
                : res.message
        })
      )
    } finally {
      setSubmitting(false)
    }
  }

  const summary = review
    ? t(MODE_KEY[mode].summary, {
        files: t('code.rewind.summary.files', { count: restoring.length }),
        messages: t('code.rewind.summary.messages', { count: review.mensajes })
      })
    : ''

  return (
    <DialogFrame
      title={t('code.rewind.title')}
      size="lg"
      dismissable={!submitting}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" disabled={submitting} onClick={onClose}>
            {t('code.rewind.cancel')}
          </Button>
          <Button variant="primary" disabled={!canConfirm} loading={submitting} onClick={() => void confirm()}>
            {submitting ? t('code.rewind.working') : t(MODE_KEY[mode].confirm)}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
        <p>{t('code.rewind.lead')}</p>
        <div role="status" aria-live="polite" className="contents">
          {!review && !loadError && <p className="text-muted">{t('code.rewind.loading')}</p>}
        </div>
        {loadError && (
          <p role="alert" className="text-danger">
            {t('code.rewind.reviewFailed', { error: loadError })}
          </p>
        )}
        {review && (
          <>
            {!review.restaurable && (
              <p className="rounded-lg border border-border bg-bg px-3 py-2 text-fg">
                {t(review.motivo ? NO_FILES_KEY[review.motivo] : 'code.rewind.noFiles.other')}
              </p>
            )}
            <div role="radiogroup" aria-label={t('code.rewind.modes.aria')} className="flex flex-col gap-2">
              {modes.map((m, i) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${mode === m ? 'border-accent bg-accent-soft' : 'border-border'}`}
                >
                  <input
                    ref={i === 0 ? firstRadio : undefined}
                    type="radio"
                    name="rewind-mode"
                    value={m}
                    checked={mode === m}
                    disabled={submitting}
                    onChange={() => setMode(m)}
                    className="mt-1 shrink-0"
                  />
                  <span>
                    <span className="block font-medium text-fg">{t(MODE_KEY[m].label)}</span>
                    <span className="block text-xs text-muted">{t(MODE_KEY[m].hint)}</span>
                  </span>
                </label>
              ))}
            </div>
            {blocked && (
              <p role="alert" className="rounded-lg border border-danger px-3 py-2 text-danger">
                {t(BLOCKED_KEY[blocked])}
              </p>
            )}
            {review.ayudantesActivos.length > 0 && (
              <div className="rounded-lg border border-border bg-bg px-3 py-2">
                <p className="text-fg">{t('code.rewind.helpers')}</p>
                <PathList paths={review.ayudantesActivos.map((h) => h.titulo || h.id)} />
              </div>
            )}
            {filesMode && review.restaurable && (
              <>
                {restoring.length > 0 && (
                  <div>
                    <p className="text-fg">{t('code.rewind.files')}</p>
                    <PathList paths={restoring.map((f) => f.file)} />
                  </div>
                )}
                {review.conflictos.length > 0 && (
                  <OverwriteList
                    intro={t('code.rewind.conflicts')}
                    paths={review.conflictos}
                    marked={marked}
                    onToggle={toggle}
                    disabled={submitting}
                  />
                )}
                {review.protegidos.length > 0 && (
                  <OverwriteList
                    intro={t('code.rewind.protected')}
                    paths={review.protegidos}
                    marked={marked}
                    onToggle={toggle}
                    disabled={submitting}
                  />
                )}
                {review.comandos && <p className="text-xs text-muted">{t('code.rewind.commands')}</p>}
                {review.commitsDespues.length > 0 && (
                  <div className="text-xs text-muted">
                    <p>{t('code.rewind.commits')}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {review.commitsDespues.map((c, i) => (
                        <li key={`${c.hash}-${i}`} className="break-all">
                          <span className="font-mono">{c.hash}</span> {c.asunto}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <p role="status" aria-live="polite" className="font-medium text-fg">
              {summary}
            </p>
          </>
        )}
        {failure && (
          <p role="alert" className="text-danger">
            {failure}
          </p>
        )}
      </div>
    </DialogFrame>
  )
}
