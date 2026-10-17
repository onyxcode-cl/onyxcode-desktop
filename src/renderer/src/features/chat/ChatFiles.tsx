/**
 * Tarjetas de los archivos que la IA creó o mencionó en una respuesta del Chat (documentos, hojas, presentaciones, PDF, imágenes,
 * páginas, texto, código…). «Ver aquí» los muestra en el panel lateral (solo tipos que se pueden mostrar sin riesgo), «Abrir con tu
 * programa» usa el programa predeterminado del sistema y «Mostrar en la carpeta» los señala en el Finder o el Explorador.
 * Ejecutables y scripts solo ofrecen «Mostrar en la carpeta». Solo escritorio; main confirma que cada ruta existe y está en una
 * carpeta permitida (`extras:chatFile:info`) y la revalida en cada acción; se piden únicamente cuando el turno terminó.
 */
import { memo, useEffect, useState } from 'react'
import { Code2, File, FileImage, FileSpreadsheet, FileText, FolderOpen, Globe, ShieldAlert, SquareArrowOutUpRight, Eye } from 'lucide-react'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ChatFileInfo, ChatFileKind } from '@shared/ipc-extras'
import { getLang } from '@shared/i18n'
import { formatFileSize } from '../../lib/chatDocSize'
import { getExtras } from '../../lib/extrasApi'
import { useT } from '../../lib/i18n'
import { detectChatFiles } from '../../lib/chatFileDetect'
import { viewChatFile } from '../../lib/chatFileView'
import { isRemoteSurface } from '../../lib/platform'
import { useServer } from '../../stores/server'

const ICON: Record<ChatFileKind, typeof File> = {
  image: FileImage,
  pdf: FileText,
  office: FileSpreadsheet,
  html: Globe,
  markdown: FileText,
  text: FileText,
  code: Code2,
  other: File,
  blocked: ShieldAlert
}

export const KIND_KEY = {
  image: 'chat.file.kind.image',
  pdf: 'chat.file.kind.pdf',
  office: 'chat.file.kind.office',
  html: 'chat.file.kind.html',
  markdown: 'chat.file.kind.markdown',
  text: 'chat.file.kind.text',
  code: 'chat.file.kind.code',
  other: 'chat.file.kind.other',
  blocked: 'chat.file.kind.blocked'
} as const satisfies Record<ChatFileKind, string>

/** Etiqueta del tipo: los PDF se llaman PDF aunque main los clasifique como documento. */
export function kindLabelKey(info: ChatFileInfo): (typeof KIND_KEY)[ChatFileKind] {
  return /\.pdf$/i.test(info.name) ? KIND_KEY.pdf : KIND_KEY[info.kind]
}

/** Acciones de un archivo (en main se revalida la ruta cada vez). */
export function chatFileActions(info: ChatFileInfo): { open: () => Promise<void>; reveal: () => Promise<void> } {
  return {
    open: async () => void (await getExtras()?.invoke('extras:chatFile:open', { path: info.path })),
    reveal: async () => void (await getExtras()?.invoke('extras:chatFile:reveal', { path: info.path }))
  }
}

const BTN =
  'no-drag inline-flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-meta font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring'

/** Botones «Abrir con tu programa» y «Mostrar en la carpeta» (también los usa la cabecera del panel). */
export function ChatFileButtons({ info, compact = false }: { info: ChatFileInfo; compact?: boolean }): React.JSX.Element {
  const t = useT()
  const [error, setError] = useState(false)
  const actions = chatFileActions(info)
  const size = compact ? 'h-6 w-6 shrink-0 justify-center !px-0' : 'whitespace-nowrap'
  return (
    <>
      {info.canOpen && (
        <button
          type="button"
          onClick={() => {
            setError(false)
            void actions.open().catch(() => setError(true))
          }}
          title={error ? t('chat.file.openFailed') : t('chat.file.open')}
          aria-label={t('chat.file.open')}
          className={`${BTN} ${size} border ${error ? 'border-danger/40 text-danger' : 'border-border text-fg hover:bg-hover'}`}
        >
          <SquareArrowOutUpRight size={14} aria-hidden="true" />
          {!compact && (error ? t('chat.file.openFailed') : t('chat.file.open'))}
        </button>
      )}
      <button
        type="button"
        onClick={() => void actions.reveal().catch(() => undefined)}
        title={t('chat.file.reveal')}
        aria-label={t('chat.file.reveal')}
        className={`${BTN} ${size} border border-border text-fg hover:bg-hover`}
      >
        <FolderOpen size={14} aria-hidden="true" />
        {!compact && t('chat.file.reveal')}
      </button>
    </>
  )
}

function FileCard({ file }: { file: ChatFileInfo }): React.JSX.Element {
  const t = useT()
  const Icon = ICON[file.kind]
  const meta = [t(kindLabelKey(file)), formatFileSize(file.bytes, getLang())].filter(Boolean).join(' · ')
  return (
    <div
      role="group"
      aria-label={file.name}
      data-chat-file={file.kind}
      className="my-1 flex w-full max-w-[34rem] items-start gap-3 rounded-card border border-border bg-elevated p-2.5"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-code text-accent">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-fg" title={file.path}>
          {file.name}
        </span>
        <div className="truncate text-meta text-muted">{meta}</div>
        {file.kind === 'blocked' && <div className="text-meta text-muted">{t('chat.file.blocked')}</div>}
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {file.canView && (
            <button type="button" onClick={() => viewChatFile(file)} className={`${BTN} bg-accent-soft text-accent hover:bg-hover`}>
              <Eye size={14} aria-hidden="true" />
              {t('chat.file.view')}
            </button>
          )}
          <ChatFileButtons info={file} />
        </div>
      </div>
    </div>
  )
}

/** Tarjetas de los archivos de una respuesta terminada. No pinta nada en el celular, mientras escribe o sin archivos. */
export const ChatFiles = memo(function ChatFiles({ parts, done }: { parts: readonly Part[]; done: boolean }): React.JSX.Element | null {
  const t = useT()
  const root = useServer((s) => s.connection?.chatDirectory ?? null)
  const [files, setFiles] = useState<ChatFileInfo[]>([])
  // Solo cuenta lo que cambia las rutas, no cada actualización del stream.
  const key = done ? detectChatFiles({ parts, root }).join('\n') : ''
  useEffect(() => {
    const extras = isRemoteSurface() ? null : getExtras()
    if (!key || !extras) {
      setFiles([])
      return
    }
    let alive = true
    extras
      .invoke('extras:chatFile:info', { paths: key.split('\n') })
      .then((r) => alive && setFiles(r))
      .catch(() => alive && setFiles([]))
    return () => {
      alive = false
    }
  }, [key])
  if (files.length === 0) return null
  return (
    <div role="group" aria-label={t('chat.file.group')} className="flex flex-col gap-1">
      {files.map((f) => (
        <FileCard key={f.path} file={f} />
      ))}
    </div>
  )
})
