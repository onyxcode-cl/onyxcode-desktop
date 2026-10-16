/**
 * Aviso claro cuando un documento de Chat no se pudo usar (JSON roto, forma incorrecta, falla al generarlo, falta ArtCraft, respuesta cortada):
 * motivo corto + botón de acción («Reintentar» / «Pedir de nuevo» / «Pedir que continúe») + «Ver detalle». Lo usan el bloque del mensaje
 * (`Markdown.tsx`) y el panel de documento (`ChatDocPanel.tsx`), para que un fallo nunca sea mudo.
 */
import { useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { useT } from '../../lib/i18n'

export type DocProblemReason = 'json' | 'schema' | 'failed' | 'invalid' | 'no-craft' | 'cut'

const REASON_KEY = {
  json: 'chat.doc.problem.json',
  schema: 'chat.doc.problem.schema',
  failed: 'chat.doc.problem.failed',
  invalid: 'chat.doc.problem.invalid',
  'no-craft': 'chat.doc.problem.noCraft',
  cut: 'chat.doc.problem.cut'
} as const satisfies Record<DocProblemReason, string>

/** Clave i18n del motivo corto de un fallo. */
export const docProblemKey = (reason: DocProblemReason): (typeof REASON_KEY)[DocProblemReason] => REASON_KEY[reason]

interface Props {
  reason: DocProblemReason
  /** Texto de la acción principal (ya traducido); sin él no hay botón. */
  actionLabel?: string
  onAction?: () => void
  /** La acción principal está en curso (p. ej. instalando ArtCraft): botón desactivado y con rueda. */
  busy?: boolean
  /** Línea extra bajo el motivo (p. ej. «no se pudo instalar»). */
  extra?: ReactNode
  /** Contenido de «Ver detalle» (motivo técnico, o el propio texto del documento); sin él no hay botón. */
  detail?: ReactNode
  className?: string
}

export function DocNotice({ reason, actionLabel, onAction, busy = false, extra, detail, className = '' }: Props): React.JSX.Element {
  const t = useT()
  const [showDetail, setShowDetail] = useState(false)
  const cut = reason === 'cut'
  return (
    <div role="alert" className={`rounded-lg border border-danger/30 bg-elevated px-3 py-2.5 text-[12.5px] ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">{t(REASON_KEY[reason])}</p>
          {cut && <p className="mt-0.5 text-muted">{t('chat.doc.problem.cutHint')}</p>}
          {extra && <p className="mt-0.5 text-danger">{extra}</p>}
        </div>
      </div>
      {(onAction || detail) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[22px]">
          {onAction && actionLabel && (
            <button
              type="button"
              onClick={onAction}
              disabled={busy}
              className="no-drag inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-hover disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              {actionLabel}
            </button>
          )}
          {detail && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              className="no-drag rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg"
            >
              {t(showDetail ? 'chat.doc.hideDetail' : 'chat.doc.showDetail')}
            </button>
          )}
        </div>
      )}
      {detail && showDetail && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-2 text-[11.5px] desk:text-meta text-muted">
          {detail}
        </pre>
      )}
    </div>
  )
}
