import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isSubmitKey } from '../../lib/textarea'
import { confirmDialog } from '../../components/ConfirmDialog'
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from '../../components/PortalMenu'
import { StateDot, useSidebarTree } from '../../components/SidebarTree'
import { timeAgo } from '../code/impl/ui'

/**
 * Fila de conversación de la barra lateral de escritorio (árbol): igual que la de Overdrive y la de Code. Dos líneas (título y, debajo, el
 * estado: «Trabajando» en azul si responde, «Terminado · hace 5 min» si no), punto de estado de 7 px, y al pasar el ratón solo una
 * papelera (siempre con confirmación) y los tres puntos, cuyo menú sale en un portal de posición fija.
 */
export function ChatSidebarRow({
  session,
  active,
  busy,
  onSelect,
  onRename,
  onDelete
}: {
  session: Session
  active: boolean
  busy: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const tree = useSidebarTree()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenu(false), [])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const title = session.title || t('chat.list.untitled')
  const state = busy ? 'working' : null

  const commit = (): void => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== session.title) onRename(next)
  }

  // Nunca se borra con un gesto: la papelera y el menú pasan por la misma confirmación.
  const askDelete = (): void => {
    void confirmDialog({
      title: t('chat.list.deleteTitle'),
      message: t('chat.list.deleteMessage', { title }),
      confirmLabel: t('chat.list.delete'),
      danger: true
    }).then((ok) => {
      if (ok) onDelete()
    })
  }

  if (editing) {
    return (
      <div className="flex min-h-[42px] items-center gap-1 rounded-ctl bg-elevated px-2 py-1 ring-2 ring-accent/40">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e, { allowShift: true })) commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="no-drag min-w-0 flex-1 bg-transparent text-ui outline-none"
        />
        <Check size={14} className="text-muted" />
      </div>
    )
  }

  const ariaTitle = tree?.stateAria(title, state) ?? title
  const optionsLabel = t('chat.list.optionsFor', { name: title })
  return (
    <div
      className={`group relative flex min-h-[42px] items-center gap-2 rounded-ctl px-2 py-1.5 text-ui ${active ? 'bg-active text-fg' : 'hover:bg-hover'} ${menu ? 'bg-hover' : ''}`}
      role={tree ? 'treeitem' : undefined}
      aria-level={tree ? 1 : undefined}
      aria-label={tree ? ariaTitle : undefined}
      aria-current={active && tree ? 'page' : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      {state && <StateDot state={state} />}
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          setDraft(session.title)
          setEditing(true)
        }}
        data-tree-primary={tree ? '' : undefined}
        className="no-drag min-w-0 flex-1 text-left"
      >
        <div className={`truncate ${active ? 'text-fg' : 'text-muted'}`}>{title}</div>
        <div data-testid="chat-row-meta" className={`mt-0.5 truncate text-meta ${busy ? 'text-accent' : 'text-subtle'}`}>
          {busy ? t('app.sidebar.working') : `${t('tasks.status.done')} · ${timeAgo(session.time.updated)}`}
        </div>
      </button>
      <div
        ref={actionsRef}
        className={`relative shrink-0 items-center ${menu || active ? 'flex' : 'hidden group-focus-within:flex group-hover:flex'}`}
      >
        <button
          type="button"
          title={t('chat.list.delete')}
          aria-label={t('chat.list.delete')}
          onClick={askDelete}
          className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-danger"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={optionsLabel}
          aria-label={optionsLabel}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((o) => !o)}
          className="no-drag flex size-6 items-center justify-center rounded-ctl-sm text-muted hover:bg-active hover:text-fg"
        >
          <MoreHorizontal size={14} strokeWidth={1.75} />
        </button>
        <PortalMenu open={menu} anchor={actionsRef} onClose={closeMenu} label={optionsLabel}>
          <PortalMenuItem
            icon={<Pencil size={14} strokeWidth={1.75} />}
            label={t('chat.list.rename')}
            onClick={() => {
              setMenu(false)
              setDraft(session.title)
              setEditing(true)
            }}
          />
          <PortalMenuSeparator />
          <PortalMenuItem
            danger
            icon={<Trash2 size={14} strokeWidth={1.75} />}
            label={t('chat.list.delete')}
            onClick={() => {
              setMenu(false)
              askDelete()
            }}
          />
        </PortalMenu>
      </div>
    </div>
  )
}
