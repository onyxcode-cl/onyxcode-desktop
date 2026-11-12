import { useEffect, useRef, useState } from 'react'
import type { MessageEntry } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import { toChatAttachment, validateFiles } from '../../lib/attachments'
import { chatOfficeAvailable, officeOriginalFiles, rememberOfficeOriginal, sentOfficeAttachments } from './office-overdrive'

/** Acción del turno enviado: no inspecciona la respuesta ni exige intención/frase especial. */
export function SentOfficeAction({ source, busy }: { source: MessageEntry; busy: boolean }): React.JSX.Element | null {
  const t = useT()
  const parts = source.parts.filter(
    (p): p is Extract<typeof p, { type: 'file' }> => p.type === 'file' && /\.(docx|xlsx|pptx)$/i.test(p.filename ?? '')
  )
  const originals = sentOfficeAttachments(source)
  const files = originals.length === parts.length ? officeOriginalFiles(originals) : null
  const hasFiles = parts.length > 0
  const [ready, setReady] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    setReady(false)
    if (hasFiles)
      void chatOfficeAvailable().then((value) => {
        if (active) setReady(value)
      })
    return () => {
      active = false
    }
  }, [source.info.id, hasFiles, busy])
  if (!hasFiles || !ready) return null
  const prepare = async (selected?: File[]): Promise<void> => {
    if (lock.current || busy) return
    if (!selected && !files) {
      input.current?.click()
      return
    }
    lock.current = true
    setPreparing(true)
    setError(null)
    try {
      // Releer el original al pulsar: puede haberse liberado por el presupuesto de memoria del Chat.
      if (selected) {
        // Tras cerrar la app (o liberar memoria), el historial solo contiene texto. La persona vuelve a
        // elegir los originales; no se fabrican documentos desde ese texto ni se leen rutas del historial.
        const validation = validateFiles(selected, { count: 0, bytes: 0 })
        if (validation.errors.length) throw new Error(validation.errors.join(' '))
        const remaining = [...selected]
        const ordered = parts.map((p) => {
          const index = remaining.findIndex((f) => f.name === p.filename)
          return index < 0 ? undefined : remaining.splice(index, 1)[0]
        })
        if (remaining.length || ordered.some((f) => !f)) throw new Error(t('chat.overdrive.invalid'))
        const read = await Promise.all(ordered.map((f) => toChatAttachment(f!)))
        if (!officeOriginalFiles(read)) throw new Error(t('chat.overdrive.invalid'))
        read.forEach((f, i) => rememberOfficeOriginal(source.info.sessionID, parts[i].id, { ...f, id: parts[i].id }))
      }
      const available = sentOfficeAttachments(source)
      const current = available.length === parts.length ? officeOriginalFiles(available) : null
      if (!current) throw new Error(t('chat.overdrive.unavailable'))
      const text = source.parts
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text' && !p.synthetic && !p.ignored)
        .map((p) => p.text)
        .join('\n\n')
      const { prepareOfficeTask } = await import('../tasks/impl/chat-office')
      await prepareOfficeTask(text, current)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.overdrive.unavailable'))
    } finally {
      lock.current = false
      setPreparing(false)
    }
  }
  return (
    <div data-testid="sent-office-overdrive-offer" className="rounded-ctl border border-border bg-hover/60 p-3">
      <p className="text-ui text-muted">{t(files ? 'chat.overdrive.note' : 'chat.overdrive.reattach')}</p>
      <p className="mt-1 text-xs text-muted">{parts.map((p) => p.filename).join(', ')}</p>
      <input
        ref={input}
        type="file"
        multiple
        accept=".docx,.xlsx,.pptx"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="sent-office-original-input"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (selected.length) void prepare(selected)
        }}
      />
      <button
        type="button"
        data-testid="sent-office-overdrive-yes"
        disabled={busy || preparing}
        onClick={() => void prepare()}
        className="no-drag mt-2 rounded-ctl bg-accent px-3.5 py-1.5 text-ui font-medium text-accent-fg disabled:opacity-40"
      >
        {t(preparing ? 'chat.overdrive.preparing' : 'chat.overdrive.action')}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
