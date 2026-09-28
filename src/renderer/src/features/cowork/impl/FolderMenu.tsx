/** Selector de carpeta de Cowork (chip del compositor o botón de la barra lateral). */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { chooseFolder, forgetFolder, selectFolder } from './actions'
import { useCowork } from './store'
import { baseName } from './util'

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
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

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
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
            Carpetas autorizadas
          </div>
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
                  title="Quitar autorización"
                  className="mr-1 hidden rounded p-1 text-subtle group-hover:block hover:text-danger"
                  onClick={() => {
                    setOpen(false)
                    if (window.confirm(`¿Quitar la autorización de Cowork para «${f.name}»? No se borra ningún archivo.`)) {
                      void forgetFolder(f.path)
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
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
