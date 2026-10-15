/**
 * Tarjetas de archivo del modo Code: un documento (Excel, Word, PowerPoint, PDF, HTML) que el asistente dejó en disco.
 * Mismo diseño que `DocumentCard` del Chat (reutiliza su miniatura), con «Abrir» (app predeterminada) y «Mostrar en la
 * carpeta». Solo escritorio. Main confirma que cada archivo existe, está en el proyecto y es un documento (`files:docInfo`);
 * se piden únicamente cuando el turno terminó, nunca mientras el asistente escribe. En modo Resumen también se ven.
 */
import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileText, FolderOpen, Presentation, SquareArrowOutUpRight } from 'lucide-react'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { getLang } from '@shared/i18n'
import type { CodeApi, DocFileInfo } from '@shared/ipc-code'
import { useT } from '../../../lib/i18n'
import { formatFileSize } from '../../../lib/chatDocSize'
import { DocThumb, type DocCardType } from '../../../components/artifacts/DocumentCard'
import { isRemoteSurface } from '../../../lib/platform'
import { nativeCode } from './client'
import { detectDocFiles } from './doc-files'

/** Tipo de tarjeta según la extensión (las páginas HTML usan la miniatura de presentación). */
export function fileCardType(name: string): DocCardType {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx'
  if (ext === 'docx') return 'docx'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'pdf') return 'pdf'
  return 'slides'
}

const KIND_KEY = {
  xlsx: 'chat.doc.kindXlsx',
  docx: 'chat.doc.kindDocx',
  pptx: 'chat.doc.kindPptx',
  slides: 'code.file.kindHtml',
  pdf: 'chat.doc.kindPdf'
} as const

const ICON = { xlsx: FileSpreadsheet, docx: FileText, pptx: Presentation, slides: Presentation, pdf: FileText } as const
const TONE: Record<DocCardType, string> = {
  xlsx: 'var(--success)',
  docx: '#2f7fd6',
  pptx: 'var(--warning)',
  slides: 'var(--accent)',
  pdf: 'var(--accent)'
}

/**
 * Acciones de la tarjeta. «Abrir» = el programa de siempre del sistema (Word, Excel, PowerPoint, visor de PDF) vía
 * `files:openDoc` (`shell.openPath` en main). No hay «Ver aquí»: el visor integrado (`ChatDocPanel`) es del Chat y solo
 * recibe el contenido de documentos del chat, no archivos del disco; no existe un canal para leerlos, así que no se ofrece.
 */
export function fileCardActions(
  api: Pick<CodeApi['files'], 'openDoc' | 'revealDoc'> | undefined,
  cwd: string,
  path: string
): { open: () => Promise<void>; reveal: () => Promise<void> } {
  return {
    open: async () => void (await api?.openDoc(cwd, path)),
    reveal: async () => void (await api?.revealDoc(cwd, path))
  }
}

function FileCard({ cwd, file }: { cwd: string; file: DocFileInfo }): React.JSX.Element {
  const t = useT()
  const type = fileCardType(file.name)
  const Icon = ICON[type]
  const [error, setError] = useState(false)
  const kind = t(KIND_KEY[type])
  const meta = [kind, formatFileSize(file.bytes, getLang())].filter(Boolean).join(' · ')
  const actions = fileCardActions(nativeCode('dialogs')?.files, cwd, file.path)
  const btn =
    'no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-meta font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'
  return (
    <div
      role="group"
      aria-label={file.name}
      data-file-card={type}
      className="my-1 flex w-full max-w-[34rem] items-center gap-3 rounded-card border border-border bg-elevated p-2.5"
    >
      <DocThumb type={type} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0" style={{ color: TONE[type] }}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold text-fg" title={file.path}>
            {file.name}
          </span>
        </div>
        <div className="truncate text-meta text-muted">{meta}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setError(false)
              void actions.open().catch(() => setError(true))
            }}
            className={`${btn} ${error ? 'border border-danger/40 text-danger' : 'bg-accent-soft text-accent hover:bg-hover'}`}
          >
            <SquareArrowOutUpRight size={14} aria-hidden="true" />
            {error ? t('code.file.openFailed') : t('code.file.open')}
          </button>
          <button
            type="button"
            onClick={() => void actions.reveal().catch(() => undefined)}
            className={`${btn} border border-border text-fg hover:bg-hover`}
          >
            <FolderOpen size={14} aria-hidden="true" />
            {t('code.file.reveal')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Tarjetas de los documentos que dejó un turno terminado. No pinta nada en el celular, mientras escribe o sin documentos. */
export function GeneratedFiles({ parts, root, done }: { parts: readonly Part[]; root: string | null; done: boolean }): React.JSX.Element | null {
  const [files, setFiles] = useState<DocFileInfo[]>([])
  // Solo cuenta lo que cambia las rutas, no cada actualización del stream.
  const key = done && root ? detectDocFiles({ parts, root }).join('\n') : ''
  useEffect(() => {
    const api = isRemoteSurface() ? null : nativeCode('dialogs')
    if (!key || !root || !api) {
      setFiles([])
      return
    }
    let alive = true
    api.files
      .docInfo(root, key.split('\n'))
      .then((r) => alive && setFiles(r))
      .catch(() => alive && setFiles([]))
    return () => {
      alive = false
    }
  }, [key, root])
  if (!root || files.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {files.map((f) => (
        <FileCard key={f.path} cwd={root} file={f} />
      ))}
    </div>
  )
}
