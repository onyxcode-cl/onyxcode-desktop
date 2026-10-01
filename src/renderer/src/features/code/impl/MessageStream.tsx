import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, FilePart, Part, ReasoningPart, TextPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AtSign, Copy, Check, GitFork, Loader2, Pencil, RotateCw, Undo2 } from 'lucide-react'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { Markdown } from '../../../components/Markdown'
import { t } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { isOldRow, withCv } from '../../../lib/conversation/cv'
import { lastAssistantFailed } from '../../../lib/conversation/errors'
import { AssistantError } from '../../../components/conversation/AssistantError'
import { ScrollToEnd } from '../../../components/conversation/ScrollToEnd'
import { useStickToBottom } from '../../../lib/conversation/use-stick-to-bottom'
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import { Reasoning } from '../../../components/conversation/Reasoning'
import { friendlyError } from '@shared/ai-errors'
import type { ConvError } from '../../../lib/session-reducer'
import { PermissionCard, QuestionCard } from './PermissionCard'
import { StepGroup, relPath } from './ToolCard'
import type { CodeMessage, PendingPermission, PendingQuestion } from './types'
import { ConfirmButton } from './ui'
import { useCode } from './store'

// ---------------------------------------------------------------------------
// Agrupación en bloques
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'text'; key: string; part: TextPart }
  | { kind: 'reasoning'; key: string; part: ReasoningPart }
  | { kind: 'steps'; key: string; parts: ToolPart[] }
  | { kind: 'retry'; key: string; text: string; attempt: number }
  | { kind: 'subtask'; key: string; text: string }
  | { kind: 'error'; key: string; info: AssistantMessage }

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
      if (p.type === 'text') blocks.push({ kind: 'text', key: p.id, part: p })
      else if (p.type === 'reasoning') blocks.push({ kind: 'reasoning', key: p.id, part: p })
      else if (p.type === 'retry') blocks.push({ kind: 'retry', key: p.id, text: friendlyError(p.error).message, attempt: p.attempt })
      else if (p.type === 'subtask')
        blocks.push({ kind: 'subtask', key: p.id, text: t('code.msg.subtask', { agent: p.agent, description: p.description }) })
    }
    if (m.info.role === 'assistant' && m.info.error) {
      flush()
      blocks.push({ kind: 'error', key: `${m.info.id}-err`, info: m.info })
    }
  }
  flush()
  return blocks
}

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

