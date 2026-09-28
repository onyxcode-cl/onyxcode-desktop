/**
 * Panel "Cambios": estado git del proyecto, diff por archivo, commit y ramas/worktrees.
 * Usa `window.api.code.git` (preload) si está disponible; si no, cae a los canales IPC
 * genéricos y, en último caso, al estado de archivos de OpenCode.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitBranch as GitBranchInfo, GitChangeKind, GitWorktreeDetailed } from '@shared/ipc-code'
import {
  Check,
  ChevronRight,
  Code2,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import { IconButton } from '../../../../components/IconButton'
import { errorMessage, getClient, getCodeApi, nativeCode } from '../client'
import { DiffView, diffStats, makePatch } from '../DiffView'
import { DiffStats } from '../ToolCard'
import { useCode } from '../store'
import { ConfirmButton, Kbd, MOD } from '../ui'

interface ChangedFile {
  path: string
  origPath?: string
  kind: GitChangeKind
  staged: boolean
  unstaged: boolean
}

interface StatusInfo {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: ChangedFile[]
}

const KIND_META: Record<GitChangeKind, { letter: string; label: string; cls: string }> = {
  modified: { letter: 'M', label: 'Modificado', cls: 'bg-warning/15 text-warning' },
  added: { letter: 'A', label: 'Añadido', cls: 'bg-success/15 text-success' },
  untracked: { letter: 'U', label: 'Sin seguimiento', cls: 'bg-success/15 text-success' },
  deleted: { letter: 'D', label: 'Eliminado', cls: 'bg-danger/15 text-danger' },
  renamed: { letter: 'R', label: 'Renombrado', cls: 'bg-accent-soft text-accent' },
  copied: { letter: 'C', label: 'Copiado', cls: 'bg-accent-soft text-accent' },
  typechange: { letter: 'T', label: 'Cambio de tipo', cls: 'bg-hover text-muted' },
  conflicted: { letter: '!', label: 'En conflicto', cls: 'bg-danger text-white' },
  ignored: { letter: 'I', label: 'Ignorado', cls: 'bg-hover text-subtle' }
}

function kindFromCode(code: string): GitChangeKind {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '?':
      return 'untracked'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

async function loadStatus(cwd: string): Promise<StatusInfo> {
  const native = nativeCode()
  if (native) {
    const st = await native.git.status(cwd)
    return {
      isRepo: st.isRepo,
      branch: st.detached ? `HEAD ${st.head?.slice(0, 7) ?? ''}` : st.branch,
      upstream: st.upstream,
      ahead: st.ahead,
      behind: st.behind,
      files: st.files.map((f) => ({ path: f.path, origPath: f.origPath, kind: f.kind, staged: f.staged, unstaged: f.unstaged || f.untracked }))
    }
  }
  try {
    const st = await getCodeApi().gitStatus(cwd)
    return {
      isRepo: true,
      branch: st.branch,
      upstream: null,
      ahead: st.ahead,
      behind: st.behind,
      files: st.files.map((f) => {
        const idx = f.index.trim()
        const wd = f.workingDir.trim()
        const code = idx === '?' || wd === '?' ? '?' : wd || idx || 'M'
        const staged = !!idx && idx !== '?'
        return { path: f.path, kind: kindFromCode(code), staged, unstaged: !!wd || code === '?' }
      })
    }
  } catch (ipcErr) {
    // Alternativa: estado vía OpenCode (`GET /file/status`).
    const client = getClient()
    if (!client) throw ipcErr
    const res = await client.file.status({ directory: cwd })
    if (res.error || !res.data) throw ipcErr
    return {
      isRepo: true,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: res.data.map((f) => ({
        path: f.path,
        kind: f.status === 'added' ? 'added' : f.status === 'deleted' ? 'deleted' : 'modified',
        staged: false,
        unstaged: true
      }))
    }
  }
}

async function loadDiff(cwd: string, file: ChangedFile, staged: boolean): Promise<string> {
  let text = ''
  try {
    text = await getCodeApi().gitDiff({ cwd, path: file.path, staged })
  } catch {
    // se intentará con OpenCode
  }
  if (text.trim()) return text
  const client = getClient()
  if (!client) return text
  const res = await client.file.read({ directory: cwd, path: file.path })
  if (res.data?.diff) return res.data.diff
  // Archivo nuevo sin seguimiento: se muestra todo como añadido.
  if ((file.kind === 'untracked' || file.kind === 'added') && res.data?.type === 'text') return makePatch(file.path, '', res.data.content)
  return text
}

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

interface Selection {
  path: string
  staged: boolean
}

function FileRow({ file, staged, selected, onSelect }: { file: ChangedFile; staged: boolean; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const meta = KIND_META[file.kind] ?? KIND_META.modified
  const { dir, name } = splitPath(file.path)
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${meta.label}${staged ? ' · preparado' : ''}\n${file.origPath ? `${file.origPath} → ` : ''}${file.path}`}
      className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] ${selected ? 'bg-active' : 'hover:bg-hover'}`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${meta.cls}`}>{meta.letter}</span>
      <span className="min-w-0 truncate">
        <span className={file.kind === 'deleted' ? 'text-muted line-through' : 'text-fg'}>{name}</span>
        {dir && <span className="ml-1.5 text-xs text-subtle">{dir}</span>}
      </span>
    </button>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wide text-subtle uppercase hover:text-muted"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        <span className="ml-1 rounded-full bg-hover px-1.5 text-[10px] font-medium normal-case">{count}</span>
      </button>
      {open && children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function CommitBox({ directory, stagedCount, total, onDone }: { directory: string; stagedCount: number; total: number; onDone: () => void }): React.JSX.Element | null {
  const native = nativeCode()
  const [message, setMessage] = useState('')
  const [stageAll, setStageAll] = useState(stagedCount === 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (stagedCount === 0) setStageAll(true)
  }, [stagedCount])

  if (!native) return null
  const willCommit = stageAll ? total : stagedCount
  const canCommit = !!message.trim() && willCommit > 0 && !busy

  const commit = async (): Promise<void> => {
    if (!canCommit) return
    setBusy(true)
    setError(null)
    try {
      const res = await native.git.commit(directory, message.trim(), stageAll)
      setDone(`${res.shortHash} · ${res.summary}`)
      setMessage('')
      onDone()
      setTimeout(() => setDone(null), 5000)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-sidebar/40 p-2.5">
      {done && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs text-success">
          <Check size={13} className="shrink-0" /> <span className="truncate font-mono">{done}</span>
        </div>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void commit()
          }
        }}
        rows={2}
        placeholder="Mensaje del commit"
        className="block w-full resize-none rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[13px] outline-none placeholder:text-subtle focus:border-border-strong"
      />
      {error && <div className="mt-1.5 text-xs text-danger">{error}</div>}
      <div className="mt-2 flex items-center gap-2">
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted" title="git add -A antes de hacer commit">
          <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} className="accent-[var(--accent)]" />
          <span className="truncate">{stagedCount > 0 ? 'Incluir también los no preparados' : 'Incluir todos los cambios'}</span>
        </label>
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!canCommit}
          title={`Commit (${MOD}↵)`}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
          Commit{willCommit > 0 ? ` (${willCommit})` : ''}
        </button>
      </div>
      <div className="mt-1 text-right text-[10px] text-subtle">
        <Kbd>{MOD}↵</Kbd>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ramas / worktrees
// ---------------------------------------------------------------------------

function WorktreeDialog({ directory, current, onClose }: { directory: string; current: string | null; onClose: () => void }): React.JSX.Element | null {
  const native = nativeCode()
  const openProject = useCode((s) => s.openProject)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [worktrees, setWorktrees] = useState<GitWorktreeDetailed[]>([])
  const [name, setName] = useState('')
  const [base, setBase] = useState<string>(current ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ path: string; branch: string } | null>(null)

  const reload = useCallback(async () => {
    if (!native) return
    const [b, w] = await Promise.all([native.git.branches(directory).catch(() => []), native.git.worktrees(directory).catch(() => [])])
    setBranches(b)
    setWorktrees(w)
    setBase((prev) => prev || b.find((x) => x.current)?.name || '')
  }, [native, directory])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!native) return null
  const valid = /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.endsWith('/') && !name.includes('..')
  const exists = branches.some((b) => b.name === name)

  const create = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const res = await native.git.createWorktree(directory, name, exists ? undefined : base || undefined)
      setCreated(res)
      setName('')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-border-strong placeholder:text-subtle'
  const others = worktrees.filter((w) => !w.bare)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wt-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <GitBranchPlus size={16} className="text-accent" />
          <h2 id="wt-title" className="text-sm font-semibold">
            Nueva rama en un worktree
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted">
            Un worktree es una copia de trabajo aparte con su propia rama: el agente puede trabajar ahí sin tocar tu carpeta actual.
          </p>
          <div>
            <label htmlFor="wt-branch" className="mb-1 block text-xs font-medium text-muted">
              Nombre de la rama
            </label>
            <input
              id="wt-branch"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="feature/mi-cambio"
              className={`${inputCls} font-mono`}
            />
            {name && !valid && <div className="mt-1 text-xs text-danger">Nombre de rama no válido.</div>}
            {exists && <div className="mt-1 text-xs text-muted">La rama ya existe: se hará checkout en el worktree.</div>}
          </div>
          {!exists && (
            <div>
              <label htmlFor="wt-base" className="mb-1 block text-xs font-medium text-muted">
                Desde
              </label>
              <select id="wt-base" value={base} onChange={(e) => setBase(e.target.value)} className={inputCls}>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? ' (actual)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <div className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{error}</div>}
          {created && (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-2.5 py-2 text-xs">
              <Check size={14} className="shrink-0 text-success" />
              <span className="min-w-0 flex-1">
                Creado <b className="font-mono">{created.branch}</b>
                <span className="block truncate font-mono text-subtle" title={created.path}>
                  {created.path}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  void openProject(created.path)
                }}
                className="shrink-0 rounded-md bg-accent px-2 py-1 font-medium text-accent-fg hover:opacity-90"
              >
                Abrir
              </button>
            </div>
          )}
          {others.length > 1 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Worktrees</div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
                {others.map((w) => (
                  <div key={w.path} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0">
                    <FolderTree size={13} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-fg">{w.branch ?? '(separado)'}</span>
                      {w.main && <span className="ml-1.5 text-subtle">principal</span>}
                      <span className="block truncate font-mono text-subtle" title={w.path}>
                        {w.path}
                      </span>
                    </span>
                    {w.path !== directory && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          void openProject(w.path)
                        }}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg"
                      >
                        Abrir
                      </button>
                    )}
                    {!w.main && w.path !== directory && (
                      <ConfirmButton
                        title="¿Eliminar este worktree?"
                        body="Se borrará la carpeta del worktree (la rama se conserva). Falla si tiene cambios sin commitear."
                        confirmLabel="Eliminar"
                        danger
                        onConfirm={async () => {
                          try {
                            await native.git.removeWorktree(directory, w.path)
                            await reload()
                          } catch (err) {
                            setError(errorMessage(err))
                          }
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </ConfirmButton>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!valid || busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Crear worktree
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ChangesPanel({ directory }: { directory: string }): React.JSX.Element {
  const fsVersion = useCode((s) => s.fsVersion)
  const touchFs = useCode((s) => s.touchFs)
  const native = nativeCode()
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [dialog, setDialog] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await loadStatus(directory))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [directory])

  useEffect(() => {
    void refresh()
  }, [refresh, fsVersion])

  const staged = useMemo(() => status?.files.filter((f) => f.staged) ?? [], [status])
  const unstaged = useMemo(() => status?.files.filter((f) => f.unstaged || !f.staged) ?? [], [status])

  const selectedFile = status?.files.find((f) => f.path === selected?.path) ?? null
  const selStaged = selected?.staged ?? false
  useEffect(() => {
    if (!selectedFile) {
      setDiff('')
      return
    }
    let cancelled = false
    setDiffLoading(true)
    loadDiff(directory, selectedFile, selStaged)
      .then((d) => !cancelled && setDiff(d))
      .catch((err: unknown) => !cancelled && setDiff(`Error: ${errorMessage(err)}`))
      .finally(() => !cancelled && setDiffLoading(false))
    return () => {
      cancelled = true
    }
  }, [directory, selectedFile, selStaged])

  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])
  const abs = selectedFile ? `${directory.replace(/[/\\]+$/, '')}/${selectedFile.path}` : ''

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <GitBranch size={22} className="text-subtle" />
        <div className="text-sm font-medium">Esta carpeta no es un repositorio git</div>
        <p className="text-xs text-muted">Ejecuta <code className="rounded bg-code px-1">git init</code> en la terminal para seguir los cambios del agente.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 font-mono" title={status?.upstream ? `Sigue a ${status.upstream}` : 'Sin upstream'}>
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate">{status?.branch ?? '—'}</span>
          {status && status.ahead > 0 && <span className="text-subtle">↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="text-subtle">↓{status.behind}</span>}
        </span>
        <span className="ml-auto shrink-0">{status ? (status.files.length === 1 ? '1 archivo' : `${status.files.length} archivos`) : ''}</span>
        {native && (
          <IconButton label="Nueva rama / worktree" onClick={() => setDialog(true)} className="h-6 w-6">
            <GitBranchPlus size={13} />
          </IconButton>
        )}
        <IconButton label="Actualizar" onClick={() => void refresh()} className="h-6 w-6">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </IconButton>
      </div>
      {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}

      {status && status.files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Check size={20} className="text-success" />
          <div className="text-sm font-medium">Todo limpio</div>
          <div className="text-xs text-muted">No hay cambios sin commitear.</div>
        </div>
      ) : (
        <>
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1">
            {staged.length > 0 && (
              <Section title="Preparados" count={staged.length}>
                {staged.map((f) => (
                  <FileRow
                    key={`s:${f.path}`}
                    file={f}
                    staged
                    selected={selected?.path === f.path && selected.staged}
                    onSelect={() => setSelected(selected?.path === f.path && selected.staged ? null : { path: f.path, staged: true })}
                  />
                ))}
              </Section>
            )}
            {unstaged.length > 0 && (
              <Section title={staged.length ? 'Sin preparar' : 'Cambios'} count={unstaged.length}>
                {unstaged.map((f) => (
                  <FileRow
                    key={`u:${f.path}`}
                    file={f}
                    staged={false}
                    selected={selected?.path === f.path && !selected.staged}
                    onSelect={() => setSelected(selected?.path === f.path && !selected.staged ? null : { path: f.path, staged: false })}
                  />
                ))}
              </Section>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedFile && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
                <span className="min-w-0 truncate font-mono text-xs text-fg" title={selectedFile.path}>
                  {selectedFile.path}
                </span>
                {stats && <DiffStats {...stats} />}
                <span className="ml-auto flex shrink-0 items-center">
                  {native && (
                    <>
                      <IconButton label="Abrir en el editor" className="h-6 w-6" onClick={() => void native.dialog.openInEditor(abs)}>
                        <Code2 size={13} />
                      </IconButton>
                      <IconButton label="Mostrar en Finder" className="h-6 w-6" onClick={() => void native.dialog.revealInFinder(abs)}>
                        <FolderOpen size={13} />
                      </IconButton>
                    </>
                  )}
                  <IconButton label="Cerrar diff" className="h-6 w-6" onClick={() => setSelected(null)}>
                    <X size={13} />
                  </IconButton>
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {!selectedFile && status && status.files.length > 0 && (
                <div className="px-3 py-4 text-center text-xs text-subtle">Selecciona un archivo para ver sus cambios.</div>
              )}
              {selectedFile && diffLoading && !diff && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> Cargando diff…
                </div>
              )}
              {selectedFile && diff && <DiffView patch={diff} path={selectedFile.path} hideFileHeaders />}
              {selectedFile && !diff && !diffLoading && <div className="px-3 py-3 text-sm text-subtle">Sin diferencias de texto.</div>}
            </div>
          </div>
          {status && (
            <CommitBox
              key={directory}
              directory={directory}
              stagedCount={staged.length}
              total={status.files.length}
              onDone={() => {
                setSelected(null)
                touchFs()
              }}
            />
          )}
        </>
      )}
      {dialog && <WorktreeDialog directory={directory} current={status?.branch ?? null} onClose={() => setDialog(false)} />}
    </div>
  )
}
