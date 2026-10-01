/**
 * Conversación de una tarea de Tareas: los mensajes del asistente se aplanan y las llamadas a
 * herramientas consecutivas se agrupan en bloques compactos de "Pasos" (expandibles) en lugar
 * de una lista larga de tarjetas de herramientas.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, Part, PermissionRequest, ReasoningPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, Brain, ChevronRight, FileText, Loader2, Pencil, RotateCw, Sparkles } from 'lucide-react'
import { friendlyError } from '@shared/ai-errors'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { Markdown } from '../../../components/Markdown'
import { AssistantError } from '../../../components/conversation/AssistantError'
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import { isOldRow, withCv } from '../../../lib/conversation/cv'
import { lastAssistantFailed } from '../../../lib/conversation/errors'
import { errorMessage } from '../../../lib/opencode'
import type { ConvError } from '../../../lib/session-reducer'
import type { MessageEntry } from '../../../stores/sessions'
import { ActivityRow } from './ProgressPanel'
import { editAndRetry } from './actions'
import { PermissionCard } from './PermissionPrompt'
import { toolImages } from './computer-tools'
import { ScreenshotThumbs } from './ComputerAccess'
import { blockIdForPart } from './conversation-logic'
import { clearPendingScroll, onScrollToPart, peekPendingScroll } from './scroll'
import { friendlyTool, isVisibleText } from './util'

export const ATTACH_MARKER = '\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n'

type Block =
  | { kind: 'user'; id: string; text: string; files: string[]; partIds: string[] }
  | { kind: 'text'; id: string; text: string; partIds: string[] }
  | { kind: 'steps'; id: string; parts: Array<ToolPart | ReasoningPart>; partIds: string[] }
  | { kind: 'error'; id: string; info: AssistantMessage; partIds: string[] }
  | { kind: 'retry'; id: string; text: string; partIds: string[] }
  | { kind: 'file'; id: string; name: string; partIds: string[] }

/** Aplana los mensajes en bloques; `partIds` permite localizar el bloque de cualquier parte (búsqueda, contexto). */
function buildBlocks(entries: MessageEntry[]): Block[] {
  const blocks: Block[] = []
  let steps: Extract<Block, { kind: 'steps' }> | null = null
  for (const entry of entries) {
    if (entry.info.role === 'user') {
      steps = null
      const raw = entry.parts
        .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic)
        .map((p) => p.text)
        .join('\n')
      const idx = raw.indexOf(ATTACH_MARKER)
      const text = idx >= 0 ? raw.slice(0, idx) : raw
      const files =
        idx >= 0
          ? raw
              .slice(idx + ATTACH_MARKER.length)
              .split('\n')
              .map((l) => l.replace(/^-\s*/, '').trim())
              .filter(Boolean)
          : []
      for (const p of entry.parts) if (p.type === 'file') files.push(p.filename ?? p.url)
      blocks.push({ kind: 'user', id: entry.info.id, text, files, partIds: entry.parts.map((p) => p.id) })
      continue
    }
    for (const p of entry.parts) {
      if (p.type === 'tool' || (p.type === 'reasoning' && p.text.trim())) {
        if (!steps) {
          steps = { kind: 'steps', id: p.id, parts: [], partIds: [] }
          blocks.push(steps)
        }
        steps.parts.push(p as ToolPart | ReasoningPart)
        steps.partIds.push(p.id)
      } else if (isVisibleText(p)) {
        steps = null
        blocks.push({ kind: 'text', id: p.id, text: p.text, partIds: [p.id] })
      } else if (p.type === 'retry') {
        blocks.push({ kind: 'retry', id: p.id, text: `Reintento ${p.attempt}: ${friendlyError(p.error).message}`, partIds: [p.id] })
      } else if (p.type === 'file') {
        steps = null
        blocks.push({ kind: 'file', id: p.id, name: p.filename ?? p.url, partIds: [p.id] })
      }
    }
    if (entry.info.role === 'assistant' && entry.info.error) {
      steps = null
      blocks.push({ kind: 'error', id: `${entry.info.id}-err`, info: entry.info, partIds: [] })
    }
  }
  return blocks
}

