/** Tira de pestañas del navegador integrado: título de la página, ✕ para cerrar y "+" para abrir otra. */
import { Bot, Plus, X } from 'lucide-react'
import type { BrowserTab } from '@shared/ipc-browser'

export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew
}: {
  tabs: BrowserTab[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              className={`group flex h-7 max-w-48 min-w-24 shrink-0 cursor-default items-center gap-1.5 rounded-md px-2 text-xs transition ${
                active ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {tab.openedBy === 'agent' && <Bot size={11} className="shrink-0 text-accent" />}
              <span className="min-w-0 flex-1 truncate">{tab.title || tab.url || 'Nueva pestaña'}</span>
              <button
                type="button"
                title="Cerrar pestaña"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        title="Nueva pestaña"
        onClick={onNew}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
