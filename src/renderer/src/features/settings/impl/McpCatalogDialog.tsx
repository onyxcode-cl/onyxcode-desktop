/**
 * Diálogo de confirmación de un conector del catálogo MCP (F8-B24). Muestra, antes de escribir nada:
 * qué podrá hacer, a qué servidor se conecta (host y URL completa), qué datos salen, el JSON exacto que se
 * guardará (con el secreto como «••••») y cuándo se verificó. Nada se escribe ni se conecta hasta «Añadir y conectar».
 */
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import type { McpEntry } from '@shared/ipc-extras'
import { getLang } from '@shared/i18n'
import { catalogText, mcpPermissionKey, type McpCatalogItem } from '@shared/mcp-catalog'
import { Button } from '../../../components/Button'
import { api } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { ErrorText, Field, TextInput, Toggle } from './ui'

const MASK = '••••'

/** Primer nombre libre a partir del sugerido (`github`, `github-2`, …). */
export function suggestName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; n < 1000; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
  return base
}

/** Entrada que quedará en `opencode.json`, con los secretos enmascarados (solo para mostrar). */
export function previewEntry(item: McpCatalogItem, enable: boolean): McpEntry {
  const headers = Object.fromEntries(item.inputs.map((i) => [i.target.header, i.target.template.replace('{value}', MASK)]))
  return {
    type: 'remote',
    url: item.url,
    enabled: enable,
    ...(item.inputs.length ? { headers } : {}),
    ...(item.auth !== 'oauth' ? { oauth: false as const } : {})
  }
}

/** JSON exacto que se escribirá en el archivo de la app (secreto enmascarado). */
export function previewJson(item: McpCatalogItem, name: string, enable: boolean, askEachUse: boolean): string {
  const doc: Record<string, unknown> = { mcp: { [name]: previewEntry(item, enable) } }
  if (askEachUse) doc.permission = { [mcpPermissionKey(name)]: 'ask' }
  return JSON.stringify(doc, null, 2)
}

