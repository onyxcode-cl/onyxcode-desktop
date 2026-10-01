/**
 * Composer del modo Code:
 *  - `/` al inicio → comandos (locales: /plan, /build, /revertir, /nueva + comandos del servidor),
 *  - `@` → autocompletado de archivos del proyecto (`find.files`), enviados como partes `file`,
 *  - Enter / ⌘Enter envía · ⇧Enter nueva línea · Esc detiene · ⇧Tab alterna Plan/Build.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command } from '@opencode-ai/sdk/v2/client'
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  File,
  FileImage,
  Hammer,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Send,
  Slash,
  Square,
  Undo2,
  X
} from 'lucide-react'
import { t as tg } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { isImeComposing, useAutosizeTextarea } from '../../../lib/textarea'
import { useClient } from './client'
import { ModelControls, PermissionChip, useCodeAiGate } from './ComposerControls'
import { subscribeComposerInbox } from './composer-inbox'
import { getDraft, setDraft, useDraft } from '../../../stores/drafts'
import { useCode } from './store'
import type { Attachment } from './types'
import { Kbd, MOD } from './ui'

/** Lee un `File`/`Blob` como `data:` URL (imágenes pegadas/arrastradas o adjuntos por botón). */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(tg('code.composer.readFailed')))
    reader.readAsDataURL(file)
  })
}

let attachSeq = 0
async function toAttachment(file: File): Promise<Attachment> {
  const url = await readAsDataURL(file)
  attachSeq += 1
  return {
    id: `att${Date.now()}${attachSeq}`,
    name: file.name || tg('code.composer.fileDefault'),
    mime: file.type || 'application/octet-stream',
    url
  }
}

