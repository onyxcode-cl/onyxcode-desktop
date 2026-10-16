/**
 * Buscador de la barra lateral de escritorio en modo Tareas: la misma caja «Buscar…» de los demás modos, pero escribe en la búsqueda
 * de la lista de tareas (títulos y contenido). Así Tareas tiene UN buscador (antes «Buscar… ⌘K» y «Buscar tareas»). La paleta sigue a
 * mano con su atajo (botón a la derecha) y desde el riel. Solo escritorio: el celular conserva la caja dentro de la lista.
 */
import { Search, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { useTasks } from './store'

export function TasksSearchBox({ openPalette, paletteHint }: { openPalette: () => void; paletteHint: string }): React.JSX.Element {
  const t = useT()
  const query = useTasks((s) => s.listQuery)
  const setQuery = (v: string): void => useTasks.setState({ listQuery: v })
  return (
    <div className="no-drag mt-0.5 mb-1.5 flex h-8 w-full min-w-0 items-center gap-2 rounded-[9px] border border-border px-2.5 text-ui text-subtle transition-colors duration-[var(--dur-fast)] focus-within:border-border-strong hover:bg-hover">
      <Search size={15} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation()
            setQuery('')
          }
        }}
        placeholder={t('app.sidebar.searchShort')}
        aria-label={t('tasks.list.search')}
        className="h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          title={t('tasks.list.clear')}
          aria-label={t('tasks.list.clearSearch')}
          onClick={() => setQuery('')}
          className="flex size-5 shrink-0 items-center justify-center rounded-ctl-sm text-subtle hover:text-fg"
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : (
        paletteHint && (
          <button
            type="button"
            title={t('app.sidebar.search')}
            aria-label={t('app.sidebar.search')}
            aria-keyshortcuts={paletteHint}
            onClick={openPalette}
            className="shrink-0 rounded-ctl-sm px-1 text-[11px] desk:text-meta leading-4 text-subtle hover:text-fg"
          >
            {paletteHint}
          </button>
        )
      )}
    </div>
  )
}
