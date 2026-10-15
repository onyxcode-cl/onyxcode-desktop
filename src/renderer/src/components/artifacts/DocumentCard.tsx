/**
 * Tarjeta de documento del Chat de escritorio: en vez de un bloque de código con botones sueltos, cada documento
 * generado (Excel, Word, PowerPoint, presentación HTML, PDF) se muestra como una tarjeta con miniatura, nombre,
 * tipo y dos acciones: «Abrir» (el panel de documento que ya existe) y «Descargar» (la descarga que ya existe).
 * Solo se monta en escritorio (`Markdown.tsx` la omite en la PWA del celular, que sigue igual).
 */
import { useState } from 'react'
import { Code2, Download, Eye, FileSpreadsheet, FileText, Loader2, Presentation } from 'lucide-react'
import { isDocxSpec, isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'
import { useT } from '../../lib/i18n'
import { getExtras } from '../../lib/extrasApi'
import { previewInChatDocPanel, type ChatDocBlockKind } from '../../lib/chatDocPreview'
import { parseDataBlock } from '../../lib/chatDocBlocks'

/** Tipo de tarjeta: decide ícono, color y forma de la miniatura. */
export type DocCardType = 'xlsx' | 'docx' | 'pptx' | 'slides' | 'pdf'

export function docCardType(kind: ChatDocBlockKind, isSlides: boolean): DocCardType {
  if (kind === 'html') return isSlides ? 'slides' : 'pdf'
  return kind
}

/** Extensión del archivo que se descarga por tipo (las presentaciones HTML se descargan como PDF). */
const EXT: Record<DocCardType, string> = { xlsx: 'xlsx', docx: 'docx', pptx: 'pptx', slides: 'pdf', pdf: 'pdf' }

/** Color de cada tipo: Excel verde, Word azul, PowerPoint naranja, HTML con el acento. */
const TONE: Record<DocCardType, string> = {
  xlsx: 'var(--success)',
  docx: '#2f7fd6',
  pptx: 'var(--warning)',
  slides: 'var(--accent)',
  pdf: 'var(--accent)'
}

const KIND_KEY = {
  xlsx: 'chat.doc.kindXlsx',
  docx: 'chat.doc.kindDocx',
  pptx: 'chat.doc.kindPptx',
  slides: 'chat.doc.slides',
  pdf: 'chat.doc.kindPdf'
} as const

/** Nombre de archivo para mostrar: el título sin caracteres raros + extensión (sin duplicarla). */
export function docFileName(title: string, type: DocCardType): string {
  const ext = EXT[type]
  const base = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const clean = base.replace(new RegExp(`\\.${ext}$`, 'i'), '') || 'documento'
  return `${clean}.${ext}`
}

/** Dato corto de tamaño del documento (hojas, diapositivas), o `null` si no se puede saber. */
export function docCardCount(kind: ChatDocBlockKind, rawText: string): { key: 'sheets' | 'slides'; n: number } | null {
  if (kind !== 'xlsx' && kind !== 'pptx') return null
  const parsed = parseDataBlock(kind, rawText)
  if (kind === 'xlsx' && isXlsxSpec(parsed)) return { key: 'sheets', n: parsed.sheets.length }
  if (kind === 'pptx' && isPptxSpec(parsed)) return { key: 'slides', n: parsed.slides.length }
  return null
}

const ICON = { xlsx: FileSpreadsheet, docx: FileText, pptx: Presentation, slides: Presentation, pdf: FileText } as const

/** Miniatura estilizada por tipo (sin imágenes): líneas de contenido con la forma típica de cada documento. */
export function DocThumb({ type }: { type: DocCardType }): React.JSX.Element {
  const bar = 'rounded-full bg-fg/15'
  const head = { background: `color-mix(in srgb, ${TONE[type]} 55%, transparent)` }
  return (
    <div
      aria-hidden="true"
      data-doc-thumb={type}
      className="relative h-[72px] w-[104px] shrink-0 overflow-hidden rounded-lg border border-border bg-code p-2"
    >
      {type === 'xlsx' ? (
        <div className="grid h-full grid-cols-3 grid-rows-4 gap-[3px]">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={i < 3 ? 'rounded-[2px]' : 'rounded-[2px] bg-fg/10'} style={i < 3 ? head : undefined} />
          ))}
        </div>
      ) : type === 'pptx' || type === 'slides' ? (
        <div className="flex h-full flex-col justify-center gap-1.5">
          <span className="h-2 w-2/3 rounded-full" style={head} />
          <span className={`h-1 w-full ${bar}`} />
          <span className={`h-1 w-4/5 ${bar}`} />
          <span className={`h-1 w-1/2 ${bar}`} />
        </div>
      ) : (
        <div className="flex h-full flex-col gap-1.5">
          <span className="h-2 w-1/2 rounded-full" style={head} />
          <span className={`h-1 w-full ${bar}`} />
          <span className={`h-1 w-full ${bar}`} />
          <span className={`h-1 w-5/6 ${bar}`} />
          <span className={`h-1 w-2/3 ${bar}`} />
        </div>
      )}
    </div>
  )
}