const ReasoningRow = memo(function ReasoningRow({ part }: { part: ReasoningPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return (
    <li className="text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-muted hover:text-fg">
        <Brain size={12} className="shrink-0" />
        {seconds ? `Pensó durante ${seconds} s` : 'Pensando…'}
      </button>
      {open && <div className="mt-1 ml-5 border-l-2 border-border pl-2 whitespace-pre-wrap text-muted">{part.text}</div>}
    </li>
  )
})

const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean => a === b || (a.length === b.length && a.every((x, i) => x === b[i]))

// Memoizados (F7-B44). Los `Block` se reconstruyen en cada render del padre (objetos y arrays nuevos), pero sus
// partes/mensajes conservan la referencia del store: el comparador mira el contenido, no el bloque.
const StepsBlock = memo(
  function StepsBlock({
    id,
    parts,
    live,
    forceOpen,
    flash,
    old
  }: {
    id: string
    parts: Array<ToolPart | ReasoningPart>
    live: boolean
    forceOpen?: boolean
    flash?: boolean
    /** Bloque antiguo: `content-visibility: auto` (nunca el resaltado por búsqueda). */
    old?: boolean
  }): React.JSX.Element {
    const [open, setOpen] = useState(false)
    useEffect(() => {
      if (forceOpen) setOpen(true)
    }, [forceOpen])
    const tools = parts.filter((p): p is ToolPart => p.type === 'tool')
    const running = live ? [...tools].reverse().find((t) => t.state.status === 'running' || t.state.status === 'pending') : undefined
    const failed = tools.filter((t) => t.state.status === 'error').length
    const lastTool = running ?? tools[tools.length - 1]
    const current = lastTool ? friendlyTool(lastTool) : null
    const lastShot = useMemo(() => {
      for (let i = tools.length - 1; i >= 0; i--) {
        const imgs = toolImages(tools[i])
        if (imgs.length > 0) return imgs.slice(-1)
      }
      return []
    }, [tools])
    const count = tools.length
    return (
      <div
        id={`cw-block-${id}`}
        className={withCv(
          `rounded-xl border bg-elevated/60 transition-colors duration-500 ${flash ? 'border-accent ring-2 ring-accent/25' : 'border-border'}`,
          !!old && !flash
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-muted hover:text-fg"
        >
          <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          {live && running ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
          ) : (
            <Sparkles size={13} className="shrink-0 text-accent" />
          )}
          <span className="shrink-0 font-medium text-fg">{count === 0 ? 'Pensando' : count === 1 ? '1 paso' : `${count} pasos`}</span>
          {current && (
            <span className="min-w-0 truncate">
              · {current.verb} {current.detail}
              {live && running ? '…' : ''}
            </span>
          )}
          {failed > 0 && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-danger">
              <AlertCircle size={12} /> {failed}
            </span>
          )}
        </button>
        {!open && lastShot.length > 0 && (
          <div className="px-3 pb-2 pl-8">
            <ScreenshotThumbs images={lastShot} />
          </div>
        )}
        {open && (
          <ul className="space-y-1.5 border-t border-border px-3 py-2.5 pl-8">
            {parts.map((p) => (p.type === 'tool' ? <ActivityRow key={p.id} part={p} /> : <ReasoningRow key={p.id} part={p} />))}
          </ul>
        )}
      </div>
    )
  },
  (a, b) =>
    a.id === b.id &&
    a.live === b.live &&
    a.forceOpen === b.forceOpen &&
    a.flash === b.flash &&
    a.old === b.old &&
    sameList(a.parts, b.parts)
)

interface Props {
  entries: MessageEntry[]
  busy: boolean
  error?: ConvError | null
  permissions: PermissionRequest[]
  /** Contenido extra al final (p.ej. seguimientos). */
  footer?: React.ReactNode
  /** Tarea a la que pertenece la conversación: habilita «Editar y reintentar» en los mensajes del usuario. */
  taskId?: string
}

const HIGHLIGHT = 'outline-2 outline-offset-4 outline-accent/60'

/** Mensaje del usuario con «Editar y reintentar»: edita el texto y, tras confirmar, deshace desde aquí y reenvía. */
const UserMessage = memo(
  function UserMessage({
    block,
    taskId,
    flash,
    old
  }: {
    block: Extract<Block, { kind: 'user' }>
    taskId?: string
    flash: boolean
    /** Bloque antiguo: `content-visibility: auto`. */
    old?: boolean
  }): React.JSX.Element {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(block.text)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const taRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
      if (!editing) return
      const el = taRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }, [editing])

    const cancel = (): void => {
      setEditing(false)
      setError(null)
      setDraft(block.text)
    }

    const submit = async (): Promise<void> => {
      const text = draft.trim()
      if (!text || !taskId || busy) return
      const ok = await confirmDialog({
        title: 'Editar y reintentar',
        message: (
          <>
            Se deshará esta conversación desde este mensaje: se eliminarán los mensajes posteriores y se{' '}
            <strong>restaurarán los archivos de la carpeta</strong> tal como estaban antes de ese mensaje (si se guardó un punto de
            restauración). Lo creado después irá a la Papelera. Después se enviará tu mensaje editado.
          </>
        ),
        confirmLabel: 'Deshacer y reintentar',
        danger: true
      })
      if (!ok) return
      setBusy(true)
      setError(null)
      try {
        await editAndRetry(taskId, block.id, text)
        setEditing(false)
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    }

    if (editing) {
      return (
        <div id={`cw-block-${block.id}`} className="flex w-full flex-col items-end gap-1.5">
          <textarea
            ref={taRef}
            value={draft}
            disabled={busy}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            aria-label="Editar mensaje"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel()
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            }}
            className="w-full max-w-[85%] resize-y rounded-xl border border-border-strong bg-elevated px-3 py-2 text-[15px] focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none"
          />
          {block.files.length > 0 && (
            <p className="max-w-[85%] text-right text-[11px] text-subtle">
              Los archivos adjuntos ya están en la carpeta, pero no se reenvían: menciónalos en el texto si hacen falta.
            </p>
          )}
          {error && <p className="max-w-[85%] text-right text-xs text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" disabled={busy || !draft.trim()} onClick={() => void submit()}>
              {busy && <Loader2 size={13} className="animate-spin" />} Reintentar
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div
        id={`cw-block-${block.id}`}
        className={withCv(
          `group flex flex-col items-end gap-1.5 rounded-2xl transition-[outline-color] duration-500 ${flash ? HIGHLIGHT : 'outline-0 outline-transparent'}`,
          !!old && !flash
        )}
      >
        {block.files.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {block.files.map((f) => (
              <span key={f} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted">
                <FileText size={12} /> {f}
              </span>
            ))}
          </div>
        )}
        {block.text && <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] whitespace-pre-wrap">{block.text}</div>}
        {taskId && block.text && (
          <button
            type="button"
            onClick={() => {
              setDraft(block.text)
              setEditing(true)
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
            title="Deshace la conversación desde este mensaje (y los cambios de archivos) y lo vuelve a enviar editado"
          >
            <Pencil size={11} /> Editar y reintentar
          </button>
        )}
      </div>
    )
  },
  (a, b) =>
    a.taskId === b.taskId &&
    a.flash === b.flash &&
    a.old === b.old &&
    a.block.id === b.block.id &&
    a.block.text === b.block.text &&
    sameList(a.block.files, b.block.files)
)

export function TaskConversation({ entries, busy, error, permissions, footer, taskId }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const blocks = useMemo(() => buildBlocks(entries), [entries])
  const [forceOpenId, setForceOpenId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  // Mientras dura un salto a una parte (búsqueda/contexto) se desactiva `content-visibility` en todos los bloques: con
  // alturas reales el `scrollIntoView` centra el destino sin saltos por las alturas estimadas de lo que se saltaba.
  const [noCv, setNoCv] = useState(false)

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  const firstId = entries[0]?.info.id
  useEffect(() => {
    stickRef.current = true
  }, [firstId])

  // Búsqueda / panel de contexto ⇒ abrir el bloque que contiene esa parte, hacer scroll y resaltarlo.
  // Si el bloque aún no existe (la tarea se acaba de abrir), la petición queda pendiente y se atiende al aparecer.
  const goToPart = useCallback(
    (partId: string): boolean => {
      const id = blockIdForPart(blocks, partId)
      if (!id) return false
      const block = blocks.find((b) => b.id === id)
      stickRef.current = false
      if (block?.kind === 'steps') setForceOpenId(id)
      setFlashId(id)
      setNoCv(true)
      setTimeout(() => document.getElementById(`cw-block-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
      setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2000)
      setTimeout(() => setNoCv(false), 2500)
      clearPendingScroll(partId)
      return true
    },
    [blocks]
  )
  useEffect(() => onScrollToPart((partId) => void goToPart(partId)), [goToPart])
  useEffect(() => {
    const pid = peekPendingScroll()
    if (pid) goToPart(pid)
  }, [goToPart])

  const last = blocks[blocks.length - 1]
  const showThinking = busy && permissions.length === 0 && (!last || last.kind === 'user' || last.kind === 'text')

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'user':
              return <UserMessage key={b.id} block={b} taskId={taskId} flash={flashId === b.id} old={!noCv && isOldRow(i, blocks.length)} />
            case 'text':
              return (
                <div
                  key={b.id}
                  id={`cw-block-${b.id}`}
                  className={withCv(
                    `rounded-lg transition-[outline-color] duration-500 ${flashId === b.id ? HIGHLIGHT : 'outline-0 outline-transparent'}`,
                    !noCv && flashId !== b.id && isOldRow(i, blocks.length)
                  )}
                >
                  <Markdown text={b.text} highlight={!(busy && i === blocks.length - 1)} />
                </div>
              )
            case 'steps':
              return (
                <StepsBlock
                  key={b.id}
                  id={b.id}
                  parts={b.parts}
                  live={busy && i === blocks.length - 1}
                  forceOpen={forceOpenId === b.id}
                  flash={flashId === b.id}
                  old={!noCv && isOldRow(i, blocks.length)}
                />
              )
            case 'error':
              return <AssistantError key={b.id} info={b.info} abortedLabel="Tarea detenida." />
            case 'retry':
              return (
                <div key={b.id} className="flex items-center gap-1.5 text-xs text-muted">
                  <RotateCw size={12} /> {b.text}
                </div>
              )
            case 'file':
              return (
                <div
                  key={b.id}
                  className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-2 py-1 text-xs text-muted"
                >
                  <FileText size={13} /> {b.name}
                </div>
              )
            default:
              return null
          }
        })}
        {permissions.map((p) => (
          <PermissionCard key={p.id} request={p} />
        ))}
        {showThinking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Pensando…
          </div>
        )}
        {error && !lastAssistantFailed(entries) && <ErrorNotice error={error} />}
        {footer}
      </div>
    </div>
  )
}
