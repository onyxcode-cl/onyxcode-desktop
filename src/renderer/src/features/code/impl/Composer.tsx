/**
 * Composer del modo Code:
 *  - `/` al inicio → comandos (locales: /plan, /build, /revertir, /nueva + comandos del servidor),
 *  - `@` → autocompletado de archivos del proyecto (`find.files`), enviados como partes `file`,
 *  - Enter / ⌘Enter envía · ⇧Enter nueva línea · Esc detiene · ⇧Tab alterna Plan/Build.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command } from '@opencode-ai/sdk/v2/client'
import { ArrowUp, AtSign, File, Hammer, ListChecks, Loader2, MessageSquarePlus, Slash, Square, Undo2 } from 'lucide-react'
import { useSettings } from '../../../stores/settings'
import { useClient } from './client'
import { useCode } from './store'
import { Kbd, MOD } from './ui'

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

export function Composer({ busy, disabled }: { busy: boolean; disabled?: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const directory = useCode((s) => s.directory)
  const activeSessionID = useCode((s) => s.activeSessionID)
  const agent = useCode((s) => s.agent)
  const setAgent = useCode((s) => s.setAgent)
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const send = useCode((s) => s.send)
  const runCommand = useCode((s) => s.runCommand)
  const abort = useCode((s) => s.abort)
  const revertLast = useCode((s) => s.revertLast)
  const newSession = useCode((s) => s.newSession)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const serverCommands = useServerCommands(directory)

  const trigger = useMemo(() => {
    const t = findTrigger(text, caret)
    return t && t.start !== dismissed ? t : null
  }, [text, caret, dismissed])
  const { files, loading: filesLoading } = useFileSearch(directory, trigger?.kind === '@' ? trigger.query : null)

  // Enfoca el composer al cambiar de sesión.
  useEffect(() => {
    ref.current?.focus()
  }, [activeSessionID])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [text])

  const clear = (): void => {
    setText('')
    setCaret(0)
    setMentions([])
  }

  const localCommands: MenuItem[] = useMemo(
    () => [
      { id: 'plan', label: '/plan', hint: 'Cambiar a Plan (sin modificar archivos)', icon: <ListChecks size={14} />, run: () => setAgent('plan') },
      { id: 'build', label: '/build', hint: 'Cambiar a Build (edita y ejecuta)', icon: <Hammer size={14} />, run: () => setAgent('build') },
      { id: 'revertir', label: '/revertir', hint: 'Deshacer el último mensaje y sus cambios', icon: <Undo2 size={14} />, run: () => void revertLast() },
      { id: 'nueva', label: '/nueva', hint: 'Empezar una sesión nueva', icon: <MessageSquarePlus size={14} />, run: () => void newSession() }
    ],
    [setAgent, revertLast, newSession]
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
          hint: c.description ?? (c.source === 'mcp' ? 'MCP' : c.source === 'skill' ? 'Skill' : 'Comando'),
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

  const submit = (): void => {
    const t = text.trim()
    if (!t || busy || disabled) return
    // Comandos locales escritos a mano.
    const local = /^\/(\S+)$/.exec(t)
    const lc = local && localCommands.find((c) => c.id === local[1])
    if (lc) {
      lc.run?.()
      clear()
      return
    }
    if (!model) setModel(defaultModel)
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(t)
    if (cmd && serverCommands.some((c) => c.name === cmd[1])) {
      clear()
      void runCommand(cmd[1], cmd[2])
      return
    }
    const used = mentions.filter((m) => text.includes(`@${m}`))
    clear()
    void send(t, used)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault()
      submit()
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

  const syncCaret = (): void => {
    const el = ref.current
    if (el) setCaret(el.selectionStart ?? el.value.length)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      <div className="relative">
        {menuOpen && trigger && (
          <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-elevated shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
              {trigger.kind === '/' ? (
                <>
                  <Slash size={11} /> Comandos
                </>
              ) : (
                <>
                  <AtSign size={11} /> Archivos
                  {filesLoading && <Loader2 size={11} className="ml-1 animate-spin" />}
                </>
              )}
              <span className="ml-auto flex items-center gap-1 normal-case">
                <Kbd>↑↓</Kbd> <Kbd>↵</Kbd> <Kbd>esc</Kbd>
              </span>
            </div>
            <div role="listbox" className="max-h-64 overflow-y-auto py-1">
              {items.length === 0 && <div className="px-3 py-2 text-sm text-subtle">Buscando…</div>}
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
                    aria-selected={i === menuIndex}
                    onMouseEnter={() => setMenuIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(item)
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${i === menuIndex ? 'bg-hover text-fg' : 'text-muted'}`}
                  >
                    <span className={i === menuIndex ? 'text-accent' : 'text-subtle'}>{item.icon}</span>
                    <span className={`shrink-0 ${item.id.startsWith('f:') ? 'font-mono text-[13px]' : 'font-medium'} text-fg`}>{name}</span>
                    {dir && <span className="min-w-0 truncate font-mono text-xs text-subtle">{dir}</span>}
                    {item.hint && <span className="min-w-0 truncate text-xs text-subtle">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-elevated shadow-sm transition focus-within:border-border-strong focus-within:shadow-md">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setDismissed(null)
            }}
            onSelect={syncCaret}
            onKeyUp={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && syncCaret()}
            onKeyDown={onKeyDown}
            onBlur={() => setFocused(false)}
            onFocus={() => setFocused(true)}
            rows={1}
            disabled={disabled}
            placeholder={
              agent === 'plan'
                ? 'Describe qué quieres planificar… (@ para archivos, / para comandos)'
                : 'Pide un cambio en el código… (@ para archivos, / para comandos)'
            }
            className="block max-h-64 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <button
              type="button"
              onClick={() => setAgent(agent === 'plan' ? 'build' : 'plan')}
              title="Alternar Plan / Build (⇧Tab)"
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${agent === 'plan' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              {agent === 'plan' ? <ListChecks size={13} /> : <Hammer size={13} />}
              {agent === 'plan' ? 'Plan' : 'Build'}
            </button>
            <button
              type="button"
              title="Mencionar archivo"
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
            <span className="ml-auto hidden items-center gap-1 text-[11px] text-subtle sm:flex">
              {busy ? (
                <>
                  <Kbd>esc</Kbd> detener
                </>
              ) : (
                <>
                  <Kbd>{MOD}↵</Kbd> enviar
                </>
              )}
            </span>
            {busy ? (
              <button
                type="button"
                onClick={() => void abort()}
                title="Detener (Esc)"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() || disabled}
                title={`Enviar (Enter o ${MOD}↵)`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-center gap-3 text-[11px] text-subtle">
        <span>
          <Kbd>/</Kbd> comandos
        </span>
        <span>
          <Kbd>@</Kbd> archivos
        </span>
        <span>
          <Kbd>⇧Tab</Kbd> Plan / Build
        </span>
        <span>
          <Kbd>⇧↵</Kbd> nueva línea
        </span>
      </div>
    </div>
  )
}
