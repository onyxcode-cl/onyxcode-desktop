import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, FilePart, Part, ReasoningPart, TextPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, AtSign, Copy, Check, GitFork, Loader2, RotateCw, Undo2 } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { isOldRow, withCv } from '../../../lib/conversation/cv'
import { AssistantError } from '../../../components/conversation/AssistantError'
import { Reasoning } from '../../../components/conversation/Reasoning'
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
      else if (p.type === 'retry') blocks.push({ kind: 'retry', key: p.id, text: p.error.data.message, attempt: p.attempt })
      else if (p.type === 'subtask') blocks.push({ kind: 'subtask', key: p.id, text: `Subtarea (${p.agent}): ${p.description}` })
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
  const revertTo = useCode((s) => s.revertTo)
  const forkSession = useCode((s) => s.forkSession)
  const [copied, setCopied] = useState(false)
  const [forking, setForking] = useState(false)
  const text = entry.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')
  const files = entry.parts.filter((p): p is FilePart => p.type === 'file')
  if (!text && files.length === 0) return null
  const agent = entry.info.role === 'user' ? entry.info.agent : undefined
  return (
    <div className="group/user flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
        {text}
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((f) => {
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
            title="Copiar"
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
            title="Bifurcar la sesión desde aquí (crea una sesión nueva)"
            disabled={forking}
            onClick={() => {
              setForking(true)
              void forkSession(entry.info.sessionID, entry.info.id).finally(() => setForking(false))
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <GitFork size={12} />
          </button>
          <ConfirmButton
            title="¿Revertir a este punto?"
            body="Se ocultará este mensaje y todo lo que vino después, y se desharán los cambios en archivos que hizo el agente desde aquí. Puedes restaurarlo mientras no envíes un mensaje nuevo."
            confirmLabel="Revertir"
            danger
            disabled={busy}
            onConfirm={() => revertTo(entry.info.id)}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <Undo2 size={12} /> Revertir
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
                      <RotateCw size={12} /> Reintento {b.attempt}: {b.text}
                    </div>
                  )
                case 'subtask':
                  return (
                    <div key={b.key} className="text-xs text-muted">
                      {b.text}
                    </div>
                  )
                case 'error':
                  return <AssistantError key={b.key} info={b.info} abortedLabel="Detenido por el usuario." />
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
  error: string | null
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

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
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        {loading && entries.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Cargando…
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
              <Undo2 size={14} /> {hidden === 1 ? '1 mensaje revertido' : `${hidden} mensajes revertidos`}
            </span>
            <button type="button" onClick={onUnrevert} className="rounded-md px-2 py-0.5 font-medium text-accent hover:bg-accent-soft">
              Restaurar
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
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            Trabajando…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
