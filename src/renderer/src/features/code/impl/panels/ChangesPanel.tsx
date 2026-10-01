/**
 * Panel "Cambios": estado git del proyecto, diff por archivo, commit y ramas/worktrees.
 * Usa `window.api.code.git` (preload); si no está disponible, cae al estado de archivos de OpenCode.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t as tg, type MsgKey } from '@shared/i18n'
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
  Undo2,
  X
} from 'lucide-react'
import { IconButton } from '../../../../components/IconButton'
import { useT } from '../../../../lib/i18n'
import { errorMessage, getClient, nativeCode, requireCode } from '../client'
import { DiffView, diffStats, makePatch } from '../DiffView'
import { DiffStats } from '../ToolCard'
import { useCode } from '../store'
import { useVisibleFsVersion } from '../useVisibleFsVersion'
import { openProjectTrusted } from '../trust'
import { isImeComposing } from '../../../../lib/textarea'
import { ConfirmButton, Kbd, MOD } from '../ui'
import { confirmDialog } from '../../../../components/ConfirmDialog'
import { canDiscard, discardMessage } from '../discard-logic'

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

const KIND_META: Record<GitChangeKind, { letter: string; label: MsgKey; cls: string }> = {
  modified: { letter: 'M', label: 'code.kind.modified', cls: 'bg-warning/15 text-warning' },
  added: { letter: 'A', label: 'code.kind.added', cls: 'bg-success/15 text-success' },
  untracked: { letter: 'U', label: 'code.kind.untracked', cls: 'bg-success/15 text-success' },
  deleted: { letter: 'D', label: 'code.kind.deleted', cls: 'bg-danger/15 text-danger' },
  renamed: { letter: 'R', label: 'code.kind.renamed', cls: 'bg-accent-soft text-accent' },
  copied: { letter: 'C', label: 'code.kind.copied', cls: 'bg-accent-soft text-accent' },
  typechange: { letter: 'T', label: 'code.kind.typechange', cls: 'bg-hover text-muted' },
  conflicted: { letter: '!', label: 'code.kind.conflicted', cls: 'bg-danger text-white' },
  ignored: { letter: 'I', label: 'code.kind.ignored', cls: 'bg-hover text-subtle' }
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
      files: st.files.map((f) => ({
        path: f.path,
        origPath: f.origPath,
        kind: f.kind,
        staged: f.staged,
        unstaged: f.unstaged || f.untracked
      }))
    }
  }
  const ipcErr = new Error(tg('code.client.noNative'))
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

async function loadDiff(cwd: string, file: Pick<ChangedFile, 'path' | 'kind'>, staged: boolean): Promise<string> {
  let text = ''
  try {
    text = await requireCode().git.diff({ cwd, path: file.path, staged })
  } catch (err) {
    // Con git nativo, el fallo se muestra (no se disfraza de «Sin diferencias»); sin él se usa OpenCode.
    if (nativeCode()) throw err
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

function FileRow({
  file,
  staged,
  selected,
  onSelect,
  onDiscard
}: {
  file: ChangedFile
  staged: boolean
  selected: boolean
  onSelect: () => void
  onDiscard?: () => void
}): React.JSX.Element {
  const t = useT()
  const meta = KIND_META[file.kind] ?? KIND_META.modified
  const { dir, name } = splitPath(file.path)
  return (
    <div className={`group relative flex items-center ${selected ? 'bg-active' : 'hover:bg-hover'}`}>
      <button
        type="button"
        onClick={onSelect}
        title={`${t(meta.label)}${staged ? t('code.changes.stagedSuffix') : ''}\n${file.origPath ? `${file.origPath} → ` : ''}${file.path}`}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-[13px]"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${meta.cls}`}>
          {meta.letter}
        </span>
        <span className="min-w-0 truncate">
          <span className={file.kind === 'deleted' ? 'text-muted line-through' : 'text-fg'}>{name}</span>
          {dir && <span className="ml-1.5 text-xs text-subtle">{dir}</span>}
        </span>
      </button>
      {onDiscard && (
        <IconButton
          label={t('code.changes.discardRowLabel', { name })}
          onClick={onDiscard}
          className="mr-1 h-6 w-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Undo2 size={13} />
        </IconButton>
      )}
    </div>
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

function CommitBox({
  directory,
  stagedCount,
  total,
  onDone
}: {
  directory: string
  stagedCount: number
  total: number
  onDone: () => void
}): React.JSX.Element | null {
  const t = useT()
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
        placeholder={t('code.changes.commitMessage')}
        className="block w-full resize-none rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[13px] outline-none placeholder:text-subtle focus:border-border-strong"
      />
      {error && <div className="mt-1.5 text-xs text-danger">{error}</div>}
      <div className="mt-2 flex items-center gap-2">
        <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted" title={t('code.changes.stageAllTitle')}>
          <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} className="accent-[var(--accent)]" />
          <span className="truncate">{stagedCount > 0 ? t('code.changes.includeUnstaged') : t('code.changes.includeAll')}</span>
        </label>
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!canCommit}
          title={t('code.changes.commitTitle', { mod: MOD })}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
          {t('code.changes.commit')}
          {willCommit > 0 ? ` (${willCommit})` : ''}
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

function WorktreeDialog({
  directory,
  current,
  onClose
}: {
  directory: string
  current: string | null
  onClose: () => void
}): React.JSX.Element | null {
  const t = useT()
  const native = nativeCode()
  const dialogRef = useRef<HTMLDivElement>(null)
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
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
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

  const inputCls =
    'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-border-strong placeholder:text-subtle'
  const others = worktrees.filter((w) => !w.bare)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wt-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <GitBranchPlus size={16} className="text-accent" />
          <h2 id="wt-title" className="text-sm font-semibold">
            {t('code.wt.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('code.wt.close')}
            className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted">{t('code.wt.desc')}</p>
          <div>
            <label htmlFor="wt-branch" className="mb-1 block text-xs font-medium text-muted">
              {t('code.wt.branchName')}
            </label>
            <input
              id="wt-branch"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || busy || isImeComposing(e)) return
                void create()
              }}
              placeholder={t('code.wt.branchPlaceholder')}
              className={`${inputCls} font-mono`}
            />
            {name && !valid && <div className="mt-1 text-xs text-danger">{t('code.wt.invalid')}</div>}
            {exists && <div className="mt-1 text-xs text-muted">{t('code.wt.exists')}</div>}
          </div>
          {!exists && (
            <div>
              <label htmlFor="wt-base" className="mb-1 block text-xs font-medium text-muted">
                {t('code.wt.from')}
              </label>
              <select id="wt-base" value={base} onChange={(e) => setBase(e.target.value)} className={inputCls}>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? t('code.wt.currentSuffix') : ''}
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
                {t('code.wt.created')} <b className="font-mono">{created.branch}</b>
                <span className="block truncate font-mono text-subtle" title={created.path}>
                  {created.path}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  void openProjectTrusted(created.path)
                }}
                className="shrink-0 rounded-md bg-accent px-2 py-1 font-medium text-accent-fg hover:opacity-90"
              >
                {t('code.wt.open')}
              </button>
            </div>
          )}
          {others.length > 1 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t('code.wt.list')}</div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
                {others.map((w) => (
                  <div key={w.path} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0">
                    <FolderTree size={13} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-fg">{w.branch ?? t('code.wt.detached')}</span>
                      {w.main && <span className="ml-1.5 text-subtle">{t('code.wt.main')}</span>}
                      <span className="block truncate font-mono text-subtle" title={w.path}>
                        {w.path}
                      </span>
                    </span>
                    {w.path !== directory && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          void openProjectTrusted(w.path)
                        }}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg"
                      >
                        {t('code.wt.open')}
                      </button>
                    )}
                    {!w.main && w.path !== directory && (
                      <ConfirmButton
                        title={t('code.wt.removeTitle')}
                        body={t('code.wt.removeBody')}
                        confirmLabel={t('code.wt.remove')}
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
          >
            {t('code.wt.close')}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!valid || busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} {t('code.wt.create')}
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
  const t = useT()
  const fsVersion = useVisibleFsVersion()
  const touchFs = useCode((s) => s.touchFs)
  const native = nativeCode()
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error'; undoId?: string } | null>(null)

  const refreshGen = useRef(0)
  const refresh = useCallback(async () => {
    const gen = ++refreshGen.current
    setLoading(true)
    try {
      const next = await loadStatus(directory)
      if (gen !== refreshGen.current) return
      setStatus(next)
      setError(null)
    } catch (err) {
      if (gen === refreshGen.current) setError(errorMessage(err))
    } finally {
      if (gen === refreshGen.current) setLoading(false)
    }
  }, [directory])

  useEffect(() => {
    void refresh()
  }, [refresh, fsVersion])

  const staged = useMemo(() => status?.files.filter((f) => f.staged) ?? [], [status])
  const unstaged = useMemo(() => status?.files.filter((f) => f.unstaged || !f.staged) ?? [], [status])

  const selectedFile = status?.files.find((f) => f.path === selected?.path) ?? null
  const selStaged = selected?.staged ?? false
  // El objeto `selectedFile` cambia en cada refresh: el diff solo depende de path/kind/staged (+ fsVersion).
  const selPath = selectedFile?.path ?? null
  const selKind = selectedFile?.kind ?? null
  useEffect(() => {
    if (selPath === null || selKind === null) {
      setDiff('')
      setDiffError(null)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiffError(null)
    loadDiff(directory, { path: selPath, kind: selKind }, selStaged)
      .then((d) => !cancelled && setDiff(d))
      .catch((err: unknown) => {
        if (cancelled) return
        setDiff('')
        setDiffError(errorMessage(err))
      })
      .finally(() => !cancelled && setDiffLoading(false))
    return () => {
      cancelled = true
    }
  }, [directory, selPath, selKind, selStaged, fsVersion])

  const discard = async (file: ChangedFile): Promise<void> => {
    if (!native || !canDiscard(file)) return
    const name = splitPath(file.path).name
    const ok = await confirmDialog({
      title: t('code.changes.discardTitle', { name }),
      message: discardMessage(file),
      confirmLabel: t('code.changes.discardConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      const res = await native.git.discard(directory, [file.path])
      const parts: string[] = []
      if (res.restored.length) parts.push(t('code.changes.discardRestored', { count: res.restored.length }))
      if (res.trashed.length) parts.push(t('code.changes.discardTrashed', { count: res.trashed.length }))
      if (res.failed.length) parts.push(t('code.changes.discardFailed', { error: res.failed.map((f) => f.reason).join(' ') }))
      setNotice({ text: parts.join(' '), tone: res.failed.length ? 'error' : 'ok', undoId: res.undoId ?? undefined })
      if (selected?.path === file.path) setSelected(null)
    } catch (err) {
      setNotice({ text: t('code.changes.discardFailed', { error: errorMessage(err) }), tone: 'error' })
    }
    touchFs()
    void refresh()
  }

  const undoDiscard = async (undoId: string): Promise<void> => {
    if (!native) return
    try {
      const res = await native.git.discardUndo(directory, undoId)
      setNotice(
        res.failed.length
          ? { text: t('code.changes.discardUndoFailed', { error: res.failed.map((f) => f.reason).join(' ') }), tone: 'error' }
          : { text: t('code.changes.discardUndone'), tone: 'ok' }
      )
    } catch (err) {
      setNotice({ text: t('code.changes.discardUndoFailed', { error: errorMessage(err) }), tone: 'error' })
    }
    touchFs()
    void refresh()
  }

  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])
  const abs = selectedFile ? `${directory.replace(/[/\\]+$/, '')}/${selectedFile.path}` : ''

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <GitBranch size={22} className="text-subtle" />
        <div className="text-sm font-medium">{t('code.changes.notRepo')}</div>
        <p className="text-xs text-muted">
          {t('code.changes.initBefore')}
          <code className="rounded bg-code px-1">{'git init'}</code>
          {t('code.changes.initAfter')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <span
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 font-mono"
          title={status?.upstream ? t('code.changes.tracks', { upstream: status.upstream }) : t('code.changes.noUpstream')}
        >
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate">{status?.branch ?? '—'}</span>
          {status && status.ahead > 0 && <span className="text-subtle">↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="text-subtle">↓{status.behind}</span>}
        </span>
        <span className="ml-auto shrink-0">{status ? t('code.changes.fileCount', { count: status.files.length }) : ''}</span>
        {native && (
          <IconButton label={t('code.changes.newBranch')} onClick={() => setDialog(true)} className="h-6 w-6">
            <GitBranchPlus size={13} />
          </IconButton>
        )}
        <IconButton label={t('code.changes.refresh')} onClick={() => void refresh()} className="h-6 w-6">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </IconButton>
      </div>
      {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
      {notice && (
        <div
          role="status"
          className={`flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs ${notice.tone === 'ok' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.undoId && (
            <button
              type="button"
              onClick={() => void undoDiscard(notice.undoId!)}
              className="shrink-0 rounded-md bg-elevated px-2 py-0.5 font-medium text-fg hover:bg-hover"
            >
              {t('code.changes.discardUndo')}
            </button>
          )}
          <IconButton label={t('code.changes.discardDismiss')} onClick={() => setNotice(null)} className="h-5 w-5">
            <X size={12} />
          </IconButton>
        </div>
      )}

      {status && status.files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Check size={20} className="text-success" />
          <div className="text-sm font-medium">{t('code.changes.clean')}</div>
          <div className="text-xs text-muted">{t('code.changes.noChanges')}</div>
        </div>
      ) : (
        <>
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1">
            {staged.length > 0 && (
              <Section title={t('code.changes.staged')} count={staged.length}>
                {staged.map((f) => (
                  <FileRow
                    key={`s:${f.path}`}
                    file={f}
                    staged
                    selected={selected?.path === f.path && selected.staged}
                    onDiscard={native && canDiscard(f) ? () => void discard(f) : undefined}
                    onSelect={() => setSelected(selected?.path === f.path && selected.staged ? null : { path: f.path, staged: true })}
                  />
                ))}
              </Section>
            )}
            {unstaged.length > 0 && (
              <Section title={staged.length ? t('code.changes.unstaged') : t('code.panel.changes')} count={unstaged.length}>
                {unstaged.map((f) => (
                  <FileRow
                    key={`u:${f.path}`}
                    file={f}
                    staged={false}
                    selected={selected?.path === f.path && !selected.staged}
                    onDiscard={native && canDiscard(f) ? () => void discard(f) : undefined}
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
                      <IconButton
                        label={t('code.menu.openEditor')}
                        className="h-6 w-6"
                        onClick={() => void native.dialog.openInEditor(abs)}
                      >
                        <Code2 size={13} />
                      </IconButton>
                      <IconButton label={t('code.menu.reveal')} className="h-6 w-6" onClick={() => void native.dialog.revealInFinder(abs)}>
                        <FolderOpen size={13} />
                      </IconButton>
                      {canDiscard(selectedFile) && (
                        <IconButton
                          label={t('code.changes.discard')}
                          className="h-6 w-6 hover:text-danger"
                          onClick={() => void discard(selectedFile)}
                        >
                          <Undo2 size={13} />
                        </IconButton>
                      )}
                    </>
                  )}
                  <IconButton label={t('code.changes.closeDiff')} className="h-6 w-6" onClick={() => setSelected(null)}>
                    <X size={13} />
                  </IconButton>
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {!selectedFile && status && status.files.length > 0 && (
                <div className="px-3 py-4 text-center text-xs text-subtle">{t('code.changes.selectFile')}</div>
              )}
              {selectedFile && diffLoading && !diff && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> {t('code.changes.loadingDiff')}
                </div>
              )}
              {selectedFile && diff && <DiffView patch={diff} path={selectedFile.path} hideFileHeaders />}
              {selectedFile && diffError && !diffLoading && (
                <div className="px-3 py-3 text-xs text-danger">{t('code.changes.diffFailed', { error: diffError })}</div>
              )}
              {selectedFile && !diff && !diffLoading && !diffError && (
                <div className="px-3 py-3 text-sm text-subtle">{t('code.changes.noTextDiff')}</div>
              )}
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
