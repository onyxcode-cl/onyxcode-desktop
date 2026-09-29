/**
 * Barra de navegación: ←/→, ⟳/⨯, la URL editable (resalta el host, "Escribe una URL" de
 * placeholder, indicador de conexión) y las acciones: Seleccionar elemento, Añadir al chat,
 * Abrir en ventana aparte y Abrir en el navegador del sistema.
 */
import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Lock,
  LockOpen,
  MessageSquarePlus,
  MousePointerClick,
  PictureInPicture2,
  RotateCw,
  X
} from 'lucide-react'
import type { BrowserTab } from '@shared/ipc-browser'
import { splitHostForDisplay } from './store'

function SecureIndicator({ secure }: { secure: boolean | null }): React.JSX.Element | null {
  if (secure === null) return null
  return (
    <span
      title={secure ? 'Conexión segura' : 'No es seguro'}
      className={`flex shrink-0 items-center gap-1 ${secure ? 'text-success' : 'text-warning'}`}
    >
      {secure ? <Lock size={12} /> : <LockOpen size={12} />}
    </span>
  )
}

function HighlightedUrl({ url }: { url: string }): React.JSX.Element {
  const parts = splitHostForDisplay(url)
  if (!parts) return <span className="truncate text-fg">{url}</span>
  return (
    <span className="truncate">
      <span className="text-subtle">{parts.prefix}</span>
      <span className="font-medium text-fg">{parts.host}</span>
      <span className="text-subtle">{parts.suffix}</span>
    </span>
  )
}

export function UrlBar({
  tab,
  picking,
  popoutActive,
  onNavigate,
  onHistory,
  onTogglePick,
  onAddToChat,
  onPopOut,
  onOpenExternal
}: {
  tab: BrowserTab | null
  picking: boolean
  popoutActive: boolean
  onNavigate: (raw: string) => void
  onHistory: (action: 'back' | 'forward' | 'reload' | 'stop') => void
  onTogglePick: () => void
  onAddToChat: () => void
  onPopOut: () => void
  onOpenExternal: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setEditing(null)
  }, [tab?.url, focused])

  const value = editing ?? tab?.url ?? ''
  const disabled = !tab

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <button
        type="button"
        title="Atrás"
        disabled={disabled || !tab?.canGoBack}
        onClick={() => onHistory('back')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        <ArrowLeft size={15} />
      </button>
      <button
        type="button"
        title="Adelante"
        disabled={disabled || !tab?.canGoForward}
        onClick={() => onHistory('forward')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        <ArrowRight size={15} />
      </button>
      <button
        type="button"
        title={tab?.loading ? 'Detener' : 'Recargar'}
        disabled={disabled}
        onClick={() => onHistory(tab?.loading ? 'stop' : 'reload')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        {tab?.loading ? <X size={14} /> : <RotateCw size={13} />}
      </button>
      <form
        className="mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1 focus-within:border-border-strong"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onNavigate(value)
          setEditing(null)
        }}
      >
        <SecureIndicator secure={tab?.secure ?? null} />
        {focused ? (
          <input
            autoFocus
            value={value}
            onChange={(e) => setEditing(e.target.value)}
            onFocus={(e) => {
              setFocused(true)
              e.currentTarget.select()
            }}
            onBlur={() => setFocused(false)}
            placeholder="Escribe una URL"
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(tab?.url ?? '')
              setFocused(true)
            }}
            disabled={disabled}
            className="min-w-0 flex-1 text-left text-sm outline-none disabled:opacity-50"
          >
            {tab?.url ? <HighlightedUrl url={tab.url} /> : <span className="text-subtle">Escribe una URL</span>}
          </button>
        )}
      </form>
      <button
        type="button"
        title="Seleccionar elemento"
        aria-pressed={picking}
        disabled={disabled}
        onClick={onTogglePick}
        className={`flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30 ${picking ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        <MousePointerClick size={15} />
      </button>
      <button
        type="button"
        title="Añadir al chat"
        disabled={disabled}
        onClick={onAddToChat}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        <MessageSquarePlus size={15} />
      </button>
      <button
        type="button"
        title={popoutActive ? 'Traer aquí' : 'Abrir en ventana aparte'}
        onClick={onPopOut}
        className={`flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30 ${popoutActive ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        <PictureInPicture2 size={15} />
      </button>
      <button
        type="button"
        title="Abrir en el navegador del sistema"
        disabled={disabled}
        onClick={onOpenExternal}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        <ExternalLink size={15} />
      </button>
    </div>
  )
}