interface Props {
  kind: ChatDocBlockKind
  rawText: string
  isSlides?: boolean
  title: string
  /** Muestra/oculta el código fuente del documento (el botón solo aparece si se pasa). */
  codeShown?: boolean
  onToggleCode?: () => void
}

export function DocumentCard({ kind, rawText, isSlides = false, title, codeShown, onToggleCode }: Props): React.JSX.Element {
  const t = useT()
  const type = docCardType(kind, isSlides)
  const Icon = ICON[type]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = docFileName(title, type)
  const count = docCardCount(kind, rawText)
  const meta = [t(KIND_KEY[type]), count ? t(count.key === 'sheets' ? 'chat.doc.card.sheets' : 'chat.doc.card.slides', { n: count.n }) : null]
    .filter(Boolean)
    .join(' · ')

  const open = (): void => {
    // Mismo panel de documento que ya se abre solo; sin panel registrado, el HTML cae en su ventana aislada de siempre.
    if (previewInChatDocPanel(kind, rawText, title, isSlides)) return
    if (kind === 'html') void getExtras()?.openArtifact({ title, html: rawText }).catch(() => undefined)
  }

  const download = async (): Promise<void> => {
    const extras = getExtras()
    if (!extras) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'html') await extras.downloadHtmlAsPdf({ title, html: rawText })
      else {
        const parsed = parseDataBlock(kind, rawText)
        if (kind === 'xlsx' && isXlsxSpec(parsed)) await extras.invoke('extras:downloadChatDoc', { kind: 'xlsx', title, data: parsed })
        else if (kind === 'docx' && isDocxSpec(parsed)) await extras.invoke('extras:downloadChatDoc', { kind: 'docx', title, data: parsed })
        else if (kind === 'pptx' && isPptxSpec(parsed)) await extras.invoke('extras:downloadChatDoc', { kind: 'pptx', title, data: parsed })
        else throw new Error(t('chat.doc.problem.invalid'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const btn =
    'no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-meta font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-50'
  return (
    <div
      role="group"
      aria-label={name}
      data-doc-card={type}
      className="my-2 flex w-full max-w-[34rem] items-center gap-3 rounded-card border border-border bg-elevated p-2.5"
    >
      <DocThumb type={type} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0" style={{ color: TONE[type] }}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold text-fg" title={name}>
            {name}
          </span>
        </div>
        <div className="truncate text-meta text-muted">{meta}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={open} className={`${btn} bg-accent-soft text-accent hover:bg-hover`}>
            <Eye size={14} aria-hidden="true" />
            {t('chat.doc.card.open')}
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy}
            aria-busy={busy}
            title={error ?? undefined}
            className={`${btn} border ${error ? 'border-danger/40 text-danger' : 'border-border text-fg hover:bg-hover'}`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
            {error ? t('chat.doc.card.downloadFailed') : t('chat.doc.card.download')}
          </button>
          {onToggleCode && (
            <button type="button" onClick={onToggleCode} aria-expanded={!!codeShown} className={`${btn} text-muted hover:bg-hover hover:text-fg`}>
              <Code2 size={14} aria-hidden="true" />
              {t('chat.doc.card.code')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
