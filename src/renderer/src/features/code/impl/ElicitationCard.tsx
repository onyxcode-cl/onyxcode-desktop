/**
 * Tarjeta de formulario de un conector (MCP `elicitation/create`, modo formulario). La comparten Code y Chat: este archivo no conoce
 * ningún store; quien la usa le pasa `onSubmit`. Modelo de amenazas en `docs/SEGURIDAD.md`, «Formularios de conectores»:
 *
 *  - El texto lo escribe un servidor de terceros: se muestra SIEMPRE como texto plano (nodos de texto de React, nunca HTML ni Markdown),
 *    sin enlaces activos. La cabecera es fija y la pone Lazunox: nombre del conector y si la persona lo marcó de confianza.
 *  - Nada se rellena salvo el `default` del esquema; la persona confirma con «Enviar a <conector>» o se queda sin enviar.
 *  - Esc = cancelar el formulario; el foco queda atrapado en la tarjeta (`aria-modal`) y entra al primer campo al abrirse.
 *  - La validación local replica la del motor (que vuelve a validar y manda): un 400 del motor deja la tarjeta abierta con los motivos.
 *  - Los valores escritos viajan solo a la ruta del motor local; no se guardan en el estado de la app tras enviar ni se registran.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ClipboardList, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import {
  checkElicitation,
  initialDraft,
  type ElicitationAction,
  type ElicitationDraft,
  type ElicitationField,
  type ElicitationFieldError,
  type ElicitationNotice,
  type ElicitationReplyResult,
  type ElicitationRequest,
  type ElicitationValue
} from '@shared/mcp-elicitation'
import { isInternalCodeMcp, sanitizeMcpName } from '@shared/mcp-permissions'
import { m } from '../../../app/mobile/m'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { FOCUSABLE, tabTarget } from '../../../lib/modal-focus'

const ERROR_KEY: Record<ElicitationFieldError['code'], MsgKey> = {
  required: 'code.elicitation.err.required',
  tooShort: 'code.elicitation.err.tooShort',
  tooLong: 'code.elicitation.err.tooLong',
  email: 'code.elicitation.err.email',
  uri: 'code.elicitation.err.uri',
  date: 'code.elicitation.err.date',
  dateTime: 'code.elicitation.err.dateTime',
  number: 'code.elicitation.err.number',
  integer: 'code.elicitation.err.integer',
  option: 'code.elicitation.err.option',
  tooSmall: 'code.elicitation.err.tooSmall',
  tooLarge: 'code.elicitation.err.tooLarge'
}

const NOTICE_KEY: Record<ElicitationNotice['reason'], MsgKey> = {
  secret: 'code.elicitation.notice.secret',
  schema: 'code.elicitation.notice.schema',
  ambiguous: 'code.elicitation.notice.ambiguous',
  timeout: 'code.elicitation.notice.timeout',
  abort: 'code.elicitation.notice.timeout',
  'server-cancel': 'code.elicitation.notice.timeout'
}

/** ¿La persona marcó este conector como de confianza en Ajustes (o es uno interno de la app)? */
export function isTrustedConnector(server: string, trusted: readonly string[]): boolean {
  return isInternalCodeMcp(server) || trusted.some((n) => n === server || sanitizeMcpName(n) === server)
}

/** Texto de ayuda breve bajo el campo (formato o rango), sin repetir lo que el error ya dirá. */
function useHint(f: ElicitationField): string {
  const t = useT()
  if (f.type === 'string' && f.format === 'date') return t('code.elicitation.hint.date')
  if (f.type === 'string' && f.format === 'date-time') return t('code.elicitation.hint.dateTime')
  if ((f.type === 'number' || f.type === 'integer') && f.minimum !== undefined && f.maximum !== undefined)
    return t('code.elicitation.hint.range', { min: f.minimum, max: f.maximum })
  if ((f.type === 'number' || f.type === 'integer') && f.minimum !== undefined) return t('code.elicitation.hint.min', { min: f.minimum })
  if ((f.type === 'number' || f.type === 'integer') && f.maximum !== undefined) return t('code.elicitation.hint.max', { max: f.maximum })
  return ''
}

const INPUT =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60 aria-[invalid=true]:border-danger'

