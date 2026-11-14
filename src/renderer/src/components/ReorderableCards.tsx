import { useId, useRef, useState, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { useT } from '../lib/i18n'

export interface SummaryCard {
  id: string
  label: string
  content: ReactNode
}

interface Props {
  mode: 'code' | 'tasks'
  /** El orden de entrada es el predeterminado; los ids deben ser estables entre sesiones. */
  cards: readonly SummaryCard[]
}

const storageKey = (mode: Props['mode']): string => `lazunox.summary-order.v1.${mode}`

function readOrder(mode: Props['mode']): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(mode)) ?? 'null')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Cambiar de modo recarga su propia preferencia sin copiar el orden del modo anterior. */
export function ReorderableCards(props: Props): React.JSX.Element {
  return <CardList key={props.mode} {...props} />
}

function CardList({ mode, cards }: Props): React.JSX.Element {
  const t = useT()
  const helpId = useId()
  const [saved, setSaved] = useState(() => readOrder(mode))
  const [announcement, setAnnouncement] = useState('')
  const dragging = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const ids = cards.map((card) => card.id)
  const order = [...new Set([...saved.filter((id) => ids.includes(id)), ...ids])]
  const ordered = order.map((id) => cards.find((card) => card.id === id)!)

  const move = (id: string, target: number): void => {
    const from = order.indexOf(id)
    if (from < 0 || target < 0 || target >= order.length || target === from) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(target, 0, id)
    setSaved(next)
    try {
      localStorage.setItem(storageKey(mode), JSON.stringify(next))
    } catch {
      // Sin almacenamiento se puede ordenar durante esta sesión.
    }
    setAnnouncement(
      t('code.summary.moved', { title: cards.find((card) => card.id === id)!.label, position: target + 1, count: order.length })
    )
  }

  return (
    <div data-card-mode={mode}>
      <p id={helpId} className="sr-only">
        {t('code.summary.moveHelp')}
      </p>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      {ordered.map((card, index) => (
        <div
          key={card.id}
          data-summary-card={card.id}
          className={`rounded-xl ${dropTarget === card.id ? 'ring-1 ring-accent' : ''}`}
          onDragOver={(event) => {
            if (!dragging.current) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget(card.id)
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget
            if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDropTarget(null)
          }}
          onDrop={(event) => {
            if (!dragging.current) return
            event.preventDefault()
            move(dragging.current, index)
            dragging.current = null
            setDropTarget(null)
          }}
        >
          <div className="mx-3 flex justify-end">
            <button
              type="button"
              draggable
              aria-label={t('code.summary.move', { title: card.label })}
              aria-describedby={helpId}
              aria-keyshortcuts="ArrowUp ArrowDown Home End"
              title={t('code.summary.moveHelp')}
              className="no-drag flex h-6 w-8 cursor-grab items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
              onDragStart={(event) => {
                dragging.current = card.id
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', card.id)
              }}
              onDragEnd={() => {
                dragging.current = null
                setDropTarget(null)
              }}
              onKeyDown={(event) => {
                const target =
                  event.key === 'ArrowUp'
                    ? index - 1
                    : event.key === 'ArrowDown'
                      ? index + 1
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? order.length - 1
                          : null
                if (target === null) return
                event.preventDefault()
                move(card.id, target)
              }}
            >
              <GripVertical size={14} aria-hidden />
            </button>
          </div>
          {card.content}
        </div>
      ))}
    </div>
  )
}
