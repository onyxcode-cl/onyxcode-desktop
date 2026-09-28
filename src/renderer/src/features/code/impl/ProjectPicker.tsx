import { useEffect, useState } from 'react'
import { Clock, FolderCode, FolderOpen, GitBranch, Plus, Search, X } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useSettings } from '../../../stores/settings'
import { errorMessage, getCodeApi, nativeCode, useClient } from './client'
import { useCode } from './store'
import { timeAgo } from './ui'

export function baseName(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

/** Abre el diálogo nativo y, si se elige, abre el proyecto. */
export async function pickAndOpenFolder(): Promise<void> {
  const { openProject, directory, setGlobalError } = useCode.getState()
  try {
    const dir = await getCodeApi().openFolder({ title: 'Abrir carpeta de proyecto', defaultPath: directory ?? undefined })
    if (dir) await openProject(dir)
  } catch (err) {
    setGlobalError(errorMessage(err))
  }
}

interface ProjectMeta {
  branch: string | null
  isRepo: boolean
  lastActivity: number | null
  lastTitle: string | null
  missing?: boolean
}

/** Rama git y última actividad (sesión OpenCode más reciente o último commit). */
function useProjectMeta(dir: string): ProjectMeta | null {
  const client = useClient()
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  useEffect(() => {
    let cancelled = false
    const native = nativeCode()
    void (async () => {
      const [branch, sessions, log] = await Promise.all([
        native ? native.git.currentBranch(dir).catch(() => undefined) : Promise.resolve(undefined),
        client ? client.session.list({ directory: dir, roots: true, limit: 5 }).catch(() => null) : Promise.resolve(null),
        native ? native.git.log(dir, 1).catch(() => []) : Promise.resolve([])
      ])
      const latest = (sessions?.data ?? []).reduce<{ updated: number; title: string } | null>(
        (acc, x) => (!acc || x.time.updated > acc.updated ? { updated: x.time.updated, title: x.title } : acc),
        null
      )
      const commitDate = log[0]?.date ?? null
      const lastActivity = Math.max(latest?.updated ?? 0, commitDate ?? 0) || null
      if (!cancelled)
        setMeta({
          branch: branch ?? null,
          isRepo: branch !== undefined && (branch !== null || log.length > 0),
          lastActivity,
          lastTitle: latest && latest.updated >= (commitDate ?? 0) ? latest.title : (log[0]?.subject ?? null)
        })
    })()
    return () => {
      cancelled = true
    }
  }, [dir, client])
  return meta
}

function ProjectCard({ dir, onOpen, onRemove }: { dir: string; onOpen: () => void; onRemove: () => void }): React.JSX.Element {
  const meta = useProjectMeta(dir)
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-elevated p-3.5 text-left transition hover:-translate-y-px hover:border-border-strong hover:shadow-md"
      >
        <div className="flex w-full items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent uppercase">
            {baseName(dir).replace(/^[._-]+/, '').charAt(0) || '·'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{baseName(dir)}</div>
            <div className="truncate font-mono text-[11px] text-subtle" title={dir}>
              {tildify(dir)}
            </div>
          </div>
        </div>
        {meta?.lastTitle && <div className="line-clamp-1 text-xs text-muted">{meta.lastTitle}</div>}
        <div className="mt-auto flex items-center gap-2 text-[11px] text-subtle">
          {meta === null ? (
            <span className="h-3 w-24 animate-pulse rounded bg-hover" />
          ) : (
            <>
              {meta.branch ? (
                <span className="flex min-w-0 items-center gap-1 rounded-full border border-border px-1.5 py-px font-mono">
                  <GitBranch size={11} className="shrink-0" />
                  <span className="truncate">{meta.branch}</span>
                </span>
              ) : (
                <span className="rounded-full border border-dashed border-border px-1.5 py-px">{meta.isRepo ? 'HEAD separado' : 'sin git'}</span>
              )}
              {meta.lastActivity && (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Clock size={11} /> {timeAgo(meta.lastActivity)}
                </span>
              )}
            </>
          )}
        </div>
      </button>
      <button
        type="button"
        title="Quitar de recientes"
        aria-label="Quitar de recientes"
        onClick={onRemove}
        className="absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-md text-subtle group-hover:flex hover:bg-hover hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function ProjectPicker(): React.JSX.Element {
  const recent = useSettings((s) => s.settings.recentFolders)
  const update = useSettings((s) => s.update)
  const openProject = useCode((s) => s.openProject)
  const globalError = useCode((s) => s.globalError)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const open = (): void => {
    setBusy(true)
    void pickAndOpenFolder().finally(() => setBusy(false))
  }
  const list = recent.filter((d) => !query.trim() || d.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto w-full max-w-4xl px-8 pb-10">
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
            <p className="mt-1 text-sm text-muted">Elige un proyecto para trabajar con el agente sobre su código.</p>
          </div>
          <Button variant="primary" disabled={busy} onClick={open} className="shrink-0">
            <FolderOpen size={15} /> Abrir carpeta
          </Button>
        </div>
        {globalError && <div className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{globalError}</div>}

        {recent.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-14 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <FolderCode size={24} />
            </div>
            <h2 className="text-lg font-semibold">Aún no has abierto ningún proyecto</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">
              Abre la carpeta de un repositorio y el agente podrá leer el código, proponer planes, editar archivos y ejecutar comandos con tu permiso.
            </p>
            <Button variant="primary" className="mt-5" disabled={busy} onClick={open}>
              <FolderOpen size={15} /> Abrir carpeta…
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-8 mb-3 flex items-center gap-3">
              <h2 className="text-xs font-semibold tracking-wide text-subtle uppercase">Recientes</h2>
              {recent.length > 6 && (
                <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1">
                  <Search size={13} className="text-subtle" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filtrar…"
                    className="w-40 bg-transparent text-xs outline-none placeholder:text-subtle"
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((dir) => (
                <ProjectCard
                  key={dir}
                  dir={dir}
                  onOpen={() => void openProject(dir)}
                  onRemove={() => void update({ recentFolders: recent.filter((d) => d !== dir) })}
                />
              ))}
              <button
                type="button"
                onClick={open}
                disabled={busy}
                className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-sm text-muted transition hover:border-accent hover:bg-accent-soft/40 hover:text-fg"
              >
                <Plus size={18} /> Abrir otra carpeta
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
