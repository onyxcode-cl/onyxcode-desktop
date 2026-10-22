import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fitTextarea, isSubmitKey, useAutosizeTextarea } from '../../lib/textarea'
import { ArrowUp, FileText, Languages, Paperclip, Presentation, Sheet, Square, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDraft } from '../../stores/drafts'
import { isRemoteSurface, platformCaps } from '../../lib/platform'
import { openTranslatePdf } from '../translate-pdf/TranslatePdfDialog'
import { chatModelInfo } from '../translate-pdf/model-info'
import { detectTranslateIntent } from '@shared/translate-intent'
import type { TranslateIntent } from '@shared/translate-intent'
import { DOCX_MIME, type TranslateLangCode } from '@shared/translate-pdf'
import { m } from '../../app/mobile/m'
import { mobileComposerMax } from '../../app/mobile/viewport'
import {
  attachmentBytes,
  classifyFile,
  officeCardLabel,
  toChatAttachment,
  validateFiles,
  type ChatAttachment,
  type OfficeAttachmentInfo
} from '../../lib/attachments'
import { handlePaste } from '../../lib/paste-attachments'
import { VoiceDictationButton } from '../../components/VoiceDictationButton'
import { markFirstStepDone } from '../../stores/first-steps'

const NO_ATTACHMENTS: ChatAttachment[] = []

function OfficeIcon({ family }: { family: OfficeAttachmentInfo['family'] }): ReactNode {
  const Icon = family === 'spreadsheet' ? Sheet : family === 'presentation' ? Presentation : FileText
  return <Icon size={18} className="shrink-0 text-accent" aria-hidden="true" />
}

interface Props {
  /** Devolver `false` (o rechazar) indica que no se envió: el borrador se restaura. */
  onSend: (text: string, files: ChatAttachment[]) => void | boolean | Promise<void | boolean>
  onAbort?: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  /** Controles extra a la izquierda del pie (p.ej. ModelPicker). */
  footer?: ReactNode
  autoFocusKey?: string | null
  /**
   * Botón de adjuntar (imágenes, PDF y texto como partes `file` con URL `data:`). Sin `showAttach` no se muestra.
   * Si se pasa `onAttach` se llama en vez de abrir el selector de archivos.
   */
  showAttach?: boolean
  onAttach?: () => void
  /** Inserta texto (y, si se indica, adjuntos) en el borrador (chips de sugerencias, restauración tras un fallo). Cambiar `key` para re-aplicar. */
  insert?: { text: string; key: number; attachments?: ChatAttachment[] } | null
  /** Texto de ayuda bajo el compositor; `false` lo oculta. */
  hint?: ReactNode | false
  /** Compositor flotante del inicio. Escritorio: radio 20, alto mínimo 128. Celular: radio 20 y sombra md, con el modelo en la misma fila; anclado, radio 16. */
  hero?: boolean
}

const MAX_HEIGHT = 280

/** Celular: tope de alto del compositor según la zona visible (se recalcula al abrirse el teclado). */
function useMobileMax(mobile: boolean): number {
  const read = (): number => mobileComposerMax(window.visualViewport?.height ?? window.innerHeight)
  const [max, setMax] = useState(() => (mobile && typeof window !== 'undefined' ? read() : MAX_HEIGHT))
  useEffect(() => {
    if (!mobile) return
    const vv = window.visualViewport
    const update = (): void => setMax(read())
    update()
    vv?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
    }
  }, [mobile])
  return mobile ? max : MAX_HEIGHT
}