export function verifiedText(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(d)
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export function McpCatalogDialog({
  item,
  existingNames,
  onCancel,
  onInstall
}: {
  item: McpCatalogItem
  existingNames: string[]
  onCancel: () => void
  onInstall: (req: { name: string; inputs: Record<string, string>; enable: boolean; askEachUse: boolean }) => Promise<void>
}): React.JSX.Element {
  const t = useT()
  const ct = catalogText(item)
  const [name, setName] = useState(() => suggestName(item.name, existingNames))
  const [values, setValues] = useState<Record<string, string>>({})
  const [askEachUse, setAskEachUse] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const host = new URL(item.url).host

  useEffect(() => {
    cancelRef.current?.focus() // el foco inicial es «Cancelar»: Enter no añade nada por accidente
  }, [])

  const nameError = !NAME_RE.test(name)
    ? t('mcp.dlg.nameFormat')
    : existingNames.includes(name)
      ? t('mcp.dlg.nameTaken', { name, suggestion: suggestName(name, existingNames) })
      : null
  const inputErrors = Object.fromEntries(
    item.inputs.map((i) => {
      const v = values[i.id] ?? ''
      if (!v) return [i.id, null] // aún sin escribir: el botón queda desactivado, sin regañar
      if (/[\r\n]/.test(v)) return [i.id, t('mcp.dlg.noNewlines')]
      if (v.length > i.maxLength || !new RegExp(i.pattern).test(v)) return [i.id, t('mcp.dlg.badFormat', { label: ct.inputs[i.id].label })]
      return [i.id, null]
    })
  )
  const missing = item.inputs.some((i) => !values[i.id])
  const canSubmit = !busy && !nameError && !missing && Object.values(inputErrors).every((e) => !e)

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onInstall({ name, inputs: values, enable: true, askEachUse })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // Ajustes también cierra con Esc: aquí solo debe cerrarse el diálogo
        if (!busy) onCancel()
        return
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current
        if (!root) return
        const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled'))
        if (!focusable.length) return
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
  }, [busy, onCancel])

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-4 animate-fade-in"
      onMouseDown={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-catalog-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-elevated shadow-2xl"
      >
        <div className="overflow-y-auto p-5">
          <h3 id="mcp-catalog-title" className="text-base font-semibold">
            {t('mcp.dlg.title', { title: ct.title })}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {item.publisher} · {ct.description}
          </p>

          <section className="mt-4">
            <h4 className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('mcp.dlg.canDo')}</h4>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">
              {ct.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            {item.writes && <p className="mt-1.5 text-xs text-warning">{t('mcp.dlg.writes')}</p>}
          </section>

          <section className="mt-4">
            <h4 className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('mcp.dlg.connectsTo')}</h4>
            <p className="mt-1.5 text-sm">
              <strong>{host}</strong>
            </p>
            <p className="mt-0.5 font-mono text-xs break-all text-muted">{item.url}</p>
            <p className="mt-1.5 text-xs text-muted">{t('mcp.dlg.remoteNote')}</p>
          </section>

          <section className="mt-4">
            <h4 className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('mcp.dlg.dataOut')}</h4>
            <p className="mt-1.5 text-sm">{ct.dataLeaves}</p>
          </section>

          <section className="mt-4 space-y-3">
            <Field label={t('mcp.dlg.serverName')} hint={t('mcp.dlg.serverNameHint')}>
              <TextInput value={name} onChange={(e) => setName(e.target.value.trim())} spellCheck={false} aria-invalid={!!nameError} />
            </Field>
            {nameError && <p className="-mt-1 text-xs text-danger">{nameError}</p>}
            {item.inputs.map((input) => (
              <div key={input.id}>
                <Field label={ct.inputs[input.id].label} hint={ct.inputs[input.id].help}>
                  <TextInput
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    maxLength={input.maxLength}
                    value={values[input.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
                    aria-invalid={!!inputErrors[input.id]}
                  />
                </Field>
                {inputErrors[input.id] && <p className="mt-1 text-xs text-danger">{inputErrors[input.id]}</p>}
              </div>
            ))}
            {item.auth === 'oauth' && <p className="text-xs text-muted">{t('mcp.dlg.afterAdd', { publisher: item.publisher })}</p>}
          </section>

          <section className="mt-4 space-y-2.5 rounded-lg border border-border bg-bg px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm">
              <Toggle checked={askEachUse} label={t('mcp.dlg.askEach')} onChange={setAskEachUse} disabled={busy} />
              <span className="font-medium">{t('mcp.dlg.askEach')}</span>
            </label>
            <div>
              <div className="flex items-center gap-2 text-sm">
                <Toggle checked={false} disabled label={t('mcp.dlg.tasks')} onChange={() => undefined} />
                <span className="text-muted">{t('mcp.dlg.tasks')}</span>
              </div>
              <p className="mt-1 pl-11 text-[11px] text-subtle">{t('mcp.dlg.tasksOff')}</p>
            </div>
          </section>

          <section className="mt-4">
            <h4 className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('mcp.dlg.saveExactly')}</h4>
            <pre
              aria-label={t('mcp.dlg.configAria')}
              className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2.5 font-mono text-[11px] leading-relaxed"
            >
              {previewJson(item, name || item.name, true, askEachUse)}
            </pre>
            {item.auth === 'token' && <p className="mt-1 text-[11px] text-subtle">{t('mcp.dlg.tokenPlain')}</p>}
          </section>

          <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <ShieldCheck size={13} className="shrink-0 text-success" />
            <span>{t('mcp.dlg.verified', { date: verifiedText(item.verifiedAt) })}</span>
            <button
              type="button"
              onClick={() => void api.invoke('app:openExternal', { url: item.docsUrl })}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              {t('mcp.dlg.docs')} <ExternalLink size={11} />
            </button>
          </p>

          {error && (
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
          >
            {t('mcp.dlg.cancel')}
          </button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {busy && <Loader2 size={14} className="animate-spin" />} {t('mcp.dlg.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