/** Cola de mensajes de la sesión activa: reordenable, quitar, "Enviar ahora". */
function QueueList({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const t = useT()
  const items = useCode((s) => s.queue[sessionID])
  const dequeue = useCode((s) => s.dequeue)
  const moveQueued = useCode((s) => s.moveQueued)
  const sendNow = useCode((s) => s.sendNow)
  if (!items || items.length === 0) return null
  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl flex-col gap-1.5 px-6">
      {items.map((m, i) => (
        <div
          key={m.id}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-elevated/60 px-3 py-1.5 text-[13px]"
        >
          <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-subtle">{t('code.queue.queued')}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{m.text}</span>
          {m.attachments.length > 0 && (
            <span className="shrink-0 text-[11px] text-subtle">{t('code.queue.attachments', { count: m.attachments.length })}</span>
          )}
          <button
            type="button"
            title={t('code.queue.up')}
            disabled={i === 0}
            onClick={() => moveQueued(sessionID, m.id, -1)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg disabled:opacity-30"
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            title={t('code.queue.down')}
            disabled={i === items.length - 1}
            onClick={() => moveQueued(sessionID, m.id, 1)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg disabled:opacity-30"
          >
            <ArrowDown size={12} />
          </button>
          <button
            type="button"
            title={t('code.queue.sendNow')}
            onClick={() => {
              dequeue(sessionID, m.id)
              void sendNow(m.text, m.files, m.attachments)
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent hover:bg-accent-soft"
          >
            <Send size={12} />
          </button>
          <button
            type="button"
            title={t('code.queue.remove')}
            onClick={() => dequeue(sessionID, m.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-hover hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

interface MenuItem {
  id: string
  label: string
  hint?: string
  icon: React.JSX.Element
  /** Acción inmediata (comandos locales). */
  run?: () => void
  /** Texto a insertar en lugar del token. */
  insert?: string
}

interface Trigger {
  kind: '/' | '@'
  query: string
  /** Índice del carácter disparador. */
  start: number
  end: number
}

function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)([@/])([^\s@]*)$/.exec(before)
  if (!m) return null
  const kind = m[2] as '/' | '@'
  const start = before.length - m[3].length - 1
  if (kind === '/' && start !== 0) return null
  return { kind, query: m[3], start, end: caret }
}

function useServerCommands(directory: string | null): Command[] {
  const client = useClient()
  const [cmds, setCmds] = useState<Command[]>([])
  useEffect(() => {
    if (!client || !directory) return
    let cancelled = false
    client.command
      .list({ directory })
      .then((res) => !cancelled && setCmds(res.data ?? []))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, directory])
  return cmds
}

function useFileSearch(directory: string | null, query: string | null): { files: string[]; loading: boolean } {
  const client = useClient()
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!client || !directory || query === null) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      client.find
        .files({ directory, query, dirs: 'false', limit: 30 })
        .then((res) => {
          if (cancelled) return
          const base = directory.replace(/[/\\]+$/, '') + '/'
          setFiles((res.data ?? []).map((f) => (f.startsWith(base) ? f.slice(base.length) : f)).slice(0, 30))
        })
        .catch(() => !cancelled && setFiles([]))
        .finally(() => !cancelled && setLoading(false))
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [client, directory, query])
  return { files, loading }
}

const NO_MENTIONS: string[] = []
const NO_ATTACHMENTS: Attachment[] = []

export function Composer({ busy, disabled }: { busy: boolean; disabled?: boolean }): React.JSX.Element {
  const t = useT()
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directory = useCode((s) => s.directory)
  const activeSessionID = useCode((s) => s.activeSessionID)
  // F8-B32: texto y menciones se guardan por proyecto y sesión (sobreviven a cambiar de modo y de sesión).
  const draftKey = `code:${directory ?? ''}:${activeSessionID ?? 'new'}`
  const [text, setText] = useDraft(draftKey, '')
  const [mentions, setMentions] = useDraft(`${draftKey}:mentions`, NO_MENTIONS)
  // R3-A: los adjuntos (imágenes pegadas) también viven en el almacén de borradores: sobreviven a cambiar de modo.
  const [attachments, setAttachments] = useDraft(`${draftKey}:att`, NO_ATTACHMENTS)
  const draftKeyRef = useRef(draftKey)
  useEffect(() => {
    draftKeyRef.current = draftKey
  }, [draftKey])
  const [caret, setCaret] = useState(0)
  const agent = useCode((s) => s.agent)
  const setAgent = useCode((s) => s.setAgent)
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const send = useCode((s) => s.send)
  const enqueue = useCode((s) => s.enqueue)
  const sendNow = useCode((s) => s.sendNow)
  const runCommand = useCode((s) => s.runCommand)
  const abort = useCode((s) => s.abort)
  const revertLast = useCode((s) => s.revertLast)
  const newSession = useCode((s) => s.newSession)
  const aiGate = useCodeAiGate()
  const serverCommands = useServerCommands(directory)

  const addFiles = (fileList: FileList | File[]): void => {
    void Promise.all(Array.from(fileList).map(toAttachment)).then((added) => setAttachments((a) => [...a, ...added]))
  }

  const trigger = useMemo(() => {
    const t = findTrigger(text, caret)
    return t && t.start !== dismissed ? t : null
  }, [text, caret, dismissed])
  const { files, loading: filesLoading } = useFileSearch(directory, trigger?.kind === '@' ? trigger.query : null)

  // Enfoca el composer al cambiar de sesión.
  useEffect(() => {
    ref.current?.focus()
  }, [activeSessionID])

  // Bandeja del navegador integrado: "Añadir al chat" y "elemento elegido" insertan texto (y la
  // imagen, si la hay) igual que un adjunto pegado/arrastrado.
  useEffect(() => {
    if (!directory) return
    return subscribeComposerInbox(directory, ({ text, attachment }) => {
      setText((t) => (t.trim() ? `${t}\n${text}` : text))
      if (attachment) setAttachments((a) => [...a, attachment])
      requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
        setCaret(end)
      })
    })
  }, [directory, setText, setAttachments])

  useAutosizeTextarea(ref, text, { max: 260 })

  const clear = (): void => {
    setText('')
    setCaret(0)
    setMentions([])
    setAttachments([])
  }

  const restore = (d: { text: string; mentions: string[]; attachments: Attachment[] }): void => {
    setText((cur) => (cur.trim() ? cur : d.text))
    setMentions((cur) => (cur.length ? cur : d.mentions))
    // Enviar desde una sesión nueva la crea ANTES de saber si el motor acepta el mensaje: el compositor ya mira
    // el borrador de la sesión nueva, así que el texto también vuelve ahí (solo si está vacío).
    const now = draftKeyRef.current
    if (now !== draftKey && draftKey.endsWith(':new')) {
      if (!getDraft(now, '').trim()) setDraft(now, d.text)
      if (getDraft<string[]>(`${now}:mentions`, NO_MENTIONS).length === 0) setDraft(`${now}:mentions`, d.mentions)
      if (getDraft<Attachment[]>(`${now}:att`, NO_ATTACHMENTS).length === 0) setDraft(`${now}:att`, d.attachments)
    }
    setAttachments((cur) => (cur.length ? cur : d.attachments))
  }

  const localCommands: MenuItem[] = useMemo(
    () => [
      {
        id: 'plan',
        label: '/plan',
        hint: t('code.cmd.plan'),
        icon: <ListChecks size={14} />,
        run: () => setAgent('plan')
      },
      { id: 'build', label: '/build', hint: t('code.cmd.build'), icon: <Hammer size={14} />, run: () => setAgent('build') },
      {
        id: t('code.cmd.undoName'),
        label: `/${t('code.cmd.undoName')}`,
        hint: t('code.cmd.undo'),
        icon: <Undo2 size={14} />,
        run: () => void revertLast()
      },
      {
        id: t('code.cmd.newName'),
        label: `/${t('code.cmd.newName')}`,
        hint: t('code.cmd.new'),
        icon: <MessageSquarePlus size={14} />,
        run: () => void newSession()
      }
    ],
    [setAgent, revertLast, newSession, t]
  )

  const items: MenuItem[] = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    if (trigger.kind === '/') {
      const local = localCommands.filter((c) => c.id.startsWith(q))
      const remote = serverCommands
        .filter((c) => c.name.toLowerCase().includes(q) && !localCommands.some((l) => l.id === c.name))
        .slice(0, 12)
        .map<MenuItem>((c) => ({
          id: `srv:${c.name}`,
          label: `/${c.name}`,
          hint: c.description ?? (c.source === 'mcp' ? 'MCP' : c.source === 'skill' ? 'Skill' : tg('code.cmd.command')),
          icon: <Slash size={14} />,
          insert: `/${c.name} `
        }))
      return [...local, ...remote]
    }
    return files.map<MenuItem>((f) => ({ id: `f:${f}`, label: f, icon: <File size={14} />, insert: `@${f} ` }))
  }, [trigger, localCommands, serverCommands, files])

  useEffect(() => setMenuIndex(0), [trigger?.kind, trigger?.query])

  const menuOpen = focused && !!trigger && (items.length > 0 || (trigger.kind === '@' && filesLoading))

  const choose = (item: MenuItem): void => {
    if (!trigger) return
    if (item.run) {
      item.run()
      clear()
      return
    }
    const insert = item.insert ?? ''
    const next = text.slice(0, trigger.start) + insert + text.slice(trigger.end)
    const pos = trigger.start + insert.length
    setText(next)
    setCaret(pos)
    if (item.id.startsWith('f:')) setMentions((m) => [...m, item.id.slice(2)])
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) {
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  /** `force`: ⌘/Ctrl+Enter → interrumpe lo que esté en curso y envía de inmediato (salta la cola). */
  const submit = (force = false): void => {
    const t = text.trim()
    if ((!t && attachments.length === 0) || disabled) return
    // Comandos locales escritos a mano.
    const local = /^\/(\S+)$/.exec(t)
    const lc = !busy && local && localCommands.find((c) => c.id === local[1])
    if (lc) {
      lc.run?.()
      clear()
      return
    }
    // Modelo efectivo (no se toca el ajuste global): si el elegido ya no existe, se usa el de la primera IA conectada.
    const eff = aiGate.effective
    if (eff && (!model || model.providerID !== eff.providerID || model.modelID !== eff.modelID)) setModel(eff)
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(t)
    if (!busy && cmd && serverCommands.some((c) => c.name === cmd[1])) {
      clear()
      void runCommand(cmd[1], cmd[2])
      return
    }
    const used = mentions.filter((m) => text.includes(`@${m}`))
    const atts = attachments
    const draft = { text, mentions, attachments: atts }
    clear()
    // H3: el borrador se limpia al instante, pero si el motor no acepta el envío se restaura (salvo que ya se haya escrito algo nuevo).
    const settle = (ok: boolean): void => {
      if (!ok) restore(draft)
    }
    if (force) {
      void sendNow(t, used, atts).then(settle, () => settle(false))
      return
    }
    if (busy) {
      const sid = activeSessionID
      if (sid) settle(enqueue(sid, t, used, atts))
      else void send(t, used, atts).then(settle, () => settle(false))
      return
    }
    void send(t, used, atts).then(settle, () => settle(false))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isImeComposing(e)) return
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (items.length ? (i + 1) % items.length : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
        return
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || (e.key === 'Tab' && !e.shiftKey)) {
        const item = items[menuIndex]
        if (item) {
          e.preventDefault()
          choose(item)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(trigger?.start ?? null)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit(true)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(false)
      return
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      void abort()
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      setAgent(agent === 'plan' ? 'build' : 'plan')
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const imgFiles = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (imgFiles.length > 0) addFiles(imgFiles)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  const syncCaret = (): void => {
    const el = ref.current
    if (el) setCaret(el.selectionStart ?? el.value.length)
  }

  return (
    <div className="pb-4">
      {activeSessionID && <QueueList sessionID={activeSessionID} />}
      <div
        className="mx-auto w-full max-w-3xl px-6"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="relative">
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent">
              {t('code.composer.drop')}
            </div>
          )}
          {menuOpen && trigger && (
            <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-elevated shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
                {trigger.kind === '/' ? (
                  <>
                    <Slash size={11} /> {t('code.composer.commands')}
                  </>
                ) : (
                  <>
                    <AtSign size={11} /> {t('code.composer.files')}
                    {filesLoading && <Loader2 size={11} className="ml-1 animate-spin" />}
                  </>
                )}
                <span className="ml-auto flex items-center gap-1 normal-case">
                  <Kbd>↑↓</Kbd> <Kbd>↵</Kbd> <Kbd>{'esc'}</Kbd>
                </span>
              </div>
              <div
                role="listbox"
                id="code-composer-menu"
                aria-label={trigger.kind === '/' ? t('code.composer.commands') : t('code.composer.files')}
                className="max-h-64 overflow-y-auto py-1"
              >
                {items.length === 0 && <div className="px-3 py-2 text-sm text-subtle">{t('code.composer.searching')}</div>}
                {items.map((item, i) => {
                  const { dir, name } =
                    item.id.startsWith('f:') && item.label.includes('/')
                      ? { dir: item.label.slice(0, item.label.lastIndexOf('/')), name: item.label.slice(item.label.lastIndexOf('/') + 1) }
                      : { dir: '', name: item.label }
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      id={`code-composer-opt-${i}`}
                      aria-selected={i === menuIndex}
                      onMouseEnter={() => setMenuIndex(i)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        choose(item)
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${i === menuIndex ? 'bg-hover text-fg' : 'text-muted'}`}
                    >
                      <span className={i === menuIndex ? 'text-accent' : 'text-subtle'}>{item.icon}</span>
                      <span className={`shrink-0 ${item.id.startsWith('f:') ? 'font-mono text-[13px]' : 'font-medium'} text-fg`}>
                        {name}
                      </span>
                      {dir && <span className="min-w-0 truncate font-mono text-xs text-subtle">{dir}</span>}
                      {item.hint && <span className="min-w-0 truncate text-xs text-subtle">{item.hint}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-border bg-elevated shadow-sm transition focus-within:border-border-strong focus-within:shadow-md">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="group/att relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg"
                  >
                    {a.mime.startsWith('image/') ? (
                      <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                    ) : (
                      <FileImage size={18} className="text-subtle" />
                    )}
                    <button
                      type="button"
                      title={t('code.composer.removeAttachment', { name: a.name })}
                      aria-label={t('code.composer.removeAttachment', { name: a.name })}
                      onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                      className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-fg/70 text-bg opacity-0 transition group-hover/att:opacity-100 focus-visible:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <textarea
              ref={ref}
              data-code-composer=""
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={!!(menuOpen && trigger)}
              aria-controls={menuOpen && trigger ? 'code-composer-menu' : undefined}
              aria-activedescendant={menuOpen && trigger && items.length > 0 ? `code-composer-opt-${menuIndex}` : undefined}
              aria-label={t('code.composer.aria')}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
                setDismissed(null)
              }}
              onSelect={syncCaret}
              onKeyUp={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && syncCaret()}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => setFocused(false)}
              onFocus={() => setFocused(true)}
              rows={1}
              disabled={disabled}
              placeholder={
                aiGate.gate.blocked
                  ? t('code.composer.noAi')
                  : agent === 'plan'
                    ? t('code.composer.placeholderPlan')
                    : t('code.composer.placeholderBuild')
              }
              className="block max-h-64 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
            />
            <div className="flex items-center gap-2 px-3 pb-2.5">
              <button
                type="button"
                onClick={() => setAgent(agent === 'plan' ? 'build' : 'plan')}
                title={t('code.composer.toggleAgent')}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${agent === 'plan' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
              >
                {agent === 'plan' ? <ListChecks size={13} /> : <Hammer size={13} />}
                {agent === 'plan' ? 'Plan' : 'Build'}
              </button>
              <button
                type="button"
                title={t('code.composer.mention')}
                onClick={() => {
                  const el = ref.current
                  const pos = el?.selectionStart ?? text.length
                  const needsSpace = pos > 0 && !/\s/.test(text[pos - 1])
                  const next = text.slice(0, pos) + (needsSpace ? ' @' : '@') + text.slice(pos)
                  const np = pos + (needsSpace ? 2 : 1)
                  setText(next)
                  setCaret(np)
                  requestAnimationFrame(() => {
                    el?.focus()
                    el?.setSelectionRange(np, np)
                  })
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <AtSign size={14} />
              </button>
              <button
                type="button"
                title={t('code.composer.attach')}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
              >
                <Paperclip size={14} />
              </button>
              <PermissionChip />
              <span className="ml-auto" />
              <ModelControls />
              {busy && (
                <button
                  type="button"
                  onClick={() => void abort()}
                  title={t('code.composer.stop')}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              )}
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={(!text.trim() && attachments.length === 0) || disabled}
                title={busy ? t('code.composer.queueTitle', { mod: MOD }) : t('code.composer.sendTitle', { mod: MOD })}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-30"
              >
                {busy ? <Send size={14} /> : <ArrowUp size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-1.5 flex max-w-3xl justify-center gap-3 px-6 text-[11px] text-subtle">
        <span>
          <Kbd>/</Kbd> {t('code.composer.hintCommands')}
        </span>
        <span>
          <Kbd>@</Kbd> {t('code.composer.hintFiles')}
        </span>
        <span>
          <Kbd>⇧Tab</Kbd> {'Plan / Build'}
        </span>
        <span>
          <Kbd>⇧↵</Kbd> {t('code.composer.hintNewline')}
        </span>
      </div>
    </div>
  )
}
