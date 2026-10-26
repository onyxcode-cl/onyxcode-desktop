import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, FilePart, Part, ReasoningPart, TextPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AtSign, Copy, Check, GitFork, Loader2, Pencil, RotateCw, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { CopyButton } from '../../../components/Markdown'
import { DeferredMarkdown } from '../../../components/conversation/DeferredMarkdown'
import { ThinkingIndicator } from '../../../components/conversation/ThinkingIndicator'
import { CopyActionButton, MessageActionsSheet, type MessageAction } from '../../../components/mobile/MessageActionsSheet'
import { PendingBar } from '../../../components/mobile/PendingBar'
import { TappableImage } from '../../../components/mobile/ImageViewer'
import { useLongPress } from '../../../lib/use-long-press'
import { m } from '../../../app/mobile/m'
import '../../../app/mobile/conversation.css'
import { t } from '@shared/i18n'
import { stripMemoryProposalBlock } from '@shared/memory-proposal'
import { useT } from '../../../lib/i18n'
import { isOldRow, withCv } from '../../../lib/conversation/cv'
import { lastAssistantFailed } from '../../../lib/conversation/errors'
import { ConversationAnnouncer } from '../../../components/conversation/ConversationAnnouncer'
import { AssistantError } from '../../../components/conversation/AssistantError'
import { ScrollToEnd } from '../../../components/conversation/ScrollToEnd'
import { useStickToBottom } from '../../../lib/conversation/use-stick-to-bottom'
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import { Reasoning } from '../../../components/conversation/Reasoning'
import { friendlyError } from '@shared/ai-errors'
import type { ConvError } from '../../../lib/session-reducer'
import { PermissionCard, QuestionCard } from './PermissionCard'
import { CodeElicitationCard } from './CodeElicitationCard'
import { ElicitationNoticeRow } from './ElicitationCard'
import { StepGroup, ToolRow, relPath } from './ToolCard'
import { WorkFold } from './WorkFold'
import type { ElicitationNotice } from '@shared/mcp-elicitation'
import type { CodeMessage, PendingElicitation, PendingPermission, PendingQuestion } from './types'
import { ConfirmButton } from './ui'
import { compactBlockOf, useCode } from './store'
import { GeneratedFiles } from './GeneratedFiles'
import { CompactionCard } from '../../../components/conversation/CompactionCard'
import { parseCompaction } from '@shared/compaction'
import { COMPACT_BLOCK_KEY, compactableTurns, compactionPartOf, splitCompactionTurn, summaryTextOf } from './compaction-logic'
import { RewindCard } from './RewindCard'
import { RewindDialogHost, RewindNoticeHost } from './RewindHost'
import { turnsWithChanges } from './rewind-logic'
import type { TurnSummary } from '@shared/rewind'
import { ElementReadonlyChip } from '../../browser/ElementChip'
import { ShellBgWakeNote } from '../../../components/conversation/ShellBgWakeNote'
import { shellBgWakeOf } from '@shared/shell-bg-wake-marker'
import { elementTextsOf, isElementContextText, parseElementContext } from '../../browser/element-context'
import { isRemoteSurface } from '../../../lib/platform'
import { expandStepGroups, showReasoning, showStepGroup, useWorkView } from '../../../lib/reading-mode'
import { attentionSteps, isOngoing, segmentWork, type Segment, type TimedFacts, type WorkRole } from '../../../lib/conversation/work'

// ---------------------------------------------------------------------------
// Agrupación en bloques
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'text'; key: string; part: TextPart }
  | { kind: 'reasoning'; key: string; part: ReasoningPart }
  | { kind: 'steps'; key: string; parts: ToolPart[] }
  | { kind: 'retry'; key: string; text: string; attempt: number }
  | { kind: 'subtask'; key: string; text: string }
  | { kind: 'error'; key: string; info: AssistantMessage; parts: Part[] }

/** Partes que no rompen un grupo de pasos (no se muestran). */
const TRANSPARENT = new Set<Part['type']>(['step-start', 'step-finish', 'snapshot', 'patch', 'compaction', 'agent'])