// Memoizada (F7-B44): props primitivas o referencias estables del store.
const UserMessage = memo(function UserMessage({
  entry,
  busy,
  root
}: {
  entry: CodeMessage
  busy: boolean
  root: string | null
}): React.JSX.Element | null {
  const t = useT()
  const revertTo = useCode((s) => s.revertTo)
  const forkSession = useCode((s) => s.forkSession)
  const editAndRetry = useCode((s) => s.editAndRetry)
  const [copied, setCopied] = useState(false)
  const [forking, setForking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const text = entry.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')
  const files = entry.parts.filter((p): p is FilePart => p.type === 'file')
  const [draft, setDraft] = useState(text)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])
  if (!text && files.length === 0) return null
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
    <div className="group/user flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
        {text}
        {files.length > 0 && (
          <div className={`${text ? 'mt-2 ' : ''}flex flex-wrap gap-1.5`}>
            {files.map((f) => {
              if (f.mime.startsWith('image/') && f.url.startsWith('data:image/')) {
                return (
                  <img
                    key={f.id}
                    src={f.url}
                    alt={f.filename ?? ''}
                    className="max-h-48 max-w-full rounded-lg border border-border object-contain"
                  />
                )
              }
              const path = f.source && 'path' in f.source ? f.source.path : (f.filename ?? f.url)
              return (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-bg/60 px-1.5 py-0.5 font-mono text-[11px] text-muted"
                  title={path}
                >
                  <AtSign size={11} /> {relPath(path.replace(/^file:\/\//, ''), root)}
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-subtle">
        <span className="rounded px-1 font-medium">{agent === 'plan' ? 'Plan' : 'Build'}</span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title={t('code.msg.copy')}
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              })
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            title={t('code.msg.forkTitle')}
            disabled={forking}
            onClick={() => {
              setForking(true)
              void forkSession(entry.info.sessionID, entry.info.id).finally(() => setForking(false))
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40"
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
              className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg"
            >
              <Pencil size={12} />
            </button>
          )}
          <ConfirmButton
            title={t('code.msg.revertTitle')}
            body={t('code.msg.revertBody')}
            confirmLabel={t('code.msg.revert')}
            danger
            disabled={busy}
            onConfirm={() => revertTo(entry.info.id)}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <Undo2 size={12} /> {t('code.msg.revert')}
          </ConfirmButton>
        </span>
      </div>
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
}

const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean => a === b || (a.length === b.length && a.every((x, i) => x === b[i]))

/**
 * Un turno solo se vuelve a pintar si cambió alguno de sus mensajes (las entradas sin cambios conservan la
 * referencia en el store), `busy`, `root`, sus permisos o si dejó de ser el último. Los `Turn`/`Block` se
 * reconstruyen en cada render del padre, por eso el comparador mira los mensajes y no los objetos de turno.
 */
const TurnView = memo(
  function TurnView({ user, assistant, isLastTurn, old, busy, root, perms, hotkeyID }: TurnViewProps): React.JSX.Element {
    const t = useT()
    const retryLast = useCode((s) => s.retryLast)
    const compactSession = useCode((s) => s.compactSession)
    // «Reintentar» / «Compactar» solo en el último turno y con la sesión libre.
    const canAct = isLastTurn && !busy
    const sessionID = user?.info.sessionID ?? assistant[0]?.info.sessionID
    const blocks = buildBlocks(assistant)
    const inlinePerms = new Map<string, PendingPermission[]>()
    for (const p of perms) if (p.tool) inlinePerms.set(p.tool.callID, [...(inlinePerms.get(p.tool.callID) ?? []), p])
    return (
      <div className={withCv('flex flex-col gap-3', old && perms.length === 0, true)}>
        {user && <UserMessage entry={user} busy={busy} root={root} />}
        {blocks.length > 0 && (
          <div className="flex flex-col gap-2">
            {blocks.map((b, bi) => {
              const live = busy && isLastTurn && bi === blocks.length - 1
              switch (b.kind) {
                case 'text':
                  return <Markdown key={b.key} text={b.part.text} highlight={!live} />
                case 'reasoning':
                  return <Reasoning key={b.key} part={b.part} live={busy && isLastTurn} variant="code" />
                case 'steps': {
                  const hasPending = b.parts.some((p) => inlinePerms.has(p.callID))
                  return (
                    <StepGroup
                      key={b.key}
                      parts={b.parts}
                      root={root}
                      live={live}
                      hasPending={hasPending}
                      after={(p) =>
                        inlinePerms
                          .get(p.callID)
                          ?.map((perm) => <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />)
                      }
                    />
                  )
                }
                case 'retry':
                  return (
                    <div key={b.key} className="flex items-center gap-1.5 text-xs text-muted">
                      <RotateCw size={12} /> {t('code.msg.retry', { attempt: b.attempt })} {b.text}
                    </div>
                  )
                case 'subtask':
                  return (
                    <div key={b.key} className="text-xs text-muted">
                      {b.text}
                    </div>
                  )
                case 'error':
                  return (
                    <AssistantError
                      key={b.key}
                      info={b.info}
                      abortedLabel={t('code.msg.aborted')}
                      onRetry={canAct ? () => retryLast() : undefined}
                      onCompact={canAct && sessionID ? () => compactSession(sessionID) : undefined}
                    />
                  )
              }
            })}
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
    sameList(a.assistant, b.assistant) &&
    sameList(a.perms, b.perms)
)

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

interface Props {
  entries: CodeMessage[]
  busy: boolean
  error: ConvError | null
  root: string | null
  permissions: PendingPermission[]
  questions: PendingQuestion[]
  /** Mensaje desde el que la sesión está revertida (se ocultan este y los siguientes). */
  revertMessageID?: string
  onUnrevert: () => void
  loading: boolean
}

export function MessageStream(props: Props): React.JSX.Element {
  const { entries, busy, error, root, permissions, questions, revertMessageID, onUnrevert, loading } = props
  const t = useT()
  const retryLast = useCode((s) => s.retryLast)
  const compactSession = useCode((s) => s.compactSession)
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom(entries[0]?.info.id)

  const visible = useMemo(
    () => (revertMessageID ? entries.filter((e) => e.info.id < revertMessageID) : entries),
    [entries, revertMessageID]
  )
  const hidden = entries.length - visible.length
  const turns = useMemo(() => buildTurns(visible), [visible])

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

  const lastTurn = turns[turns.length - 1]
  const lastAssistant = lastTurn?.assistant[lastTurn.assistant.length - 1]
  const lastHasOutput = !!lastAssistant?.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool' || p.type === 'reasoning')
  const showThinking = busy && !lastHasOutput && permissions.length === 0

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
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
          {loosePerms.map((perm) => (
            <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />
          ))}
          {questions.map((q) => (
            <QuestionCard key={q.id} request={q} />
          ))}
          {showThinking && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
              </span>
              {t('code.msg.working')}
            </div>
          )}
          {error && !lastAssistantFailed(entries) && (
            <ErrorNotice
              error={error}
              onRetry={!busy && turns.length > 0 ? () => retryLast() : undefined}
              onCompact={!busy && entries.length > 0 ? () => compactSession(entries[0].info.sessionID) : undefined}
            />
          )}
        </div>
      </div>
      <ScrollToEnd visible={!atBottom} onClick={scrollToBottom} />
    </div>
  )
}
