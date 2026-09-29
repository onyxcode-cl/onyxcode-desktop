/**
 * Paleta de comandos (⌘K / ⌘⇧P): ir a un modo, crear algo nuevo, abrir Ajustes, cambiar el tema
 * y saltar a una conversación reciente. Solo navegación y acciones ya existentes: no toca stores ajenos.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CornerDownLeft, Monitor, MessageSquare, Moon, Plus, Search, Settings, Sun, type LucideIcon } from 'lucide-react'
import { openChatSession } from '../features/chat/actions'
import { useServer } from '../stores/server'
import { selectSessionsForDirectory, useSessions } from '../stores/sessions'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'
import { MODES, MODES_BY_ID } from './modes'

interface Command {
  id: string
  group: string
  label: string
  icon: LucideIcon
  /** Texto extra para la búsqueda (no se muestra). */
  keywords?: string
  /** Texto secundario a la derecha. */
  hint?: string
  run: () => void
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function useCommands(): Command[] {
  const mode = useUi((s) => s.mode)
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const updateSettings = useSettings((s) => s.update)

  return useMemo(() => {
    const ui = useUi.getState()
    const list: Command[] = []

    const newAction = MODES_BY_ID[mode].newAction
    if (newAction) {
      list.push({
        id: 'new',
        group: 'Acciones',
        label: newAction.label,
        icon: Plus,
        hint: '⌘N',
        keywords: 'nuevo crear',
        run: () => {
          ui.openSettings(false)
          newAction.run()
        }
      })
    }

    for (const m of MODES) {
      list.push({
        id: `mode:${m.id}`,
        group: 'Ir a',
        label: m.label,
        icon: m.icon,
        keywords: 'modo ir abrir',
        hint: m.id === mode ? 'Actual' : undefined,
        run: () => ui.setMode(m.id)
      })
    }

    list.push({
      id: 'settings',
      group: 'Ir a',
      label: 'Ajustes',
      icon: Settings,
      hint: '⌘,',
      keywords: 'preferencias configuracion',
      run: () => ui.openSettings(true)
    })

    list.push({
      id: 'usage',
      group: 'Ir a',
      label: 'Uso y gasto',
      icon: BarChart3,
      keywords: 'costo tokens consumo gastado cuanto',
      run: () => {
        try {
          localStorage.setItem('settings.section', 'usage')
        } catch {
          // sin storage: se abre en la sección que estuviera
        }
        // Reabrir Ajustes para que lea la sección aunque ya estuvieran abiertos.
        ui.openSettings(false)
        setTimeout(() => ui.openSettings(true), 0)
      }
    })

    const themes: [string, string, LucideIcon][] = [
      ['system', 'Tema: sistema', Monitor],
      ['light', 'Tema: claro', Sun],
      ['dark', 'Tema: oscuro', Moon]
    ]
    for (const [value, label, icon] of themes) {
      list.push({
        id: `theme:${value}`,
        group: 'Apariencia',
        label,
        icon,
        keywords: 'tema apariencia color',
        run: () => void updateSettings({ theme: value as 'system' | 'light' | 'dark' })
      })
    }

    if (connection) {
      const recents = selectSessionsForDirectory(allSessions, connection.chatDirectory)
        .slice()
        .sort((a, b) => b.time.updated - a.time.updated)
        .slice(0, 8)
      for (const s of recents) {
        list.push({
          id: `chat:${s.id}`,
          group: 'Conversaciones recientes',
          label: s.title || 'Conversación sin título',
          icon: MessageSquare,
          keywords: 'chat conversacion reciente',
          run: () => {
            ui.setMode('chat')
            void openChatSession(s.id)
          }
        })
      }
    }
    return list
  }, [mode, connection, allSessions, updateSettings])
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <PaletteDialog />
}

function PaletteDialog(): React.JSX.Element {
  const close = useUi((s) => s.setPaletteOpen)
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Devolver el foco a donde estaba al cerrar.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const results = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean)
    if (words.length === 0) return commands
    return commands
      .map((c) => {
        const label = norm(c.label)
        const hay = `${label} ${norm(c.group)} ${norm(c.keywords ?? '')}`
        if (!words.every((w) => hay.includes(w))) return null
        return { c, score: label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2 }
      })
      .filter((x): x is { c: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command | undefined): void => {
    if (!c) return
    close(false)
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      run(results[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(false)
    }
  }

  let lastGroup = ''
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
        className="flex max-h-[min(460px,70vh)] w-[560px] max-w-full animate-pop-in flex-col overflow-hidden rounded-2xl border border-border-strong bg-elevated shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar comandos y conversaciones…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[index] ? `palette-${results[index].id}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-subtle">Sin resultados para «{query}»</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            const Icon = c.icon
            const active = i === index
            return (
              <div key={c.id}>
                {header && <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium text-subtle">{c.group}</div>}
                <button
                  type="button"
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={active}
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(c)}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] ${active ? 'bg-hover text-fg' : 'text-muted'}`}
                >
                  <Icon size={15} className={active ? 'text-accent' : 'text-subtle'} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-[11.5px] text-subtle">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-border bg-inset px-4 py-2 text-[11.5px] text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navegar
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="kbd">
              <CornerDownLeft size={10} />
            </kbd>
            ejecutar
          </span>
        </div>
      </div>
    </div>
  )
}