function FieldRow({
  field,
  value,
  error,
  disabled,
  onChange,
  onBlur
}: {
  field: ElicitationField
  value: string | boolean
  error: string | undefined
  disabled: boolean
  onChange: (v: string | boolean) => void
  onBlur: () => void
}): React.JSX.Element {
  const t = useT()
  const uid = useId()
  const inputId = `${uid}-i`
  const descId = `${uid}-d`
  const errId = `${uid}-e`
  const hint = useHint(field)
  const label = field.title ?? field.name
  const describedBy = [field.description || hint ? descId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  const optionalMark =
    !field.required && field.type !== 'boolean' ? <span className="font-normal text-muted"> ({t('code.elicitation.optional')})</span> : null
  const common = {
    id: inputId,
    disabled,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': field.required || undefined
  }

  let control: React.JSX.Element
  if (field.type === 'boolean') {
    control = (
      <label htmlFor={inputId} className="flex cursor-pointer items-start gap-2 text-sm font-medium">
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <span className="min-w-0 break-words">{label}</span>
      </label>
    )
  } else if (field.type === 'enum') {
    control = (
      <select
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={INPUT}
      >
        <option value="">{t('code.elicitation.choose')}</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'string' && (field.maxLength ?? 0) > 200) {
    control = (
      <textarea
        {...common}
        rows={3}
        value={typeof value === 'string' ? value : ''}
        maxLength={field.maxLength}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`${INPUT} resize-y`}
      />
    )
  } else {
    control = (
      <input
        {...common}
        type="text"
        inputMode={
          field.type === 'integer' ? 'numeric' : field.type === 'number' ? 'decimal' : field.format === 'email' ? 'email' : undefined
        }
        value={typeof value === 'string' ? value : ''}
        maxLength={field.type === 'string' ? field.maxLength : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={INPUT}
      />
    )
  }

  return (
    <div className="mb-3">
      {field.type !== 'boolean' && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium break-words">
          {label}
          {optionalMark}
        </label>
      )}
      {control}
      {(field.description || hint) && (
        <p id={descId} className="mt-1 text-xs break-words whitespace-pre-wrap text-muted">
          {[field.description, hint].filter(Boolean).join('\n')}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="mt-1 text-xs break-words text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export interface ElicitationCardProps {
  request: ElicitationRequest
  /** `true`/`false` = se muestra si la persona marcó el conector como de confianza; `undefined` = no se dice nada (Chat no tiene esa marca). */
  trusted?: boolean
  /** Quién ayuda: nombre del ayudante cuando el formulario viene de una sesión hija (opcional). */
  helperLabel?: string
  onSubmit: (action: ElicitationAction, content?: Record<string, ElicitationValue>) => Promise<ElicitationReplyResult>
}

export function ElicitationCard({ request, trusted, helperLabel, onSubmit }: ElicitationCardProps): React.JSX.Element {
  const t = useT()
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const [draft, setDraft] = useState<ElicitationDraft>(() => initialDraft(request.fields))
  const [touched, setTouched] = useState<Record<string, true>>({})
  const [submitted, setSubmitted] = useState(false)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useMemo(() => checkElicitation(request.fields, draft), [request.fields, draft])
  const errorText = (name: string): string | undefined => {
    const local = check.errors[name]
    if ((submitted || touched[name]) && local) {
      const key = ERROR_KEY[local.code]
      return t(key, { min: 'min' in local ? local.min : '', max: 'max' in local ? local.max : '' })
    }
    return issues[name]
  }

  // Al abrirse el foco entra al primer campo (o al botón principal si no hay campos): el formulario se contesta sin buscar con el ratón.
  useEffect(() => {
    const root = rootRef.current
    if (!root || root.contains(document.activeElement)) return
    const first = root.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
    ;(first ?? root.querySelector<HTMLElement>('button[type="submit"]'))?.focus()
  }, [])

  const run = (action: ElicitationAction, content?: Record<string, ElicitationValue>): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    void (content ? onSubmit(action, content) : onSubmit(action))
      .then((res) => {
        if (res.ok) return
        if ('gone' in res) {
          setError(t('code.elicitation.gone'))
        } else if ('invalid' in res) {
          const byField: Record<string, string> = {}
          for (const i of res.invalid) if (i.campo in draft) byField[i.campo] = t('code.elicitation.err.engine', { reason: i.motivo })
          setIssues(byField)
          if (Object.keys(byField).length === 0) setError(t('code.elicitation.err.engineGeneric'))
        } else {
          setError(t('code.elicitation.err.send', { detail: res.error }))
        }
      })
      .catch((err: unknown) => setError(t('code.elicitation.err.send', { detail: err instanceof Error ? err.message : String(err) })))
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    setSubmitted(true)
    setIssues({})
    if (request.fields.some((f) => check.errors[f.name])) {
      // Lleva el foco al primer campo con error, cuando ya se pintó el estado inválido.
      setTimeout(() => rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    run('accept', check.content)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.stopPropagation()
      run('cancel')
      return
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Foco atrapado: Tab y Mayús+Tab dan la vuelta dentro de la tarjeta.
      const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      const target = tabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)
      if (target !== null) {
        e.preventDefault()
        items[target].focus()
      }
    }
  }

  const time = new Date(request.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const hasText = request.fields.some((f) => f.type === 'string')
  const TrustIcon = trusted ? ShieldCheck : ShieldAlert

  return (
    <div
      {...m('pending-card')}
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-t`}
      aria-describedby={request.message ? `${uid}-m` : undefined}
      onKeyDown={onKeyDown}
      className="my-2 overflow-hidden rounded-xl border border-accent/40 bg-elevated shadow-sm ring-4 ring-accent/5"
    >
      <form noValidate onSubmit={submit}>
        {/* Cabecera FIJA: la escribe Lazunox, no el conector. */}
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <ClipboardList size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h4 id={`${uid}-t`} className="text-sm font-semibold break-words">
              {t('code.elicitation.title', { server: request.server })}
            </h4>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              {trusted !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <TrustIcon size={12} aria-hidden="true" className={trusted ? 'text-accent' : 'text-warning'} />
                  {trusted ? t('code.elicitation.trusted') : t('code.elicitation.untrusted')}
                </span>
              )}
              {helperLabel && <span>{helperLabel}</span>}
              <span>{t('code.elicitation.expires', { time })}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{t('code.elicitation.lead')}</p>
          </div>
        </div>

        {/* Texto del conector: texto plano (nodos de texto, nunca HTML ni Markdown), sin enlaces activos. */}
        <div className="px-3.5 pb-2">
          {request.message && (
            <p id={`${uid}-m`} className="mb-3 text-sm break-words whitespace-pre-wrap">
              {request.message}
            </p>
          )}
          {request.fields.length === 0 && <p className="mb-3 text-xs text-muted">{t('code.elicitation.noFields')}</p>}
          {request.fields.map((f) => (
            <FieldRow
              key={f.name}
              field={f}
              value={draft[f.name] ?? ''}
              error={errorText(f.name)}
              disabled={busy}
              onChange={(v) => {
                setDraft((d) => ({ ...d, [f.name]: v }))
                setIssues((i) => {
                  if (!(f.name in i)) return i
                  const next = { ...i }
                  delete next[f.name]
                  return next
                })
              }}
              onBlur={() => setTouched((tc) => (tc[f.name] ? tc : { ...tc, [f.name]: true }))}
            />
          ))}
          {hasText && <p className="mb-2 text-xs text-muted">{t('code.elicitation.never')}</p>}
          {error && (
            <p role="alert" className="mb-2 text-xs break-words text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-bg/40 px-3 py-2">
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy} className="max-w-full min-w-0">
            <span className="truncate">
              {busy ? t('code.elicitation.sending') : t('code.elicitation.send', { server: request.server })}
            </span>
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run('decline')}>
            {t('code.elicitation.decline')}
          </Button>
          <span className="ml-auto text-xs text-muted">{t('code.elicitation.escHint')}</span>
        </div>
      </form>
    </div>
  )
}

/** Aviso breve (rechazo que la persona no llegó a ver, o formulario caducado). Texto fijo de Lazunox; nunca lleva texto del conector. */
export function ElicitationNoticeRow({ notice, onDismiss }: { notice: ElicitationNotice; onDismiss: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div role="status" className="my-1 flex items-start gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted">
      <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 break-words">{t(NOTICE_KEY[notice.reason])}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('code.elicitation.notice.dismiss')}
        className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
