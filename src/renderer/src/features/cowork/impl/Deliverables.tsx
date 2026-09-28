/** Entregables de la tarea: lista con iconos, vista previa (md / csv / imágenes / texto) y acciones. */
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Eye,
  ExternalLink,
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
  X,
  type LucideIcon
} from 'lucide-react'
import type { CoworkDeliverable, CoworkFilePreview } from '@shared/ipc-cowork'
import { Markdown } from '../../../components/Markdown'
import { errorMessage } from '../../../lib/opencode'
import { openPath, reveal } from './actions'
import { cw } from './bridge'
import { baseName, extOf, formatSize, relTime } from './util'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const MARKDOWN = new Set(['md', 'markdown'])
const TABLE = new Set(['csv', 'tsv'])
const TEXT = new Set(['txt', 'json', 'html', 'htm', 'xml', 'yaml', 'yml', 'log', 'py', 'js', 'ts', 'sh', 'css', 'svg', 'rtf'])

export function canPreview(path: string): boolean {
  const e = extOf(path)
  return IMAGE.has(e) || MARKDOWN.has(e) || TABLE.has(e) || TEXT.has(e)
}

export function fileIcon(path: string): { icon: LucideIcon; tone: string } {
  const e = extOf(path)
  if (IMAGE.has(e)) return { icon: FileImage, tone: 'text-violet-500' }
  if (TABLE.has(e) || ['xlsx', 'xls', 'numbers', 'ods'].includes(e)) return { icon: FileSpreadsheet, tone: 'text-emerald-600' }
  if (['pptx', 'ppt', 'key', 'odp'].includes(e)) return { icon: Presentation, tone: 'text-orange-500' }
  if (['docx', 'doc', 'pages', 'odt', 'rtf', 'pdf', 'md', 'markdown', 'txt'].includes(e)) {
    return { icon: FileText, tone: e === 'pdf' ? 'text-red-500' : 'text-sky-600' }
  }
  if (TEXT.has(e)) return { icon: FileCode, tone: 'text-muted' }
  return { icon: File, tone: 'text-muted' }
}

/** CSV/TSV simple con comillas. */
function parseDelimited(text: string, sep: string, maxRows = 200): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if ((cell || row.length) && rows.length < maxRows) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function CsvTable({ text, sep }: { text: string; sep: string }): React.JSX.Element {
  const rows = parseDelimited(text, sep)
  const [head, ...body] = rows
  if (!head) return <p className="text-sm text-muted">Archivo vacío.</p>
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-hover">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-border px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-transparent even:bg-hover/40">
              {head.map((_, j) => (
                <td key={j} className="border-b border-border px-2.5 py-1 align-top whitespace-nowrap">
                  {r[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function usePreview(path: string | null): { data: CoworkFilePreview | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: CoworkFilePreview | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: false
  })
  useEffect(() => {
    if (!path) return
    let alive = true
    setState({ data: null, error: null, loading: true })
    cw('cowork:previewFile', { path })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err: unknown) => alive && setState({ data: null, error: errorMessage(err), loading: false }))
    return () => {
      alive = false
    }
  }, [path])
  return state
}

function PreviewBody({ file }: { file: CoworkDeliverable }): React.JSX.Element {
  const { data, error, loading } = usePreview(file.path)
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" /> Cargando vista previa…
      </div>
    )
  }
  if (error) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-danger">
        <AlertCircle size={15} /> {error}
      </p>
    )
  }
  if (!data || data.kind === 'unsupported') {
    return <p className="p-6 text-sm text-muted">No hay vista previa para este tipo de archivo. Ábrelo con su aplicación.</p>
  }
  if (data.kind === 'image' && data.dataUrl) {
    return (
      <div className="flex justify-center p-4">
        <img src={data.dataUrl} alt={baseName(file.path)} className="max-h-[70vh] max-w-full rounded-lg border border-border" />
      </div>
    )
  }
  const text = data.content ?? ''
  const e = extOf(file.path)
  return (
    <div className="p-5">
      {MARKDOWN.has(e) ? (
        <Markdown text={text} />
      ) : TABLE.has(e) ? (
        <CsvTable text={text} sep={e === 'tsv' ? '\t' : text.split('\n', 1)[0].includes(';') && !text.split('\n', 1)[0].includes(',') ? ';' : ','} />
      ) : (
        <pre className="overflow-auto rounded-lg bg-code p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      )}
      {data.truncated && <p className="mt-3 text-xs text-subtle">Vista previa recortada ({formatSize(data.size)} en total).</p>}
    </div>
  )
}

/** Diálogo grande de vista previa. */
export function PreviewDialog({ file, onClose }: { file: CoworkDeliverable; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const { icon: Icon, tone } = fileIcon(file.path)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon size={16} className={tone} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{baseName(file.path)}</div>
            <div className="truncate font-mono text-[11px] text-subtle">{file.relPath}</div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
            onClick={() => void openPath(file.path)}
          >
            <ExternalLink size={13} /> Abrir
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
            onClick={() => void reveal(file.path)}
          >
            <FolderOpen size={13} /> Mostrar en Finder
          </button>
          <button type="button" title="Cerrar" className="rounded-lg p-1 text-muted hover:bg-hover hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <PreviewBody file={file} />
        </div>
      </div>
    </div>
  )
}

/** Miniatura en línea para imágenes. */
function ImageThumb({ file }: { file: CoworkDeliverable }): React.JSX.Element | null {
  const { data } = usePreview(file.size < 4 * 1024 * 1024 ? file.path : null)
  if (!data?.dataUrl) return null
  return <img src={data.dataUrl} alt="" className="mt-1.5 max-h-28 w-full rounded-md border border-border object-cover" />
}

/** Lista de entregables del panel derecho. */
export function DeliverableList({ files }: { files: CoworkDeliverable[] }): React.JSX.Element {
  const [preview, setPreview] = useState<CoworkDeliverable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (fn: () => Promise<void>): void => {
    setError(null)
    fn().catch((err: unknown) => setError(errorMessage(err)))
  }
  return (
    <>
      {error && (
        <p className="mb-2 flex items-center gap-1 text-xs text-danger">
          <AlertCircle size={12} /> {error}
        </p>
      )}
      <ul className="space-y-1.5">
        {files.map((f) => {
          const { icon: Icon, tone } = fileIcon(f.path)
          const previewable = canPreview(f.path)
          return (
            <li key={f.path} className="rounded-lg border border-border bg-elevated px-2.5 py-2">
              <div className="flex items-start gap-2">
                <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  title={f.relPath}
                  onClick={() => (previewable ? setPreview(f) : run(() => openPath(f.path)))}
                >
                  <span className="block truncate text-[13px] font-medium">{baseName(f.path)}</span>
                  <span className="block truncate text-[11px] text-subtle">
                    {f.relPath.includes('/') ? `${f.relPath.slice(0, f.relPath.lastIndexOf('/'))} · ` : ''}
                    {formatSize(f.size)} · {relTime(f.mtime)}
                  </span>
                </button>
              </div>
              {IMAGE.has(extOf(f.path)) && <ImageThumb file={f} />}
              <div className="mt-1.5 flex items-center gap-1 pl-6">
                {previewable && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
                    onClick={() => setPreview(f)}
                  >
                    <Eye size={12} /> Ver
                  </button>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
                  onClick={() => run(() => openPath(f.path))}
                >
                  <ExternalLink size={12} /> Abrir
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg"
                  onClick={() => run(() => reveal(f.path))}
                >
                  <FolderOpen size={12} /> Finder
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {preview && <PreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