function buildBlocks(messages: CodeMessage[]): Block[] {
  const blocks: Block[] = []
  let steps: ToolPart[] | null = null
  const flush = (): void => {
    if (steps && steps.length) blocks.push({ kind: 'steps', key: steps[0].id, parts: steps })
    steps = null
  }
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool') {
        ;(steps ??= []).push(p)
        continue
      }
      if (TRANSPARENT.has(p.type)) continue
      if (p.type === 'reasoning' && !p.text.trim()) continue
      if (p.type === 'text' && (p.synthetic || p.ignored || !p.text)) continue
      flush()
      if (p.type === 'text') {
        // El bloque ```lazunox-memoria``` (propuesta de memoria que el usuario aprueba desde una tarjeta,
        // ver `CodeMemoryProposalCard`) es un contrato con el agente, no texto para leer: se quita aquí,
        // igual para TODO mensaje (no solo el último).
        const stripped = stripMemoryProposalBlock(p.text)
        if (!stripped) continue
        blocks.push({ kind: 'text', key: p.id, part: stripped === p.text ? p : { ...p, text: stripped } })
      } else if (p.type === 'reasoning') blocks.push({ kind: 'reasoning', key: p.id, part: p })
      else if (p.type === 'retry') blocks.push({ kind: 'retry', key: p.id, text: friendlyError(p.error).message, attempt: p.attempt })
      else if (p.type === 'subtask')
        blocks.push({ kind: 'subtask', key: p.id, text: t('code.msg.subtask', { agent: p.agent, description: p.description }) })
    }
    if (m.info.role === 'assistant' && m.info.error) {
      flush()
      blocks.push({ kind: 'error', key: `${m.info.id}-err`, info: m.info, parts: m.parts })
    }
  }
  flush()
  return blocks
}

/** Papel de cada bloque para decidir qué entra en el trabajo plegado. */
function blockRole(b: Block): WorkRole {
  switch (b.kind) {
    case 'steps':
      return 'tool'
    case 'reasoning':
      return 'reasoning'
    case 'text':
      return 'text'
    default:
      return 'break'
  }
}

const blockKey = (b: Block): string => `work-${b.key}`

/** Turno: un mensaje de usuario y las respuestas del asistente que le siguen. */
interface Turn {
  user: CodeMessage | null
  assistant: CodeMessage[]
}

function buildTurns(entries: CodeMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const e of entries) {
    if (e.info.role === 'user') turns.push({ user: e, assistant: [] })
    else if (turns.length) turns[turns.length - 1].assistant.push(e)
    else turns.push({ user: null, assistant: [e] })
  }
  return turns
}

// ---------------------------------------------------------------------------
// Mensaje de usuario
// ---------------------------------------------------------------------------

