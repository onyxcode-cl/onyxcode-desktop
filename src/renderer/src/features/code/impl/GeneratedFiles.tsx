/**
 * Tarjetas de archivo del modo Code: un documento (Excel, Word, PowerPoint, PDF, HTML) que el asistente dejó en disco.
 * Reutiliza la miniatura del Chat y su panel para «Ver»; «Abrir» usa el programa del sistema. Solo escritorio.
 * Main confirma existencia, ámbito y tipo (`files:docInfo`); las herramientas de documentos exitosas se muestran
 * al completarse, el resto al terminar el turno. El visor vuelve a validar por los canales existentes del Chat.
 */
import { useEffect, useRef, useState } from 'react'
import { Eye, FileSpreadsheet, FileText, FolderOpen, Presentation, SquareArrowOutUpRight } from 'lucide-react'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { getLang } from '@shared/i18n'
import type { CodeApi, DocFileInfo } from '@shared/ipc-code'
import { useT } from '../../../lib/i18n'
import { formatFileSize } from '../../../lib/chatDocSize'
import { DocThumb, type DocCardType } from '../../../components/artifacts/DocumentCard'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { getExtras } from '../../../lib/extrasApi'
import { viewChatFile } from '../../../lib/chatFileView'
import { nativeCode } from './client'
import { detectDocFiles, isDocumentTool } from './doc-files'

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

/** «Abrir» revalida el documento del proyecto en main antes de llamar a `shell.openPath`. */
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

/** «Ver» conserva la comprobación del proyecto y usa la información y el panel de archivos del Chat. */
async function viewFile(cwd: string, path: string, isCurrent: () => boolean): Promise<boolean> {
  const api = nativeCode('dialogs')
  const extras = getExtras()
  if (!api || !extras || !platformCaps().docViewer) return false
  const valid = await api.files.docInfo(cwd, [path])
  if (!isCurrent() || !valid.some((f) => f.path === path)) return false
  const infos = await extras.invoke('extras:chatFile:info', { paths: [path] })
  const info = infos.find((f) => f.path === path && f.canView)
  return info && isCurrent() ? viewChatFile(info, { kind: 'file', path: info.path, root: cwd }) : false
}

function FileCard({ cwd, file }: { cwd: string; file: DocFileInfo }): React.JSX.Element {
  const t = useT()
  const type = fileCardType(file.name)
  const Icon = ICON[type]
  const [error, setError] = useState(false)
  const [viewError, setViewError] = useState(false)
  const viewRequest = useRef(0)
  useEffect(
    () => () => {
      viewRequest.current++
    },
    [cwd, file.path]
  )
  const canView = platformCaps().docViewer && /\.(pdf|docx|xlsx|pptx|html|htm)$/i.test(file.name)
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
          {canView && (
            <button
              type="button"
              onClick={() => {
                setViewError(false)
                const request = ++viewRequest.current
                const isCurrent = (): boolean => viewRequest.current === request
                void viewFile(cwd, file.path, isCurrent)
                  .then((ok) => {
                    if (isCurrent()) setViewError(!ok)
                  })
                  .catch(() => {
                    if (isCurrent()) setViewError(true)
                  })
              }}
              className={`${btn} bg-accent-soft text-accent hover:bg-hover`}
            >
              <Eye size={14} aria-hidden="true" />
              {t('tasks.deliv.view')}
            </button>
          )}
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
        {viewError && (
          <p role="alert" className="text-meta text-danger">
            {t('chat.file.viewFailed')}
          </p>
        )}
      </div>
    </div>
  )
}

/** Las herramientas de documentos no esperan al fin del turno; los demás candidatos sí. Sin tarjetas en el celular. */
export function GeneratedFiles({
  parts,
  root,
  done
}: {
  parts: readonly Part[]
  root: string | null
  done: boolean
}): React.JSX.Element | null {
  const [result, setResult] = useState<{ key: string; root: string; files: DocFileInfo[] } | null>(null)
  // Solo cuenta lo que cambia las rutas, no cada actualización del stream.
  const candidates = done ? parts : parts.filter((p) => p.type === 'tool' && isDocumentTool(p.tool))
  const key = root ? detectDocFiles({ parts: candidates, root }).join('\n') : ''
  useEffect(() => {
    const api = isRemoteSurface() ? null : nativeCode('dialogs')
    if (!key || !root || !api) {
      setResult(null)
      return
    }
    let alive = true
    api.files
      .docInfo(root, key.split('\n'))
      .then((files) => alive && setResult({ key, root, files }))
      .catch(() => alive && setResult(null))
    return () => {
      alive = false
    }
  }, [key, root])
  const files = result?.key === key && result.root === root ? result.files : []
  if (!root || files.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {files.map((f) => (
        <FileCard key={f.path} cwd={root} file={f} />
      ))}
    </div>
  )
}