export function ChatComposer({
  onSend,
  onAbort,
  busy,
  disabled,
  placeholder,
  footer,
  autoFocusKey,
  showAttach,
  onAttach,
  insert,
  hint,
  hero
}: Props): React.JSX.Element {
  const t = useT()
  const mobile = isRemoteSurface()
  const [focused, setFocused] = useState(false)
  const max = useMobileMax(mobile)
  // F8-B32: el borrador vive por conversación en un almacén externo; sobrevive a cambiar de modo.
  const [text, setText] = useDraft(`chat:${autoFocusKey ?? 'new'}`, '')
  const [attachments, setAttachments] = useDraft(`chat-att:${autoFocusKey ?? 'new'}`, NO_ATTACHMENTS)
  const [attachError, setAttachError] = useState<string | null>(null)
  /** Tarjeta «¿traducir este PDF sin cambiar el diseño?»: aparece al enviar un PDF con una petición de traducir. */
  const [offer, setOffer] = useState<{ intent: TranslateIntent; model: string | null } | null>(null)
  /** Nombres de documentos de oficina que main está convirtiendo a texto. */
  const [reading, setReading] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Celular: abrir una conversación no debe levantar el teclado (el foco lo decide el toque del usuario).
    if (!mobile) ref.current?.focus()
  }, [autoFocusKey, mobile])

  useEffect(() => {
    if (!insert) return
    setText(insert.text)
    if (insert.attachments) setAttachments(insert.attachments)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(insert.text.length, insert.text.length)
    })
    // `setText` cambia con la conversación: no debe re-aplicar la sugerencia al cambiar de chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insert])

  // Autoajuste de alto: al cambiar el texto y cuando cambia el ancho disponible.
  useAutosizeTextarea(ref, text, { max, manageOverflow: true })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      fitTextarea(el, max, true)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [max])

  // Celular: tocar enviar/detener no debe quitar el foco (si no, el teclado se cierra y el pie reaparece moviendo el botón).
  const keepFocus = mobile ? (e: React.MouseEvent): void => e.preventDefault() : undefined

  // Si la persona cambia el mensaje o los adjuntos, la oferta de traducir ya no corresponde.
  useEffect(() => setOffer(null), [text, attachments])
  const canSend = !disabled && !busy && (text.trim().length > 0 || attachments.length > 0)

  /** Inserta el texto dictado en la posición del cursor (o al final si no hay foco en el textarea). */
  const insertDictated = (dictated: string): void => {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const before = text.slice(0, start)
    const needsSpace = before.length > 0 && !/\s$/.test(before)
    const insert = `${needsSpace ? ' ' : ''}${dictated}`
    const next = `${before}${insert}${text.slice(end)}`
    setText(next)
    const caret = before.length + insert.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  const addFiles = (list: FileList | File[]): void => {
    const files = Array.from(list)
    if (files.length === 0 || disabled) return
    const { accepted, errors } = validateFiles(files, {
      count: attachments.length,
      bytes: attachments.reduce((n, a) => n + attachmentBytes(a), 0)
    })
    setAttachError(errors.length ? errors.join(' ') : null)
    if (accepted.length === 0) return
    const reads = accepted.filter((i) => classifyFile(files[i])?.kind === 'office').map((i) => files[i].name)
    if (reads.length > 0) setReading((cur) => [...cur, ...reads])
    // Cada archivo cuenta por separado: si uno no se puede leer (p. ej. un Word con contraseña) los demás se adjuntan igual.
    void Promise.allSettled(accepted.map((i) => toChatAttachment(files[i]))).then((results) => {
      const added: ChatAttachment[] = []
      const failed: string[] = []
      for (const r of results) {
        if (r.status === 'fulfilled') added.push(r.value)
        else failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
      }
      if (reads.length > 0) setReading((cur) => cur.filter((n) => !reads.includes(n)))
      if (added.length > 0) {
        setAttachments((cur) => [...cur, ...added])
        markFirstStepDone('attach') // «Primeros pasos › Prueba adjuntar un archivo»
      }
      if (failed.length > 0) setAttachError([...errors, ...failed].join(' '))
    })
  }

  const submit = (skipOffer = false): void => {
    if (!canSend) return
    const value = text.trim()
    const files = attachments
    if (!skipOffer && !mobile && platformCaps().translatePdf) {
      const intent = detectTranslateIntent(
        value,
        files.map((f) => ({ mime: f.originalDocx ? DOCX_MIME : f.mime })),
        document.documentElement.lang === 'en' ? 'en' : 'es'
      )
      if (intent) {
        setOffer({ intent, model: chatModelInfo()?.label ?? null })
        return
      }
    }
    setOffer(null)
    setText('')
    setAttachments([])
    setAttachError(null)
    const restore = (): void => {
      setText((cur) => (cur.trim() ? cur : value))
      setAttachments((cur) => (cur.length ? cur : files))
    }
    // H3: el borrador se vacía al instante pero vuelve si el envío falla.
    void Promise.resolve()
      .then(() => onSend(value, files))
      .then((ok) => {
        if (ok === false) restore()
      }, restore)
  }

  /** «Traducir así»: la ventana arranca sola con el PDF y el idioma de la tarjeta; el mensaje no se envía. */
  const acceptOffer = (): void => {
    if (!offer) return
    const file = attachments[offer.intent.fileIndex]
    if (!file) return
    const base64 = file.originalDocx ?? file.url.slice(file.url.indexOf(',') + 1)
    openTranslatePdf({ name: file.name, base64, kind: offer.intent.kind, target: offer.intent.target })
    setOffer(null)
    setText('')
    setAttachments([])
  }

  return (
    <div
      className={
        mobile
          ? 'relative mx-auto w-full max-w-3xl px-3 pb-2'
          : 'mx-auto w-full max-w-3xl px-6 pb-4 desk:max-w-[calc(var(--measure-prose)+48px)]'
      }
    >
      <div
        className={
          mobile
            ? hero
              ? 'rounded-[20px] border border-border bg-elevated shadow-md transition-[border-color] duration-200 focus-within:border-border-strong'
              : 'min-h-[52px] rounded-2xl border border-border bg-elevated shadow-sm transition-[border-color] duration-200 focus-within:border-border-strong'
            : `rounded-[20px] border bg-elevated shadow-md transition-[border-color,box-shadow] duration-200 desk:border-transparent desk:shadow-[var(--elev-edge),var(--shadow-md)] ${hero ? '' : 'shadow-md desk:rounded-2xl'} ${disabled ? 'border-border' : 'border-border focus-within:border-accent/40 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent),var(--shadow-md)]'}`
        }
        onDragOver={(e) => {
          if (!showAttach || disabled || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          setDragging(false)
          if (!showAttach || disabled || e.dataTransfer.files.length === 0) return
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
        onMouseDown={(e) => {
          // Clic en el "marco" enfoca el textarea.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            ref.current?.focus()
          }
        }}
      >
        {offer && attachments[offer.intent.fileIndex] && (
          <div
            role="group"
            aria-label={t('translate.pdf.title')}
            data-testid="translate-offer"
            className="mx-2 mt-2 rounded-ctl border border-border bg-hover/60 p-3"
          >
            <p className="flex items-start gap-2 text-ui font-medium">
              <Languages size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {t('translate.pdf.offer.title', {
                  name: attachments[offer.intent.fileIndex].name,
                  lang: t(`translate.pdf.langName.${offer.intent.target as TranslateLangCode}`)
                })}
              </span>
            </p>
            {offer.model && (
              <p className="mt-1 pl-[23px] text-[12px] text-muted">{t('translate.pdf.offer.note', { model: offer.model })}</p>
            )}
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => submit(true)}
                className="no-drag rounded-ctl px-3 py-1.5 text-ui text-muted hover:bg-hover"
                data-testid="translate-offer-no"
              >
                {t('translate.pdf.offer.no')}
              </button>
              <button
                type="button"
                autoFocus
                onClick={acceptOffer}
                className="no-drag rounded-ctl bg-accent px-3.5 py-1.5 text-ui font-medium text-accent-fg"
                data-testid="translate-offer-yes"
              >
                {t('translate.pdf.offer.yes')}
              </button>
            </div>
          </div>
        )}
        {showAttach && attachments.length > 0 && (
          <ul className={`flex flex-wrap gap-1.5 px-4 ${mobile ? 'pt-5' : 'pt-3'}`} aria-label={t('chat.composer.attach')}>
            {attachments.map((a) => (
              <li
                key={a.id}
                data-testid={a.office ? 'chat-office-card' : undefined}
                className={`group/att relative flex shrink-0 items-center justify-center rounded-lg border border-border bg-bg ${a.office ? (mobile ? 'h-16 max-w-[17rem]' : 'h-14 max-w-[17rem] overflow-hidden') : mobile ? 'h-16 max-w-[9rem] min-w-16' : 'h-14 max-w-[9rem] min-w-14 overflow-hidden'}`}
              >
                {a.office ? (
                  <span className="flex min-w-0 items-center gap-2 pr-6 pl-2.5 text-left">
                    <OfficeIcon family={a.office.family} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px] font-medium text-fg desk:text-meta" title={a.name}>
                        {a.name}
                      </span>
                      <span className="truncate text-[10px] text-muted desk:text-meta" title={a.office.notes.join(' ') || undefined}>
                        {officeCardLabel(a.office)}
                      </span>
                    </span>
                  </span>
                ) : a.mime.startsWith('image/') ? (
                  <img src={a.url} alt={a.name} className={`h-full object-cover ${mobile ? 'w-16 rounded-lg' : 'w-14'}`} />
                ) : (
                  <span className="flex min-w-0 flex-col items-center gap-0.5 px-2 text-[10px] desk:text-meta text-muted">
                    <FileText size={16} className="text-accent" />
                    <span className="max-w-full truncate">{a.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  title={t('chat.attach.remove', { name: a.name })}
                  aria-label={t('chat.attach.remove', { name: a.name })}
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                  className={
                    mobile
                      ? 'absolute -top-3.5 -right-3.5 flex h-11 w-11 items-center justify-center'
                      : 'absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-fg/70 text-bg opacity-0 transition group-hover/att:opacity-100 focus-visible:opacity-100 desk:h-[18px] desk:w-[18px] desk:bg-fg/80'
                  }
                >
                  {mobile ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-bg shadow">
                      <X size={13} />
                    </span>
                  ) : (
                    <X size={10} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            data-testid="chat-file-input"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.yml,.yaml,.log,.docx,.docm,.xlsx,.xlsm,.xlsb,.xls,.pptx,.pptm,.odt,.ods,.odp,.rtf,.doc,.ppt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        )}
        <textarea
          ref={ref}
          data-kb-composer=""
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? t('chat.placeholder.message')}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            if (!showAttach || disabled) return
            // Vía estándar + respaldo de escritorio (Finder/Explorador/capturas que no llegan como File): ver lib/paste-attachments.
            handlePaste(e, {
              scope: 'any',
              addFiles,
              fallback: !mobile,
              onErrors: (msgs) => setAttachError(msgs.join(' '))
            })
          }}
          onKeyDown={(e) => {
            // M5: Esc detiene la respuesta en curso (como en Code y Tareas).
            if (e.key === 'Escape' && busy && onAbort && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onAbort()
              return
            }
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
          {...(mobile ? { style: { maxHeight: max } } : {})}
          className={`block w-full resize-none bg-transparent px-4 text-[15px] leading-relaxed outline-none placeholder:text-subtle disabled:opacity-60 desk:leading-6 desk:placeholder:text-muted ${mobile ? 'pt-3 pb-1' : `max-h-[280px] pt-3.5 pb-1.5 desk:max-h-72 ${hero ? 'min-h-0 desk:min-h-[66px] desk:px-5 desk:pt-[18px]' : ''}`}`}
        />
        <div
          className={mobile ? 'flex items-center gap-1 px-1.5 pb-1.5' : 'flex items-center gap-1.5 px-2 pb-2'}
          {...(mobile ? m('composer-row') : {})}
        >
          {showAttach && (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={onAttach ?? (() => fileInputRef.current?.click())}
              disabled={disabled}
              title={t('chat.composer.attach')}
              aria-label={t('chat.composer.attach')}
              className={`no-drag inline-flex shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg active:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent desk:rounded-lg ${mobile ? (hero ? 'h-9 w-9' : 'h-10 w-10') : 'h-8 w-8'}`}
            >
              <Paperclip size={mobile ? 20 : 16} />
            </button>
          )}
          {showAttach && !mobile && platformCaps().translatePdf && (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => openTranslatePdf()}
              disabled={disabled}
              title={t('translate.pdf.open')}
              aria-label={t('translate.pdf.open')}
              data-testid="translate-pdf-button"
              className="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg active:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Languages size={16} />
            </button>
          )}
          <VoiceDictationButton onText={insertDictated} />
          {mobile ? (
            hero && footer ? (
              <div {...m('composer-model')} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {footer}
              </div>
            ) : (
              <span className="flex-1" />
            )
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1">{footer}</div>
          )}
          {busy ? (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={onAbort}
              title={t('chat.composer.stop')}
              aria-label={t('chat.composer.stop')}
              className={`flex shrink-0 animate-pop-in items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85 active:scale-95 ${mobile ? 'h-10 w-10' : 'h-8 w-8'}`}
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => submit()}
              disabled={!canSend}
              title={t('chat.composer.sendTitle')}
              aria-label={t('chat.composer.send')}
              className={`flex ${mobile ? 'h-10 w-10' : 'h-8 w-8'} shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 active:scale-95 ${canSend ? 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover' : 'bg-hover text-subtle'}`}
            >
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          )}
        </div>
        {mobile && !hero && !focused && footer && (
          <div className="flex items-center gap-1 overflow-x-auto border-t border-border px-1.5 py-1">{footer}</div>
        )}
      </div>
      {reading.length > 0 && (
        <p role="status" className="mt-2 text-center text-[12px] text-muted">
          {t('chat.attach.office.reading', { name: reading[0] })}
        </p>
      )}
      {attachError && (
        <p role="alert" className="mt-2 text-center text-[12px] text-danger">
          {attachError}
        </p>
      )}
      {dragging && (
        <p className="mt-2 text-center text-[12px] text-accent" role="status">
          {t('chat.attach.drop')}
        </p>
      )}
      {hint !== false && (
        <p
          data-mobile="hide"
          className={`mt-2 text-center text-[11px] text-subtle desk:text-meta desk:transition-opacity desk:duration-150 ${focused ? '' : ' desk:opacity-0'}`}
        >
          {hint ?? (
            <>
              <kbd className="kbd">Enter</kbd>
              {` ${t('chat.composer.hintSend')} · `}
              <kbd className="kbd">⇧ Enter</kbd>
              {` ${t('chat.composer.hintNewline')}`}
            </>
          )}
        </p>
      )}
    </div>
  )
}