/** Imagen adjunta de un mensaje de usuario. En el celular se toca para ampliarla; en el escritorio es la de siempre. */
function UserImage({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const img = <img src={src} alt={alt} className="max-h-48 max-w-full rounded-lg border border-border object-contain" />
  if (!isRemoteSurface()) return img
  return (
    <TappableImage open={open} setOpen={setOpen} src={src} alt={alt} className="block max-w-full">
      {img}
    </TappableImage>
  )
}

// Memoizada (F7-B44): props primitivas o referencias estables del store.
const UserMessage = memo(function UserMessage({
  entry,
  busy,
  root,
  compactable
}: {
  entry: CodeMessage
  busy: boolean
  root: string | null
  /** Se puede compactar «hasta aquí» desde este mensaje (después de la última compactación y no el primero). */
  compactable: boolean
}): React.JSX.Element | null {
  const t = useT()
  const revertTo = useCode((s) => s.revertTo)
  // «Compactar hasta aquí»: solo con el motor propio nuevo y en el Mac; deshabilitado con el motivo si el motor se negaría (409).
  const compactOk = useCode((s) => compactable && s.rewindSupport[entry.info.sessionID] === true)
  const compactBlock = useCode((s) => (compactable ? compactBlockOf(s, entry.info.sessionID) : null))
  const compactUpTo = useCode((s) => s.compactUpTo)
  // Motor con rebobinar por turno: «Revertir» abre el diálogo «Volver a antes de este turno». Sin él, el «Revertir» de siempre.
  const rewindOk = useCode((s) => s.rewindSupport[entry.info.sessionID] === true)
  const openRewind = useCode((s) => s.openRewind)
  const forkSession = useCode((s) => s.forkSession)
  const editAndRetry = useCode((s) => s.editAndRetry)
  const [copied, setCopied] = useState(false)
  const [forking, setForking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const text = entry.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic && !isElementContextText(p.text))
    .map((p) => p.text)
    .join('\n')
  // Elementos del navegador: el bloque sintético se ve como un chip compacto (con el detalle al abrirlo), nunca como volcado.
  const elements = useMemo(() => elementTextsOf(entry.parts).flatMap((x) => parseElementContext(x) ?? []), [entry.parts])
  const files = entry.parts.filter((p): p is FilePart => p.type === 'file')
  const [draft, setDraft] = useState(text)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [sheet, setSheet] = useState(false)
  const longPress = useLongPress(() => setSheet(true))
  const mobile = isRemoteSurface()
  useEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])
  if (!text && files.length === 0 && elements.length === 0) return null
  const cancelEdit = (): void => {
    setEditing(false)
    setDraft(text)
  }
  const submitEdit = async (): Promise<void> => {
    const next = draft.trim()
    if (pending || (!next && files.length === 0)) return
    // Deshace también los cambios de archivos desde aquí, igual que «Revertir»: se pide confirmar.
    const ok = await confirmDialog({
      title: t('code.msg.editTitle'),
      message: t('code.msg.editBody'),
      confirmLabel: t('code.msg.editSend'),
      danger: true
    })
    if (!ok) return
    setPending(true)
    try {
      if (await editAndRetry(entry.info.id, next)) setEditing(false)
    } finally {
      setPending(false)
    }
  }
  const compactHere = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('code.compaction.upTo.title'),
      message: t('code.compaction.upTo.body'),
      confirmLabel: t('code.compaction.upTo.confirm')
    })
    if (ok) await compactUpTo(entry.info.sessionID, entry.info.id)
  }
  if (editing) {
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        <textarea
          ref={taRef}
          value={draft}
          disabled={pending}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          aria-label={t('code.msg.editAria')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelEdit()
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitEdit()
          }}
          className="w-full max-w-[85%] resize-y rounded-xl border border-border-strong bg-elevated px-3 py-2 text-[15px] focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={cancelEdit}>
            {t('code.msg.editCancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={pending || (!draft.trim() && files.length === 0)} onClick={() => void submitEdit()}>
            {t('code.msg.editSend')}
          </Button>
        </div>
      </div>
    )
  }
  const agent = entry.info.role === 'user' ? entry.info.agent : undefined
  return (
    <div className="group/user flex flex-col items-end gap-1 desk:relative">
      <div
        {...m('user-bubble')}
        {...(longPress ? { ...longPress, 'data-long-press': '' } : {})}
        className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap desk:max-w-[80%] desk:leading-6"
      >
        {elements.length > 0 && (
          <div className={`${text || files.length > 0 ? 'mb-2 ' : ''}flex flex-wrap gap-1.5 whitespace-normal`} data-testid="user-elements">
            {elements.map((d, i) => (
              <ElementReadonlyChip key={i} detail={d} />
            ))}
          </div>
        )}
        {text}
        {files.length > 0 && (
          <div className={`${text ? 'mt-2 ' : ''}flex flex-wrap gap-1.5`}>
            {files.map((f) => {
              if (f.mime.startsWith('image/') && f.url.startsWith('data:image/')) {
                return <UserImage key={f.id} src={f.url} alt={f.filename ?? ''} />
              }
              const path = f.source && 'path' in f.source ? f.source.path : (f.filename ?? f.url)
              return (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-bg/60 px-1.5 py-0.5 font-mono text-[11px] desk:text-meta text-muted"
                  title={path}
                >
                  <AtSign size={11} /> {relPath(path.replace(/^file:\/\//, ''), root)}
                </span>
              )
            })}
          </div>
        )}
      </div>
      {mobile && (
        <MessageActionsSheet
          open={sheet}
          onClose={() => setSheet(false)}
          text={text}
          subtitle={agent === 'plan' ? 'Plan' : 'Build'}
          actions={[
            ...(text
              ? [
                  {
                    label: t('code.msg.edit'),
                    icon: <Pencil size={20} />,
                    onSelect: () => {
                      setDraft(text)
                      setEditing(true)
                    }
                  }
                ]
              : []),
            {
              label: t('code.msg.forkTitle'),
              icon: <GitFork size={20} />,
              disabled: forking,
              onSelect: () => {
                setForking(true)
                void forkSession(entry.info.sessionID, entry.info.id).finally(() => setForking(false))
              }
            },
            {
              label: t('code.msg.revert'),
              icon: <Undo2 size={20} />,
              danger: true,
              disabled: busy,
              onSelect: () => {
                void confirmDialog({
                  title: t('code.msg.revertTitle'),
                  message: t('code.msg.revertBody'),
                  confirmLabel: t('code.msg.revert'),
                  danger: true
                }).then((ok) => (ok ? revertTo(entry.info.id) : undefined))
              }
            } satisfies MessageAction
          ]}
        />
      )}
      {!mobile && (
        <div className="flex items-center gap-1 text-[11px] desk:text-meta text-subtle desk:absolute desk:top-full desk:right-0 desk:z-[1]">
          <span
            className={`rounded px-1 font-medium${agent === 'plan' ? ' desk:h-5 desk:bg-accent-soft desk:px-1.5 desk:leading-5 desk:text-accent' : ' desk:hidden'}`}
          >
            {agent === 'plan' ? 'Plan' : 'Build'}
          </span>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              title={t('code.msg.copy')}
              aria-label={t('code.msg.copy')}
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg desk:h-7 desk:min-w-7 desk:justify-center"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <button
              type="button"
              title={t('code.msg.forkTitle')}
              aria-label={t('code.msg.forkTitle')}
              disabled={forking}
              onClick={() => {
                setForking(true)
                void forkSession(entry.info.sessionID, entry.info.id).finally(() => setForking(false))
              }}
              className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40 desk:h-7 desk:min-w-7 desk:justify-center"
            >
              <GitFork size={12} />
            </button>
            {text && (
              <button
                type="button"
                title={t('code.msg.edit')}
                aria-label={t('code.msg.edit')}
                onClick={() => {
                  setDraft(text)
                  setEditing(true)
                }}
                className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg desk:h-7 desk:min-w-7 desk:justify-center"
              >
                <Pencil size={12} />
              </button>
            )}
            {compactOk && (
              <button
                type="button"
                title={compactBlock ? t(COMPACT_BLOCK_KEY[compactBlock]) : t('code.compaction.upTo')}
                aria-label={
                  compactBlock ? `${t('code.compaction.upTo')}. ${t(COMPACT_BLOCK_KEY[compactBlock])}` : t('code.compaction.upTo')
                }
                disabled={!!compactBlock}
                onClick={() => void compactHere()}
                className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40 desk:h-7 desk:min-w-7 desk:justify-center"
              >
                <Sparkles size={12} /> {t('code.compaction.upTo')}
              </button>
            )}
            {rewindOk ? (
              <button
                type="button"
                title={t('code.turn.rewind')}
                aria-label={t('code.turn.rewind')}
                disabled={busy}
                onClick={() => openRewind(entry.info.id)}
                className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40 desk:h-7 desk:min-w-7 desk:justify-center"
              >
                <Undo2 size={12} /> {t('code.msg.revert')}
              </button>
            ) : (
              <ConfirmButton
                title={t('code.msg.revertTitle')}
                body={t('code.msg.revertBody')}
                confirmLabel={t('code.msg.revert')}
                danger
                disabled={busy}
                onConfirm={() => revertTo(entry.info.id)}
                className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40 desk:h-7 desk:min-w-7 desk:justify-center"
              >
                <Undo2 size={12} /> {t('code.msg.revert')}
              </ConfirmButton>
            )}
          </span>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Turno (memoizado, F7-B44)
// ---------------------------------------------------------------------------

/** Sin permisos ligados: referencia estable para no romper la memoización de los turnos. */
const NO_PERMS: PendingPermission[] = []

interface TurnViewProps {
  user: CodeMessage | null
  assistant: CodeMessage[]
  isLastTurn: boolean
  /** Turno antiguo: `content-visibility: auto`. */
  old: boolean
  busy: boolean
  root: string | null
  /** Permisos ligados a llamadas de herramienta de ESTE turno (`NO_PERMS` si no hay). */
  perms: PendingPermission[]
  hotkeyID: string | undefined
  /** «Cambios de este turno» (motor con rebobinar por turno); `undefined` si el turno no cambió archivos o el motor no lo tiene. */
  changes?: TurnSummary
  /** «Compactar hasta aquí» disponible desde el mensaje de este turno. */
  compactable?: boolean
  /** Archivos de este turno que un rebobinado activo ya revirtió (`undefined` si ninguno). */
  revertedFiles?: ReadonlySet<string>
}

const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean => a === b || (a.length === b.length && a.every((x, i) => x === b[i]))

/**
 * Un turno solo se vuelve a pintar si cambió alguno de sus mensajes (las entradas sin cambios conservan la
 * referencia en el store), `busy`, `root`, sus permisos o si dejó de ser el último. Los `Turn`/`Block` se
 * reconstruyen en cada render del padre, por eso el comparador mira los mensajes y no los objetos de turno.
 */
const TurnView = memo(
  function TurnView({
    user,
    assistant,
    isLastTurn,
    old,
    busy,
    root,
    perms,
    hotkeyID,
    changes,
    compactable,
    revertedFiles
  }: TurnViewProps): React.JSX.Element {
    const t = useT()
    const retryLast = useCode((s) => s.retryLast)
    const compactSession = useCode((s) => s.compactSession)
    const loadTurnDiff = useCode((s) => s.loadTurnDiff)
    const openRewind = useCode((s) => s.openRewind)
    // «Reintentar» / «Compactar» solo en el último turno y con la sesión libre.
    const canAct = isLastTurn && !busy
    const sessionID = user?.info.sessionID ?? assistant[0]?.info.sessionID
    // Turno de compactación: el mensaje de la persona lleva la parte `compaction` y la respuesta es el resumen. Se muestra una tarjeta
    // (qué se resumió, tokens liberados, lo que se mantuvo) y el resumen queda tras «Ver resumen»; lo demás se pinta como siempre.
    const compactionPart = user ? compactionPartOf(user.parts) : undefined
    const compaction = useMemo(() => (compactionPart ? splitCompactionTurn(assistant) : null), [compactionPart, assistant])
    const compactionMeta = useMemo(() => parseCompaction(compactionPart), [compactionPart])
    const summaryText = compaction ? summaryTextOf(compaction.summary) : ''
    const blocks = buildBlocks(compaction ? compaction.rest : assistant)
    const replyText = blocks
      .flatMap((b) => (b.kind === 'text' ? [b.part.text] : []))
      .join('\n\n')
      .trim()
    const showCopy = !!replyText && !(busy && isLastTurn)
    const mobile = isRemoteSurface()
    // Modo de lectura: solo escritorio (el celular conserva siempre el comportamiento de siempre).
    const readingStored = useWorkView('code')
    const reading = mobile ? 'normal' : readingStored
    const segments: Segment<Block>[] = mobile ? [{ kind: 'plain', items: blocks }] : segmentWork(blocks, blockRole)
    const [sheet, setSheet] = useState(false)
    const longPress = useLongPress(() => setSheet(true))
    const inlinePerms = new Map<string, PendingPermission[]>()
    for (const p of perms) if (p.tool) inlinePerms.set(p.tool.callID, [...(inlinePerms.get(p.tool.callID) ?? []), p])
    const turnLive = busy && isLastTurn
    const permCards = (p: ToolPart): React.JSX.Element[] | undefined =>
      inlinePerms.get(p.callID)?.map((perm) => <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />)

    /** Un bloque suelto (fuera del plegado del trabajo). */
    const renderBlock = (b: Block, bi: number): React.JSX.Element | null => {
      const live = turnLive && bi === blocks.length - 1
      switch (b.kind) {
        case 'text':
          return <DeferredMarkdown key={b.key} text={b.part.text} highlight={!live} />
        case 'reasoning':
          if (!showReasoning(reading)) return null
          return <Reasoning key={b.key} part={b.part} live={turnLive} variant={isRemoteSurface() ? 'code' : 'chat'} />
        case 'steps': {
          const hasPending = b.parts.some((p) => inlinePerms.has(p.callID))
          const hasError = b.parts.some((p) => p.state.status === 'error')
          if (!showStepGroup(reading, { hasPending, hasError })) return null
          return (
            <StepGroup
              key={b.key}
              parts={b.parts}
              root={root}
              live={live}
              hasPending={hasPending}
              forceOpen={expandStepGroups(reading)}
              after={permCards}
            />
          )
        }
        case 'retry':
          return (
            <div key={b.key} {...m('meta')} className="flex items-center gap-1.5 text-xs text-muted">
              <RotateCw size={12} /> {t('code.msg.retry', { attempt: b.attempt })} {b.text}
            </div>
          )
        case 'subtask':
          return (
            <div key={b.key} {...m('meta')} className="text-xs text-muted">
              {b.text}
            </div>
          )
        case 'error':
          return (
            <AssistantError
              key={b.key}
              info={b.info}
              abortedLabel={t('code.msg.aborted')}
              parts={b.parts}
              onRetry={canAct ? () => retryLast() : undefined}
              onCompact={canAct && sessionID ? () => compactSession(sessionID) : undefined}
            />
          )
      }
    }

    /** Todo el trabajo de la respuesta en una línea plegable (permisos y errores siempre a la vista). */
    const renderWork = (seg: Segment<Block>, si: number): React.JSX.Element => {
      const tools = seg.items.flatMap<ToolPart>((b) => (b.kind === 'steps' ? b.parts : []))
      const timed = seg.items.flatMap<TimedFacts>((b) =>
        b.kind === 'steps' ? b.parts : b.kind === 'reasoning' || b.kind === 'text' ? [b.part] : []
      )
      const attention = attentionSteps(tools, new Set(inlinePerms.keys()))
      const stepRow = (p: ToolPart): React.JSX.Element => (
        <div key={p.id}>
          <ToolRow part={p} root={root} />
          {permCards(p)}
        </div>
      )
      return (
        <WorkFold
          key={seg.items[0] ? blockKey(seg.items[0]) : `w${si}`}
          parts={timed}
          tools={tools}
          live={turnLive && isOngoing(segments, si, blockRole)}
          view={reading}
          root={root}
          attention={attention}
          renderStep={stepRow}
          renderList={() =>
            seg.items.map((b) => {
              switch (b.kind) {
                case 'steps':
                  return b.parts.map(stepRow)
                case 'reasoning':
                  return <Reasoning key={b.key} part={b.part} live={turnLive} variant={isRemoteSurface() ? 'code' : 'chat'} />
                case 'text':
                  return <DeferredMarkdown key={b.key} text={b.part.text} highlight={!turnLive} />
                default:
                  return null
              }
            })
          }
        />
      )
    }
    const wakeInfo = user ? shellBgWakeOf(user.parts) : null
    return (
      <div data-message-id={user?.info.id} className={withCv('group/turn flex flex-col gap-3', old && perms.length === 0, true)}>
        {user &&
          (compactionPart ? (
            <CompactionCard meta={compactionMeta} running={isLastTurn && busy && !summaryText}>
              {summaryText ? <DeferredMarkdown text={summaryText} highlight /> : null}
            </CompactionCard>
          ) : wakeInfo ? (
            <ShellBgWakeNote info={wakeInfo} />
          ) : (
            <UserMessage entry={user} busy={busy} root={root} compactable={!!compactable} />
          ))}
        {blocks.length > 0 && (
          <div
            className={mobile ? 'flex flex-col gap-2.5' : 'flex flex-col gap-2'}
            {...(longPress && replyText ? { ...longPress, 'data-long-press': '' } : {})}
          >
            {segments.map((seg, si) => {
              if (seg.kind === 'plain') return seg.items.map((b) => renderBlock(b, blocks.indexOf(b)))
              return renderWork(seg, si)
            })}
          </div>
        )}
        {!mobile && <GeneratedFiles parts={assistant.flatMap((a) => a.parts)} root={root} done={!(busy && isLastTurn)} />}
        {!mobile && changes && user && sessionID && !(busy && isLastTurn) && (
          <RewindCard
            summary={changes}
            disabled={busy}
            revertedFiles={revertedFiles}
            onRewind={() => openRewind(user.info.id)}
            loadDiff={(file) => loadTurnDiff(sessionID, user.info.id, file)}
          />
        )}
        {mobile && replyText && <MessageActionsSheet open={sheet} onClose={() => setSheet(false)} text={replyText} />}
        {mobile && showCopy && isLastTurn && (
          <div className="-ml-1.5 flex items-center gap-0.5">
            <CopyActionButton text={replyText} label={t('code.msg.copyReply')} />
          </div>
        )}
        {!mobile && showCopy && (
          <div
            className={`-ml-1.5 flex items-center gap-0.5 transition-opacity ${isLastTurn ? 'opacity-100' : 'opacity-0 group-hover/turn:opacity-100 focus-within:opacity-100'}`}
          >
            <CopyButton text={replyText} label={t('code.msg.copyReply')} />
          </div>
        )}
      </div>
    )
  },
  (a, b) =>
    a.user === b.user &&
    a.isLastTurn === b.isLastTurn &&
    a.old === b.old &&
    a.busy === b.busy &&
    a.root === b.root &&
    a.hotkeyID === b.hotkeyID &&
    a.changes === b.changes &&
    a.compactable === b.compactable &&
    a.revertedFiles === b.revertedFiles &&
    sameList(a.assistant, b.assistant) &&
    sameList(a.perms, b.perms)
)

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

const NO_ELICITATIONS: PendingElicitation[] = []
const NO_NOTICES: ElicitationNotice[] = []

interface Props {
  entries: CodeMessage[]
  busy: boolean
  error: ConvError | null
  root: string | null
  permissions: PendingPermission[]
  questions: PendingQuestion[]
  /** Formularios de conectores pendientes de esta conversación (y sus ayudantes). */
  elicitations?: PendingElicitation[]
  /** Avisos breves de rechazos de formularios (secreto, esquema…), con su cierre. */
  elicitationNotices?: ElicitationNotice[]
  /** Mensaje desde el que la sesión está revertida (se ocultan este y los siguientes). */
  revertMessageID?: string
  onUnrevert: () => void
  loading: boolean
  /** El motor está reintentando (estado `retry`): el indicador lo dice en vez de «Trabajando…». */
  retrying?: boolean
  /** Motivo conocido del reintento (p. ej. se acabó el uso gratuito). */
  retryLabel?: string
}

export function MessageStream(props: Props): React.JSX.Element {
  const { entries, busy, error, root, permissions, questions, revertMessageID, onUnrevert, loading, retrying, retryLabel } = props
  const elicitations = props.elicitations ?? NO_ELICITATIONS
  const elicitationNotices = props.elicitationNotices ?? NO_NOTICES
  const dismissNotice = useCode((s) => s.dismissElicitationNotice)
  const t = useT()
  const retryLast = useCode((s) => s.retryLast)
  const compactSession = useCode((s) => s.compactSession)
  const streamSessionID = entries[0]?.info.sessionID
  const turnList = useCode((s) => (streamSessionID ? s.turnsBySession[streamSessionID] : undefined))
  const loadTurns = useCode((s) => s.loadTurns)
  const changesByUser = useMemo(() => turnsWithChanges(turnList), [turnList])
  const rewound = useCode((s) => (streamSessionID ? s.rewoundFiles[streamSessionID] : undefined))
  const rewoundSet = useMemo(() => (rewound ? new Set(rewound.files) : undefined), [rewound])
  // «Cambios de este turno»: se piden al abrir la conversación y cuando termina de trabajar (el celular no los pide).
  useEffect(() => {
    if (streamSessionID && !busy && !isRemoteSurface()) void loadTurns(streamSessionID)
  }, [streamSessionID, busy, loadTurns, entries.length])
  const { scrollRef, stickRef, atBottom, onScroll, scrollToBottom } = useStickToBottom(entries[0]?.info.id)

  const visible = useMemo(
    () => (revertMessageID ? entries.filter((e) => e.info.id < revertMessageID) : entries),
    [entries, revertMessageID]
  )
  const hidden = entries.length - visible.length
  const turns = useMemo(() => buildTurns(visible), [visible])
  const compactableAt = useMemo(
    () =>
      compactableTurns(turns, (u) =>
        u.parts.some((p) => (p.type === 'text' && !p.synthetic && !p.ignored && !!p.text) || p.type === 'file')
      ),
    [turns]
  )

  // Permisos ligados a una llamada de herramienta visible se muestran junto a ella (en el turno que la contiene).
  const loosePerms: PendingPermission[] = []
  const turnPerms: PendingPermission[][] = turns.map(() => NO_PERMS)
  if (permissions.length > 0) {
    const callIdsByTurn = turns.map((t) => {
      const ids = new Set<string>()
      for (const e of t.assistant) for (const p of e.parts) if (p.type === 'tool') ids.add(p.callID)
      if (t.user) for (const p of t.user.parts) if (p.type === 'tool') ids.add(p.callID)
      return ids
    })
    for (const p of permissions) {
      let placed = false
      callIdsByTurn.forEach((ids, ti) => {
        if (p.tool && ids.has(p.tool.callID)) {
          turnPerms[ti] = turnPerms[ti] === NO_PERMS ? [p] : [...turnPerms[ti], p]
          placed = true
        }
      })
      if (!placed) loosePerms.push(p)
    }
  }
  const hotkeyID = permissions[0]?.id

  // Celular: un permiso o pregunta nuevo siempre se lleva a la vista (aunque hubieras subido en la conversación).
  const pending = permissions.length + questions.length + elicitations.length
  const [barShown, setBarShown] = useState(false)
  const prevPending = useRef(pending)
  useEffect(() => {
    const grew = pending > prevPending.current
    prevPending.current = pending
    const el = scrollRef.current
    if (!grew || !el || !isRemoteSurface()) return
    stickRef.current = true
    el.scrollTop = el.scrollHeight
  }, [pending, scrollRef, stickRef])

  const lastTurn = turns[turns.length - 1]
  const lastAssistant = lastTurn?.assistant[lastTurn.assistant.length - 1]
  const lastHasOutput = !!lastAssistant?.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool' || p.type === 'reasoning')
  const showThinking = busy && !lastHasOutput && permissions.length === 0 && elicitations.length === 0

  return (
    <div className="relative min-h-0 flex-1 desk:before:pointer-events-none desk:before:absolute desk:before:inset-x-0 desk:before:bottom-0 desk:before:h-6 desk:before:bg-gradient-to-t desk:before:from-bg desk:before:to-transparent">
      <ConversationAnnouncer busy={busy} error={error} entries={entries} />
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div
          className={`mx-auto flex max-w-3xl flex-col desk:max-w-[var(--measure-prose)] desk:pt-8 desk:pb-12 ${isRemoteSurface() ? 'gap-6 px-4 pt-3 pb-4' : 'gap-6 px-6 py-6'}`}
        >
          {loading && entries.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> {t('code.msg.loading')}
            </div>
          )}
          {turns.map((turn, ti) => (
            <TurnView
              key={turn.user?.info.id ?? `t${ti}`}
              user={turn.user}
              assistant={turn.assistant}
              isLastTurn={ti === turns.length - 1}
              old={isOldRow(ti, turns.length, 4)}
              busy={busy}
              root={root}
              perms={turnPerms[ti]}
              hotkeyID={hotkeyID}
              changes={turn.user ? changesByUser.get(turn.user.info.id) : undefined}
              compactable={compactableAt[ti]}
              revertedFiles={rewoundSet && turn.user && turn.user.info.id >= rewound!.fromMessageID ? rewoundSet : undefined}
            />
          ))}
          {hidden > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
              <span className="flex items-center gap-2">
                <Undo2 size={14} /> {t('code.msg.hidden', { count: hidden })}
              </span>
              <button type="button" onClick={onUnrevert} className="rounded-md px-2 py-0.5 font-medium text-accent hover:bg-accent-soft">
                {t('code.msg.restore')}
              </button>
            </div>
          )}
          {streamSessionID && <RewindNoticeHost sessionID={streamSessionID} busy={busy} />}
          {streamSessionID && <RewindDialogHost sessionID={streamSessionID} />}
          {loosePerms.map((perm) => (
            <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />
          ))}
          {questions.map((q) => (
            <QuestionCard key={q.id} request={q} />
          ))}
          {elicitations.map((e) => (
            <CodeElicitationCard key={e.id} request={e} />
          ))}
          {elicitationNotices.map((n) => (
            <ElicitationNoticeRow key={n.id} notice={n} onDismiss={() => dismissNotice(n.id)} />
          ))}
          {showThinking && <ThinkingIndicator label={retrying ? (retryLabel ?? t('chat.msg.retrying')) : t('code.msg.working')} />}
          {error && !lastAssistantFailed(entries) && (
            <ErrorNotice
              error={error}
              onRetry={!busy && turns.length > 0 ? () => retryLast() : undefined}
              onCompact={!busy && entries.length > 0 ? () => compactSession(entries[0].info.sessionID) : undefined}
            />
          )}
        </div>
      </div>
      {isRemoteSurface() && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-bg to-transparent" />
      )}
      {isRemoteSurface() && <PendingBar scrollRef={scrollRef} count={pending} onShownChange={setBarShown} />}
      <ScrollToEnd visible={!atBottom && !barShown} onClick={scrollToBottom} fresh={busy} />
    </div>
  )
}
