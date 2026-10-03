import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileContent, FileNode } from '@opencode-ai/sdk/v2/client'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { EditorId, EditorsList } from '@shared/ipc-code'
import { confirmDialog } from '../../../../components/ConfirmDialog'
import { IconButton } from '../../../../components/IconButton'
import { useT } from '../../../../lib/i18n'
import { isRemoteSurface } from '../../../../lib/platform'
import { Sheet } from '../../../../components/mobile/Sheet'
import { errorMessage, nativeCode, useClient, sdkData } from '../client'
import { DiffView, highlightLine, languageFor } from '../DiffView'
import { useVisibleFsVersion } from '../useVisibleFsVersion'
import { abbreviatePath, displayPath, needsMacConfirm } from '../mobile-logic'
import { SheetAction } from '../SheetAction'
import { baseOf, createParent, dirsToReload, isProtectedPath, isUnder, parentOf, stemLength } from './files-logic'
import { useProjectWatch } from './useProjectWatch'

type Listing = Record<string, FileNode[] | 'loading' | { error: string }>

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) =>
    a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })
  )
}

function FileViewer({ directory, path, onClose }: { directory: string; path: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const client = useClient()
  const fsVersion = useVisibleFsVersion()
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const mobile = isRemoteSurface()

  useEffect(() => {
    if (!client) return
    let cancelled = false
    client.file
      .read({ directory, path })
      .then((res) => {
        if (cancelled) return
        setContent(sdkData(res))
        setError(null)
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [client, directory, path, fsVersion])

  const lines = useMemo(() => {
    if (content?.type !== 'text') return []
    const raw = content.content.split('\n')
    const lang = raw.length <= 5000 ? languageFor(path) : null
    return raw.map((text) => ({ text, html: highlightLine(text, lang) }))
  }, [content, path])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex items-center gap-1 border-b border-border px-2 ${mobile ? 'min-h-14' : 'py-1'}`}>
        <IconButton label={t('code.files.back')} onClick={onClose} className={mobile ? 'h-11 w-11' : 'h-6 w-6'}>
          <ArrowLeft size={mobile ? 20 : 14} />
        </IconButton>
        {mobile ? (
          <span className="min-w-0 flex-1 px-1">
            <span className="block truncate text-[15px] font-semibold">{baseOf(path)}</span>
            <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-subtle">
              <span className="min-w-0 truncate font-mono" dir="ltr">
                {abbreviatePath(displayPath(directory, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''), 26)}
              </span>
              <span className="shrink-0 rounded bg-hover px-1.5 py-px text-[10.5px] font-medium">{t('code.m.readOnly')}</span>
            </span>
          </span>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs">{path}</span>
        )}
        {content?.diff && (
          <button
            type="button"
            onClick={() => setShowDiff((d) => !d)}
            className={`ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs ${mobile ? 'min-h-11 px-4 text-[13px]' : ''} ${showDiff ? 'bg-active text-fg' : 'text-muted hover:bg-hover'}`}
          >
            {t('code.files.diff')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-code">
        {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
        {!content && !error && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> {t('code.msg.loading')}
          </div>
        )}
        {content?.type === 'binary' && <div className="px-3 py-3 text-sm text-subtle">{t('code.files.binary')}</div>}
        {content?.type === 'text' && showDiff && content.diff && <DiffView patch={content.diff} path={path} />}
        {content?.type === 'text' && !(showDiff && content.diff) && (
          <table className="w-full border-collapse font-mono text-[12px] leading-[1.55]">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="w-10 pr-3 text-right align-top text-subtle select-none">{i + 1}</td>
                  {l.html ? (
                    <td className="pr-3 whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: l.html }} />
                  ) : (
                    <td className="pr-3 whitespace-pre-wrap break-all">{l.text || ' '}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

type Editing = { mode: 'rename'; path: string } | { mode: 'create'; parent: string; kind: 'file' | 'dir' }
interface MenuState {
  x: number
  y: number
  node: FileNode | null
}
type Notice = { kind: 'ok' | 'error'; text: string }

/** Campo de edición en línea (renombrar / crear): Enter confirma, Esc cancela, el error se muestra debajo. */
function InlineName({
  initial,
  placeholder,
  depth,
  isDir,
  error,
  hint,
  onSubmit,
  onCancel
}: {
  initial: string
  placeholder: string
  depth: number
  isDir: boolean
  error: string | null
  /** Aviso bajo el campo (p. ej. «las carpetas se confirman en el Mac»). */
  hint?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, stemLength(initial))
  }, [initial])
  const finish = (fn: () => void): void => {
    if (done.current) return
    fn()
  }
  return (
    <div style={{ paddingLeft: 8 + depth * 14 }} className="py-[2px] pr-2">
      <div className="flex items-center gap-1.5">
        <span className="w-3 shrink-0" />
        {isDir ? <Folder size={14} className="shrink-0 text-accent" /> : <File size={14} className="shrink-0 text-subtle" />}
        <input
          ref={ref}
          defaultValue={initial}
          aria-label={t('code.files.nameLabel')}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="done"
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              finish(() => onSubmit(e.currentTarget.value))
            } else if (e.key === 'Escape') {
              e.preventDefault()
              done.current = true
              onCancel()
            }
          }}
          onBlur={() => finish(onCancel)}
          className={`min-w-0 flex-1 rounded border border-accent/60 bg-transparent px-1 py-px text-[13px] outline-none placeholder:text-subtle ${isRemoteSurface() ? 'min-h-11 px-2' : ''}`}
        />
      </div>
      {hint && <div className="mt-0.5 pl-[26px] text-xs text-muted">{hint}</div>}
      {error && (
        <div role="alert" className="mt-0.5 pl-[26px] text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

/** Menú contextual accesible (role=menu): flechas, Enter, Esc; se cierra al pulsar fuera. */
function ContextMenu({
  state,
  onClose,
  items
}: {
  state: MenuState
  onClose: () => void
  items: Array<{ key: string; label: string; icon: React.ReactNode; danger?: boolean; run: () => void }>
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])
  const left = Math.max(4, Math.min(state.x, window.innerWidth - 220))
  const top = Math.max(4, Math.min(state.y, window.innerHeight - 40 - items.length * 30))
  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top }}
      onKeyDown={(e) => {
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const i = btns.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          btns[(i + 1) % btns.length]?.focus()
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          btns[(i - 1 + btns.length) % btns.length]?.focus()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onClose()
        }
      }}
      className="fixed z-50 w-52 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl"
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            it.run()
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover focus:bg-hover focus:outline-none ${it.danger ? 'text-danger' : ''}`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

/** «Abrir en…»: editores detectados por main (catálogo fijo); recuerda el último elegido. */
function OpenInMenu({ directory, onNotice }: { directory: string; onNotice: (n: Notice) => void }): React.JSX.Element | null {
  const t = useT()
  // Abrir en un editor del Mac no existe en la PWA del celular (`editors:open` está prohibido para el celular).
  const native = nativeCode('dialogs')
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<EditorsList | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open || !native) return
    let cancelled = false
    native.editors
      .list(directory)
      .then((l) => !cancelled && setList(l))
      .catch((err: unknown) => {
        if (cancelled) return
        setList({ editors: [], last: null })
        onNotice({ kind: 'error', text: errorMessage(err) })
      })
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, native, directory, onNotice])
  if (!native) return null
  const ordered = list ? [...list.editors].sort((a, b) => (a.id === list.last ? -1 : b.id === list.last ? 1 : 0)) : []
  const run = (id: EditorId): void => {
    setOpen(false)
    native.editors.open(directory, id).catch((err: unknown) => onNotice({ kind: 'error', text: errorMessage(err) }))
  }
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        title={t('code.files.openIn')}
        aria-label={t('code.files.openIn')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="no-drag inline-flex h-6 shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-muted transition hover:bg-hover hover:text-fg"
      >
        <Code2 size={13} />
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl"
        >
          {!list && (
            <div className="px-3 py-2 text-xs text-subtle">
              <Loader2 size={12} className="inline animate-spin" />
            </div>
          )}
          {list && ordered.length === 0 && <div className="px-3 py-2 text-xs text-subtle">{t('code.files.openInNone')}</div>}
          {ordered.map((ed) => (
            <button
              key={ed.id}
              type="button"
              role="menuitem"
              autoFocus={ed.id === ordered[0].id}
              onClick={() => run(ed.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover focus:bg-hover focus:outline-none"
            >
              <span className="truncate">{ed.id === 'system' ? t('code.files.editor.system') : ed.label}</span>
              {ed.id === list?.last && (
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-subtle">
                  <Check size={11} /> {t('code.files.openInLast')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

export function FilesPanel({ directory }: { directory: string }): React.JSX.Element {
  const t = useT()
  const client = useClient()
  const native = nativeCode()
  const [listing, setListing] = useState<Listing>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['.']))
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Celular: filas de 48 px y un menú «⋯» por fila (hoja inferior) en lugar de los botones que salen al pasar el ratón.
  const mobile = isRemoteSurface()
  const [rowMenu, setRowMenu] = useState<FileNode | null>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const loadDir = useCallback(
    async (path: string) => {
      if (!client) return
      // Recarga silenciosa si ya había lista (sin parpadeo de «cargando»).
      setListing((l) => (Array.isArray(l[path]) ? l : { ...l, [path]: 'loading' }))
      try {
        const nodes = sdkData(await client.file.list({ directory, path }))
        setListing((l) => ({ ...l, [path]: sortNodes(nodes) }))
      } catch (err) {
        setListing((l) => ({ ...l, [path]: { error: errorMessage(err) } }))
      }
    },
    [client, directory]
  )

  useEffect(() => {
    setListing({})
    setExpanded(new Set(['.']))
    setOpenFile(null)
    setEditing(null)
    setMenu(null)
    setSelected(null)
    setNotice(null)
    void loadDir('.')
  }, [loadDir])

  // Cambios del repositorio sin actualizar a mano: eventos del sistema de archivos (main), sin polling.
  const watch = useProjectWatch(directory, {
    dirs: [...expanded],
    onChange: (ev) => {
      for (const d of dirsToReload(ev.dirs, expandedRef.current)) void loadDir(d)
    }
  })

  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

  useEffect(() => {
    const q = query.trim()
    if (!q || !client) {
      setResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      client.find
        .files({ directory, query: q, type: 'file', limit: 100 })
        .then((res) => !cancelled && setResults(res.data ?? []))
        .catch(() => !cancelled && setResults([]))
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, client, directory])

  const toggle = (node: FileNode): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.path)) next.delete(node.path)
      else {
        next.add(node.path)
        if (!listing[node.path]) void loadDir(node.path)
      }
      return next
    })
  }

  const refreshAll = (): void => {
    for (const p of expanded) void loadDir(p)
    if (watch.lost) {
      setNotice(null)
      watch.resubscribe()
    }
  }

  /** Olvida listas/abiertos de una ruta (y lo que cuelga de ella) tras renombrar o eliminar. */
  const forget = (path: string): void => {
    setExpanded((prev) => new Set([...prev].filter((p) => !isUnder(p, path))))
    setListing((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !isUnder(k, path))))
  }

  const startCreate = (parent: string, kind: 'file' | 'dir'): void => {
    setMenu(null)
    setEditError(null)
    setNotice(null)
    if (parent !== '.' || !expanded.has('.')) {
      setExpanded((prev) => new Set(prev).add(parent))
      if (!listing[parent]) void loadDir(parent)
    }
    setEditing({ mode: 'create', parent, kind })
  }
  const startRename = (node: FileNode): void => {
    setMenu(null)
    setEditError(null)
    setNotice(null)
    setEditing({ mode: 'rename', path: node.path })
  }
  const cancelEdit = useCallback((): void => {
    setEditing(null)
    setEditError(null)
  }, [])

  const submitEdit = async (name: string): Promise<void> => {
    if (!native || !editing) return
    try {
      if (editing.mode === 'rename' && mobile && needsMacConfirm({ kind: 'files.rename', isDirectory: selected?.isDir ?? false })) {
        setNotice({ kind: 'ok', text: t('code.m.macWaiting') })
      }
      if (editing.mode === 'create') {
        const res = await native.files.create(directory, editing.parent, name, editing.kind)
        setSelected({ path: res.path, isDir: editing.kind === 'dir' })
        await loadDir(editing.parent)
      } else {
        const old = editing.path
        if (name === baseOf(old)) return cancelEdit()
        const res = await native.files.rename(directory, old, name)
        forget(old)
        setSelected({ path: res.path, isDir: selected?.isDir ?? false })
        await loadDir(parentOf(old))
        setNotice(null)
      }
      cancelEdit()
    } catch (err) {
      setNotice(null)
      setEditError(errorMessage(err))
    }
  }

  const trashNode = async (node: FileNode): Promise<void> => {
    if (!native) return
    setMenu(null)
    const isDir = node.type === 'directory'
    const ok = await confirmDialog({
      title: t('code.files.trashTitle', { name: node.name }),
      message:
        (isDir ? t('code.files.trashDirBody') : t('code.files.trashFileBody')) +
        (mobile && needsMacConfirm({ kind: 'files.trash', isDirectory: isDir }) ? `\n\n${t('code.m.macConfirm')}` : ''),
      confirmLabel: t('code.files.trash'),
      danger: true
    })
    if (!ok) return
    try {
      if (mobile && needsMacConfirm({ kind: 'files.trash', isDirectory: isDir })) setNotice({ kind: 'ok', text: t('code.m.macWaiting') })
      await native.files.trash(directory, node.path)
      forget(node.path)
      setSelected(null)
      await loadDir(parentOf(node.path))
      setNotice({ kind: 'ok', text: t('code.files.trashed', { name: node.name }) })
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) })
    }
  }

  if (openFile) return <FileViewer directory={directory} path={openFile} onClose={() => setOpenFile(null)} />

  const menuItems = (
    node: FileNode | null
  ): Array<{ key: string; label: string; icon: React.ReactNode; danger?: boolean; run: () => void }> => {
    const parent = createParent(node ? { path: node.path, isDir: node.type === 'directory' } : null)
    const items: Array<{ key: string; label: string; icon: React.ReactNode; danger?: boolean; run: () => void }> = []
    const protectedNode = node ? isProtectedPath(node.path) : false
    if (!protectedNode && !isProtectedPath(parent)) {
      items.push(
        { key: 'nf', label: t('code.files.newFileHere'), icon: <FilePlus size={14} />, run: () => startCreate(parent, 'file') },
        { key: 'nd', label: t('code.files.newFolderHere'), icon: <FolderPlus size={14} />, run: () => startCreate(parent, 'dir') }
      )
    }
    if (node && !protectedNode) {
      items.push(
        { key: 'rn', label: t('code.files.rename'), icon: <Pencil size={14} />, run: () => startRename(node) },
        { key: 'tr', label: t('code.files.trash'), icon: <Trash2 size={14} />, danger: true, run: () => void trashNode(node) }
      )
    }
    return items
  }

  const createRow = (parent: string, depth: number): React.JSX.Element | null =>
    editing?.mode === 'create' && editing.parent === parent ? (
      <InlineName
        key="__create"
        initial=""
        depth={depth}
        isDir={editing.kind === 'dir'}
        placeholder={editing.kind === 'dir' ? t('code.files.newFolderPlaceholder') : t('code.files.newFilePlaceholder')}
        error={editError}
        onSubmit={(n) => void submitEdit(n)}
        onCancel={cancelEdit}
      />
    ) : null

  const renderDir = (path: string, depth: number): React.JSX.Element | null => {
    const entry = listing[path]
    if (!entry) return createRow(path, depth)
    if (entry === 'loading')
      return (
        <>
          {createRow(path, depth)}
          <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-xs text-subtle">
            <Loader2 size={12} className="inline animate-spin" />
          </div>
        </>
      )
    if (!Array.isArray(entry))
      return (
        <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-xs text-danger">
          {entry.error}
        </div>
      )
    return (
      <>
        {createRow(path, depth)}
        {entry.map((n) => {
          const isDir = n.type === 'directory'
          const open = expanded.has(n.path)
          const renaming = editing?.mode === 'rename' && editing.path === n.path
          const canManage = !!native && !isProtectedPath(n.path)
          if (renaming)
            return (
              <div key={n.path}>
                <InlineName
                  initial={n.name}
                  depth={depth}
                  isDir={isDir}
                  placeholder={n.name}
                  error={editError}
                  hint={mobile && needsMacConfirm({ kind: 'files.rename', isDirectory: isDir }) ? t('code.m.macConfirm') : undefined}
                  onSubmit={(name) => void submitEdit(name)}
                  onCancel={cancelEdit}
                />
              </div>
            )
          return (
            <div key={n.path}>
              <div
                className={`group relative flex items-center hover:bg-hover focus-within:bg-hover ${selected?.path === n.path ? 'bg-active/60' : ''}`}
                onContextMenu={(e) => {
                  if (!native) return
                  e.preventDefault()
                  setSelected({ path: n.path, isDir })
                  setMenu({ x: e.clientX, y: e.clientY, node: n })
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelected({ path: n.path, isDir })
                    if (isDir) toggle(n)
                    else setOpenFile(n.path)
                  }}
                  onFocus={() => setSelected({ path: n.path, isDir })}
                  onKeyDown={(e) => {
                    if (!canManage) return
                    if (e.key === 'F2') {
                      e.preventDefault()
                      startRename(n)
                    } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
                      e.preventDefault()
                      void trashNode(n)
                    }
                  }}
                  style={{ paddingLeft: 8 + depth * (mobile ? 16 : 14) }}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 pr-2 text-left focus-visible:outline-none ${mobile ? 'min-h-12 text-[15px]' : 'py-[3px] text-[13px]'} ${n.ignored ? 'opacity-70' : ''}`}
                >
                  {isDir ? (
                    <ChevronRight size={12} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  {isDir ? (
                    open ? (
                      <FolderOpen size={14} className="shrink-0 text-accent" />
                    ) : (
                      <Folder size={14} className="shrink-0 text-accent" />
                    )
                  ) : (
                    <File size={14} className="shrink-0 text-subtle" />
                  )}
                  <span className="truncate">{n.name}</span>
                </button>
                {canManage && mobile && (
                  <IconButton
                    label={t('code.m.itemActions', { name: n.name })}
                    className="mr-1 h-11 w-11"
                    onClick={() => {
                      setSelected({ path: n.path, isDir })
                      setRowMenu(n)
                    }}
                  >
                    <MoreHorizontal size={19} />
                  </IconButton>
                )}
                {canManage && !mobile && (
                  <span className="absolute top-0 right-1 flex h-full items-center gap-0.5 bg-hover pl-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton label={t('code.files.renameItem', { name: n.name })} className="h-5 w-5" onClick={() => startRename(n)}>
                      <Pencil size={12} />
                    </IconButton>
                    <IconButton label={t('code.files.trashItem', { name: n.name })} className="h-5 w-5" onClick={() => void trashNode(n)}>
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                )}
              </div>
              {isDir && open && renderDir(n.path, depth + 1)}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex items-center gap-1 border-b border-border px-2 ${mobile ? 'min-h-12' : 'py-1'}`}>
        <Search size={13} className="ml-1 shrink-0 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('code.files.search')}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-subtle"
        />
        {query && (
          <IconButton label={t('code.files.clear')} onClick={() => setQuery('')} className={mobile ? 'h-11 w-11' : 'h-6 w-6'}>
            <X size={13} />
          </IconButton>
        )}
        {native && !query && (
          <>
            <IconButton
              label={t('code.files.newFile')}
              onClick={() => startCreate(createParent(selected), 'file')}
              className={mobile ? 'h-11 w-11' : 'h-6 w-6'}
            >
              <FilePlus size={13} />
            </IconButton>
            <IconButton
              label={t('code.files.newFolder')}
              onClick={() => startCreate(createParent(selected), 'dir')}
              className={mobile ? 'h-11 w-11' : 'h-6 w-6'}
            >
              <FolderPlus size={13} />
            </IconButton>
          </>
        )}
        <IconButton label={t('code.changes.refresh')} onClick={refreshAll} className={mobile ? 'h-11 w-11' : 'h-6 w-6'}>
          <RefreshCw size={13} />
        </IconButton>
        <OpenInMenu directory={directory} onNotice={setNotice} />
      </div>
      {(notice || watch.lost) && (
        <div
          role={notice?.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 border-b border-border px-3 py-1.5 text-xs ${notice?.kind === 'error' ? 'text-danger' : 'text-muted'}`}
        >
          <span className="min-w-0 flex-1">{notice ? notice.text : t('code.files.watchLost')}</span>
          {notice && (
            <button
              type="button"
              aria-label={t('code.files.clear')}
              onClick={() => setNotice(null)}
              className="shrink-0 text-subtle hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(e) => {
          if (!native || results || e.defaultPrevented) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
      >
        {results ? (
          results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-subtle">{t('code.sessions.noResults')}</div>
          ) : (
            results.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setOpenFile(p)}
                className={`flex w-full items-center gap-1.5 px-3 text-left hover:bg-hover ${mobile ? 'min-h-12 text-[15px]' : 'py-[3px] text-[13px]'}`}
              >
                <File size={14} className="shrink-0 text-subtle" />
                <span className="truncate">{p}</span>
              </button>
            ))
          )
        ) : (
          renderDir('.', 0)
        )}
      </div>
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} items={menuItems(menu.node)} />}
      {mobile && (
        <Sheet open={!!rowMenu} onClose={() => setRowMenu(null)} title={rowMenu?.name ?? ''} size="half">
          {rowMenu &&
            menuItems(rowMenu).map((it) => (
              <SheetAction
                key={it.key}
                icon={it.icon}
                label={it.label}
                danger={it.danger}
                onClick={() => {
                  setRowMenu(null)
                  it.run()
                }}
              />
            ))}
          {rowMenu?.type === 'directory' && <p className="px-4 py-3 text-xs text-subtle">{t('code.m.folderMac')}</p>}
        </Sheet>
      )}
    </div>
  )
}
