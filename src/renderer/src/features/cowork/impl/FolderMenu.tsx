/** Selector de carpeta de Cowork (chip del compositor o botón de la barra lateral). */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FolderOpen, FolderPlus, Loader2, Lock, Trash2, X } from 'lucide-react'
import type { FolderAccessMode } from '@shared/ipc-cowork'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { chooseFolder, forgetFolder, linkFolder, selectFolder, unlinkFolder } from './actions'
import { cw } from './bridge'
import { loadFolderSet, useCowork } from './store'
import { baseName } from './util'

/** Carpeta elegida para añadir, pendiente de decidir su modo. */
interface PendingLink {
  path: string
  mode: FolderAccessMode
}

const MODE_HINT: Record<FolderAccessMode, string> = {
  rw: 'El agente puede leer y modificar sus archivos.',
  ro: 'El agente puede leerla, pero no modificarla.'
}

export function FolderMenu({
  variant = 'chip',
  placement = 'bottom',
  disabled
}: {
  variant?: 'chip' | 'block'
  placement?: 'top' | 'bottom'
  disabled?: boolean
}): React.JSX.Element {
  const folders = useCowork((s) => s.folders)
  const folder = useCowork((s) => s.folder)
  const folderSet = useCowork((s) => s.folderSet)
  const fullAccess = useCowork((s) => !!s.conn?.fullAccess)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PendingLink | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [linking, setLinking] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Carpetas adicionales de la carpeta activa: se refrescan al abrir el menú.
  useEffect(() => {
    if (open && folder) void loadFolderSet(folder)
    if (!open) {
      setPending(null)
      setLinkError(null)
    }
  }, [open, folder])
  const linked = folderSet && folderSet.primary === folder ? folderSet.linked : []

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** Elige la carpeta, la valida en main (`tasks:folders:check`) y pasa a elegir el modo de acceso. */
  const startAdd = async (): Promise<void> => {
    if (picking || linking) return
    setLinkError(null)
    setPicking(true)
    try {
      const picked = await cw('tasks:pickFolder')
      if (!picked) return
      const chk = await cw('tasks:folders:check', { path: picked })
      if (!chk.ok) {
        setLinkError(chk.reason ?? 'Esa carpeta no se puede añadir.')
        return
      }
      if (chk.normalized === folder) {
        setLinkError('Esa ya es la carpeta principal de este espacio.')
        return
      }
      if (linked.some((l) => l.path === chk.normalized)) {
        setLinkError('Esa carpeta ya está añadida.')
        return
      }
      setPending({ path: chk.normalized, mode: 'rw' })
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err))
    } finally {
      setPicking(false)
    }
  }

  const confirmAdd = async (): Promise<void> => {
    if (!pending || linking) return
    setLinking(true)
    try {
      // `linkFolder` valida de nuevo, pide confirmar si hay tareas en curso y reconecta el sandbox.
      if (await linkFolder(pending.path, pending.mode)) setPending(null)
    } finally {
      setLinking(false)
    }
  }

  const toggle = (): void => {
    if (folders.length === 0) {
      void chooseFolder()
      return
    }
    setOpen((o) => !o)
  }

  const trigger =
    variant === 'chip' ? (
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        title={folder ?? 'Elegir la carpeta en la que trabajará el agente'}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:bg-hover disabled:opacity-50 ${
          folder ? 'border-border text-fg' : 'border-accent/50 text-accent'
        }`}
      >
        {folder ? <FolderOpen size={13} className="shrink-0 text-accent" /> : <FolderPlus size={13} className="shrink-0" />}
        <span className="truncate">{folder ? baseName(folder) : 'Elegir carpeta'}</span>
        <ChevronDown size={12} className="shrink-0 text-muted" />
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        title={folder ?? undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-2 text-left text-sm hover:bg-hover"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-medium">{folder ? baseName(folder) : 'Elegir carpeta'}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
    )

  return (
    <div ref={rootRef} className="relative">
      {trigger}
      {open && (
        <div
          className={`absolute left-0 z-30 w-72 rounded-xl border border-border bg-elevated p-1 shadow-lg ${
            placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-subtle">{COWORK_TERMS.workFolders}</div>
          <div className="max-h-64 overflow-y-auto">
            {folders.map((f) => (
              <div key={f.path} className="group flex items-center rounded-lg hover:bg-hover">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  title={f.path}
                  onClick={() => {
                    setOpen(false)
                    void selectFolder(f.path)
                  }}
                >
                  <FolderOpen size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${f.path === folder ? 'font-semibold' : ''}`}>{f.name}</span>
                    <span className="block truncate font-mono text-[10px] text-subtle">{f.path}</span>
                  </span>
                  {f.path === folder && <Check size={14} className="shrink-0 text-accent" />}
                </button>
                <button
                  type="button"
                  title="Quitar de Tareas"
                  aria-label={`Quitar «${f.name}» de Tareas`}
                  className="mr-1 rounded p-1 text-subtle opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                  onClick={() => {
                    setOpen(false)
                    void confirmDialog({
                      title: '¿Quitar carpeta de trabajo?',
                      message: `«${f.name}» dejará de estar disponible en Tareas. No se borra ningún archivo.`,
                      confirmLabel: 'Quitar',
                      danger: true
                    }).then((ok) => {
                      if (ok) void forgetFolder(f.path)
                    })
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          {folder && linked.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <div className="px-2 pt-1 pb-1 text-[11.5px] font-medium text-subtle">{COWORK_TERMS.linkedFolders}</div>
              <div className="max-h-40 overflow-y-auto">
                {linked.map((l) => (
                  <div key={l.path} className="group flex items-center rounded-lg hover:bg-hover">
                    <span className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5" title={l.path}>
                      <FolderOpen size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm">{l.name}</span>
                          {l.mode === 'ro' && (
                            <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-border px-1.5 py-px text-[10px] text-muted">
                              <Lock size={9} /> {COWORK_TERMS.readOnly}
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-subtle">{l.path}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      title="Quitar carpeta adicional"
                      aria-label={`Quitar la carpeta adicional «${l.name}»`}
                      className="mr-1 rounded p-1 text-subtle opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                      onClick={() => void unlinkFolder(l.path)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {folderSet && !folderSet.applied && (
                <p className="px-2 pb-1 text-[11px] text-subtle">Los cambios se aplicarán al reiniciar el sandbox de esta carpeta.</p>
              )}
            </>
          )}
          {folder && !fullAccess && (
            <>
              <div className="my-1 border-t border-border" />
              {pending ? (
                <div className="px-2 py-1.5">
                  <div className="truncate text-sm font-medium" title={pending.path}>
                    Añadir «{baseName(pending.path)}»
                  </div>
                  <div className="truncate font-mono text-[10px] text-subtle">{pending.path}</div>
                  <div role="radiogroup" aria-label="Modo de acceso" className="mt-1.5 space-y-1">
                    {(['rw', 'ro'] as const).map((m) => (
                      <label
                        key={m}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 ${
                          pending.mode === m ? 'border-accent/60 bg-accent-soft' : 'border-border hover:bg-hover'
                        }`}
                      >
                        <input
                          type="radio"
                          name="cowork-link-mode"
                          className="mt-0.5 accent-[var(--accent)]"
                          checked={pending.mode === m}
                          onChange={() => setPending({ ...pending, mode: m })}
                        />
                        <span>
                          <span className="block text-[13px] font-medium">
                            {m === 'rw' ? COWORK_TERMS.readWrite : COWORK_TERMS.readOnly}
                          </span>
                          <span className="block text-[11px] text-muted">{MODE_HINT[m]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg"
                      onClick={() => setPending(null)}
                      disabled={linking}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[13px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                      onClick={() => void confirmAdd()}
                      disabled={linking}
                    >
                      {linking && <Loader2 size={12} className="animate-spin" />} Añadir
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover disabled:opacity-60"
                  disabled={picking}
                  onClick={() => void startAdd()}
                >
                  {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />} Añadir carpeta adicional…
                </button>
              )}
              {linkError && (
                <p role="alert" className="px-2 py-1 text-[11.5px] text-danger">
                  {linkError}
                </p>
              )}
            </>
          )}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"
            onClick={() => {
              setOpen(false)
              void chooseFolder()
            }}
          >
            <FolderPlus size={14} /> Elegir otra carpeta…
          </button>
        </div>
      )}
    </div>
  )
}
