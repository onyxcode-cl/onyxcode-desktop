/**
 * Panel "Cambios": estado git del proyecto, diff por archivo, commit y ramas/worktrees.
 * Usa `window.api.code.git` (preload); si no está disponible, cae al estado de archivos de OpenCode.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t as tg, type MsgKey } from '@shared/i18n'
import { GIT_MAX_DISCARD_FILES } from '@shared/ipc-code'
import type { GitBranch as GitBranchInfo, GitChangeKind, GitDiscardResult, GitWorktreeDetailed } from '@shared/ipc-code'
import {
  Check,
  CheckCheck,
  ChevronLeft,
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
  WrapText,
  X
} from 'lucide-react'
import { IconButton } from '../../../../components/IconButton'
import { Button } from '../../../../components/Button'
import { splitPath } from '../../../../lib/paths'
import { useT } from '../../../../lib/i18n'
import { isRemoteSurface, platformCaps } from '../../../../lib/platform'
import { errorMessage, getClient, nativeCode, requireCode } from '../client'
import { DiffView, diffStats, makePatch } from '../DiffView'
import { DiffStats } from '../ToolCard'
import { useCode } from '../store'
import { sameDir } from '../open-projects'
import { useVisibleFsVersion } from '../useVisibleFsVersion'
import { openProjectTrusted } from '../trust'
import { isImeComposing } from '../../../../lib/textarea'
import { ConfirmButton, MOD } from '../ui'
import { confirmDialog } from '../../../../components/ConfirmDialog'
import { canDiscard, discardMessage, hunkLines } from '../discard-logic'
import { abbreviatePath, displayPath } from '../mobile-logic'
import { useProjectWatch } from './useProjectWatch'
import { moveSelection, nextPending, orderedRows, pickSelection, recallSelection, rememberSelection, rowKey } from './changes-select'
import { sharedFullDiff } from '../full-diff'
import { isSingleFileDiff, splitDiffHunks } from '@shared/diff-hunks'
import {
  acceptEntries,
  acceptFilesIn,
  isAccepted,
  pendingPaths,
  splitPatchByFile,
  summarySignature,
  type FileDiffInfo
} from '../review-logic'

/** Igual que la barra sobre la caja de entrada: un diff mayor que esto no se trocea (solo se pierden los +/− por fila). */
const ALL_DIFF_MAX_CHARS = 4_000_000

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
  conflicted: { letter: '!', label: 'code.kind.conflicted', cls: 'bg-danger text-danger-fg' },
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

interface Selection {
  path: string
  staged: boolean
}

function FileRow({
  file,
  directory,
  staged,
  selected,
  onSelect,
  onDiscard,
  stat,
  accepted,
  onAccept,
  onRowKeyDown
}: {
  file: ChangedFile
  directory: string
  staged: boolean
  selected: boolean
  onSelect: () => void
  onDiscard?: () => void
  /** +/− de este archivo (escritorio). */
  stat?: { additions: number; deletions: number }
  /** Ya revisado con su contenido actual. */
  accepted?: boolean
  /** Marcar como revisado (escritorio, solo con sesión activa). */
  onAccept?: () => void
  /** Teclado de la fila: ↑/↓ cambian de archivo y Enter/Espacio aceptan el seleccionado (escritorio). */
  onRowKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const t = useT()
  const meta = KIND_META[file.kind] ?? KIND_META.modified
  const { dir, name } = splitPath(file.path)
  const mobile = isRemoteSurface()
  if (mobile) {
    // Celular: fila de 56 px con el nombre y debajo la ruta abreviada con `~`; «descartar» siempre visible (44 px).
    return (
      <div className={`flex min-h-14 items-center border-b border-border ${selected ? 'bg-active' : 'active:bg-hover'}`}>
        <button
          type="button"
          onClick={onSelect}
          aria-label={`${t(meta.label)}${staged ? t('code.changes.stagedSuffix') : ''}: ${file.origPath ? `${file.origPath} → ` : ''}${file.path}`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 text-left"
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[11px] desk:text-meta font-bold ${meta.cls}`}
          >
            {meta.letter}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[15px] ${file.kind === 'deleted' ? 'text-muted line-through' : 'text-fg'}`}>{name}</span>
            <span className="block truncate font-mono text-[11.5px] desk:text-meta text-subtle" dir="ltr">
              {abbreviatePath(displayPath(directory, dir), 30)}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-subtle" />
        </button>
        {onDiscard && (
          <IconButton label={t('code.changes.discardRowLabel', { name })} onClick={onDiscard} className="mr-1 h-11 w-11">
            <Undo2 size={18} />
          </IconButton>
        )}
      </div>
    )
  }
  const hasActions = !!onDiscard || (!!onAccept && !accepted)
  return (
    <div
      className={`group relative flex items-center desk:h-8 desk:rounded-ctl desk:mx-1 ${selected ? 'bg-active desk:font-medium' : 'hover:bg-hover'}`}
    >
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={onRowKeyDown}
        data-row-key={rowKey({ path: file.path, staged })}
        aria-current={selected ? 'true' : undefined}
        title={`${t(meta.label)}${staged ? t('code.changes.stagedSuffix') : ''}\n${file.origPath ? `${file.origPath} → ` : ''}${file.path}`}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-[13px] desk:px-2"
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] desk:text-meta font-bold desk:h-[18px] desk:w-[18px] desk:rounded-2xs desk:text-[11px] desk:font-semibold ${meta.cls}`}
        >
          {meta.letter}
        </span>
        <span className={`min-w-0 truncate ${accepted ? 'opacity-60' : ''}`}>
          <span className={file.kind === 'deleted' ? 'text-muted line-through' : 'text-fg'}>{name}</span>
          {dir && <span className="ml-1.5 text-xs text-subtle">{dir}</span>}
        </span>
      </button>
      {/* Derecha: +/− (o «revisado») y, al pasar el ratón o enfocar, las acciones encima (sin reservar hueco ni salir del foco de teclado). */}
      <span className={`relative flex h-full shrink-0 items-center justify-end desk:pr-2.5 ${hasActions ? 'min-w-14' : ''}`}>
        {((stat && stat.additions + stat.deletions > 0) || accepted) && (
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] desk:text-meta tabular-nums ${hasActions ? 'group-focus-within:opacity-0 group-hover:opacity-0' : ''}`}
          >
            {/* Solo el lado que no es 0 (archivo nuevo: «+3»; binario o cambio de modo: nada). */}
            {stat && stat.additions > 0 && <span className="text-success">+{stat.additions}</span>}
            {stat && stat.deletions > 0 && <span className="text-danger">−{stat.deletions}</span>}
            {accepted && (
              <>
                <Check size={12} aria-hidden className="text-success" />
                <span className="sr-only">{t('code.changes.accepted')}</span>
              </>
            )}
          </span>
        )}
        {hasActions && (
          <span
            className={`absolute inset-y-0 right-0 flex items-center rounded-ctl opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 desk:pr-1 ${selected ? 'bg-active' : 'bg-hover'}`}
          >
            {onAccept && !accepted && (
              <IconButton label={t('code.changes.acceptRow', { name })} onClick={onAccept} className="h-6 w-6 hover:text-success">
                <Check size={13} />
              </IconButton>
            )}
            {onDiscard && (
              <IconButton label={t('code.changes.discardRowLabel', { name })} onClick={onDiscard} className="h-6 w-6 hover:text-danger">
                <Undo2 size={13} />
              </IconButton>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

function Section({
  title,
  count,
  sole = false,
  children
}: {
  title: string
  count: number
  /** Única sección (sin «preparados»): en escritorio el recuento sobra (ya lo dicen la pestaña y «N por revisar»). */
  sole?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase hover:text-muted desk:normal-case desk:tracking-normal desk:text-meta desk:font-medium desk:h-8 ${isRemoteSurface() ? 'min-h-11 px-4' : 'py-1'}`}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        <span
          className={`ml-1 rounded-full bg-hover px-1.5 text-[10px] desk:text-meta font-medium normal-case desk:bg-active desk:text-[11px]${sole ? ' desk:hidden' : ''}`}
        >
          {count}
        </span>
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
        <label
          className={`flex min-w-0 items-center gap-1.5 text-xs text-muted ${isRemoteSurface() ? 'min-h-11 text-[13px]' : ''}`}
          title={t('code.changes.stageAllTitle')}
        >
          <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} className="accent-[var(--accent)]" />
          <span className="truncate">{stagedCount > 0 ? t('code.changes.includeUnstaged') : t('code.changes.includeAll')}</span>
        </label>
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!canCommit}
          title={t('code.changes.commitTitle', { mod: MOD })}
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40 desk:h-7 desk:rounded-ctl-sm desk:text-ui desk:disabled:bg-hover desk:disabled:text-muted desk:disabled:opacity-100 ${isRemoteSurface() ? 'min-h-11 px-4 text-[14px]' : ''}`}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
          {t('code.changes.commit')}
          {willCommit > 0 ? ` (${willCommit})` : ''}
        </button>
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
              <div className="mb-1 text-[11px] desk:text-meta font-semibold tracking-wide text-subtle uppercase">{t('code.wt.list')}</div>
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
                        body={isRemoteSurface() ? `${t('code.wt.removeBody')} ${t('code.m.macConfirm')}` : t('code.wt.removeBody')}
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
  // Abrir en el editor / mostrar en Finder son del Mac: no existen en la PWA del celular.
  const dialogs = platformCaps().nativeDialogs
  // Celular: lista a pantalla completa → al tocar un archivo, su diff a pantalla completa (con «‹» para volver).
  const mobile = isRemoteSurface()
  const [wrap, setWrap] = useState(true)
  const ib = mobile ? 'h-11 w-11' : 'h-6 w-6'
  // Cambios hechos fuera de la app (editor, terminal): el vigilante sube `fsVersion` con debounce, sin polling.
  useProjectWatch(directory)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  /** Carpeta a la que corresponde `status` (al cambiar de proyecto, el anterior sigue a la vista hasta que llega el nuevo). */
  const [statusDir, setStatusDir] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Selection | null>(null)
  // El usuario cerró el diff a propósito: no se vuelve a abrir solo hasta que cambie de carpeta.
  const closedByUser = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const focusKey = useRef<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error'; undoId?: string } | null>(null)
  // Revisión («Aceptar»): estado de interfaz por sesión, no toca el disco. Solo escritorio y con una sesión activa.
  const sessionID = useCode((s) => s.activeSessionID)
  const record = useCode((s) => (sessionID ? s.reviewed[sessionID] : undefined))
  const summary = useCode((s) => (sessionID ? s.sessions[sessionID]?.summary : undefined))
  const acceptFiles = useCode((s) => s.acceptFiles)
  const acceptSession = useCode((s) => s.acceptSession)
  const sessionDir = useCode((s) => (sessionID ? s.sessionProject[sessionID] : undefined))
  const sessionBusy = useCode((s) => (sessionID ? s.runState[sessionID] === 'busy' || s.runState[sessionID] === 'retry' : false))
  const canReview = !mobile && !!sessionID
  const [infos, setInfos] = useState<Map<string, FileDiffInfo>>(() => new Map())

  const refreshGen = useRef(0)
  const refresh = useCallback(async () => {
    const gen = ++refreshGen.current
    setLoading(true)
    try {
      const next = await loadStatus(directory)
      if (gen !== refreshGen.current) return
      setStatus(next)
      setStatusDir(directory)
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

  // +/− y huella de cada archivo, de UN solo `git diff`, compartido con la barra sobre la caja de entrada (`sharedFullDiff`).
  const fileCount = status?.files.length ?? 0
  useEffect(() => {
    if (mobile || !native || fileCount === 0) {
      setInfos((prev) => (prev.size ? new Map() : prev))
      return
    }
    let cancelled = false
    void sharedFullDiff(directory, fsVersion, () => native.git.diff({ cwd: directory }))
      .then((patch) => !cancelled && setInfos(patch.length > ALL_DIFF_MAX_CHARS ? new Map() : splitPatchByFile(patch)))
      .catch(() => !cancelled && setInfos(new Map()))
    return () => {
      cancelled = true
    }
    // `native` es estable por ventana; el diff se vuelve a pedir cuando cambian los archivos.
  }, [directory, fsVersion, fileCount, mobile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sin archivos cambiados (commit por terminal, «Revertir todo», nada que mirar): la sesión activa deja de estar «por
  // revisar». Si no, el punto se quedaba para siempre, porque «Aceptar todo» solo aparece con archivos.
  const sig = summarySignature(summary)
  const cleanNow = !!status && status.isRepo && status.files.length === 0 && statusDir === directory && !error
  useEffect(() => {
    if (mobile || !sessionID || !cleanNow || sig === null || record?.sig === sig) return
    if (sessionDir && !sameDir(sessionDir, directory)) return
    acceptSession(sessionID, sig, {})
  }, [mobile, sessionID, cleanNow, sig, record?.sig, sessionDir, directory, acceptSession])

  const allPaths = useMemo(() => status?.files.map((f) => f.path) ?? [], [status])
  const pending = useMemo(() => pendingPaths(allPaths, record, infos), [allPaths, record, infos])
  const acceptable = useMemo(() => Object.keys(acceptEntries(pending, infos)).length, [pending, infos])

  /** Aceptar archivos concretos; si con eso no queda nada pendiente, la sesión entera deja de marcarse «por revisar». */
  const accept = (paths: string[]): void => {
    if (!sessionID) return
    const entries = acceptEntries(paths, infos)
    if (!Object.keys(entries).length) return
    const rest = pendingPaths(allPaths, acceptFilesIn(record, entries), infos)
    if (rest.length === 0) acceptSession(sessionID, summarySignature(summary), entries)
    else acceptFiles(sessionID, entries)
  }
  /** «Aceptar todo»: igual que aceptar cada pendiente; la sesión solo pasa a «revisada» si de verdad no queda ninguno. */
  const acceptAll = (): void => accept(pending)

  const staged = useMemo(() => status?.files.filter((f) => f.staged) ?? [], [status])
  const unstaged = useMemo(() => status?.files.filter((f) => f.unstaged || !f.staged) ?? [], [status])

  const rows = useMemo(() => orderedRows(staged, unstaged), [staged, unstaged])
  // Escritorio: al abrir «Cambios» con archivos modificados se selecciona el primero (o el que ya estaba seleccionado / el de la
  // última vez en esta carpeta, si sigue existiendo) para que el diff salga sin otro clic. El celular conserva su lista a pantalla completa.
  useEffect(() => {
    if (mobile || !status || statusDir !== directory) return
    if (closedByUser.current && selected === null) return
    const next = pickSelection(rows, selected, recallSelection(directory))
    if (next?.path !== selected?.path || next?.staged !== selected?.staged) setSelected(next)
  }, [mobile, status, statusDir, directory, rows, selected])
  useEffect(() => {
    closedByUser.current = false
  }, [directory])
  useEffect(() => {
    if (!mobile && statusDir === directory) rememberSelection(directory, selected)
  }, [mobile, statusDir, directory, selected])
  // Tras moverse con el teclado, el foco acompaña a la selección (si no, la siguiente flecha se perdería).
  useEffect(() => {
    const key = focusKey.current
    if (!key) return
    focusKey.current = null
    listRef.current?.querySelectorAll<HTMLElement>('[data-row-key]').forEach((el) => {
      if (el.dataset.rowKey === key) el.focus()
    })
  }, [selected])

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

  const discard = async (file: ChangedFile, scope: 'all' | 'unstaged' = 'all'): Promise<void> => {
    if (!native || !canDiscard(file)) return
    const name = splitPath(file.path).name
    const ok = await confirmDialog({
      title: t('code.changes.discardTitle', { name }),
      message: discardMessage(file, scope),
      confirmLabel: t('code.changes.discardConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      const res = await native.git.discard(directory, [file.path], scope)
      setNotice(discardNotice(res))
      if (selected?.path === file.path) setSelected(null)
    } catch (err) {
      setNotice({ text: t('code.changes.discardFailed', { error: errorMessage(err) }), tone: 'error' })
    }
    touchFs()
    void refresh()
  }

  const discardNotice = (res: GitDiscardResult, skipped = 0): { text: string; tone: 'ok' | 'error'; undoId?: string } => {
    const parts: string[] = []
    if (res.restored.length) parts.push(t('code.changes.discardRestored', { count: res.restored.length }))
    if (res.trashed.length) parts.push(t('code.changes.discardTrashed', { count: res.trashed.length }))
    if (res.failed.length) parts.push(t('code.changes.discardFailed', { error: res.failed.map((f) => f.reason).join(' ') }))
    if (skipped > 0) parts.push(t('code.changes.revertSkipped', { count: skipped }))
    return { text: parts.join(' '), tone: res.failed.length ? 'error' : 'ok', undoId: res.undoId ?? undefined }
  }

  /** «Revertir todo»: lo mismo que descartar cada archivo (mismo mecanismo, con «Deshacer»), en una sola confirmación. */
  const revertAll = async (): Promise<void> => {
    if (!native || !status) return
    const targets = status.files.filter(canDiscard)
    if (targets.length === 0) return
    const shown = targets.slice(0, 12).map((f) => `• ${f.path}`)
    if (targets.length > shown.length) shown.push(`• …(+${targets.length - shown.length})`)
    const ok = await confirmDialog({
      title: t('code.changes.revertAllTitle'),
      message: `${t('code.changes.revertAllBody', { count: targets.length })}\n\n${t('code.changes.discardAffects')}\n${shown.join('\n')}`,
      confirmLabel: t('code.changes.revertAll'),
      danger: true
    })
    if (!ok) return
    try {
      const res = await native.git.discard(
        directory,
        targets.map((f) => f.path),
        'all'
      )
      setNotice(discardNotice(res, status.files.length - targets.length))
      setSelected(null)
    } catch (err) {
      setNotice({ text: t('code.changes.discardFailed', { error: errorMessage(err) }), tone: 'error' })
    }
    touchFs()
    void refresh()
  }

  const discardHunk = async (file: ChangedFile, hunkIndex: number): Promise<void> => {
    if (!native) return
    const hunk = splitDiffHunks(diff).hunks[hunkIndex]
    if (!hunk) return
    const name = splitPath(file.path).name
    const ok = await confirmDialog({
      title: t('code.changes.discardHunkTitle', { name }),
      message: `${t('code.changes.discardHunkBody', { lines: hunkLines(hunk) })}\n\n${hunk.split('\n').slice(0, 14).join('\n')}`,
      confirmLabel: t('code.changes.discardConfirm'),
      danger: true
    })
    if (!ok) return
    try {
      const res = await native.git.discardHunk(directory, file.path, hunkIndex, hunk)
      setNotice({ text: t('code.changes.discardHunkDone'), tone: 'ok', undoId: res.undoId })
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

  const rowReview = (f: ChangedFile): { stat?: { additions: number; deletions: number }; accepted?: boolean; onAccept?: () => void } => {
    if (mobile) return {}
    const info = infos.get(f.path)
    return {
      stat: info ? { additions: info.additions, deletions: info.deletions } : undefined,
      accepted: canReview && isAccepted(record, f.path, info?.fingerprint),
      onAccept: canReview && info ? () => accept([f.path]) : undefined
    }
  }

  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])
  // «Revertir todo» no se ofrece mientras el agente escribe (se pisarían) ni por encima del tope de main (fallaría entero).
  const revertBlocked = sessionBusy
    ? t('code.changes.revertAllBusy')
    : (status?.files.filter(canDiscard).length ?? 0) > GIT_MAX_DISCARD_FILES
      ? t('code.changes.revertAllTooMany', { max: GIT_MAX_DISCARD_FILES })
      : null
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, f: ChangedFile, isStaged: boolean): void => {
    if (mobile || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const here = { path: f.path, staged: isStaged }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = moveSelection(rows, here, e.key === 'ArrowDown' ? 1 : -1)
      if (next) {
        focusKey.current = rowKey(next)
        closedByUser.current = false
        setSelected(next)
      }
      return
    }
    // Enter/Espacio en el archivo ya seleccionado (y aún sin revisar) lo acepta y pasa al siguiente pendiente; en otro, solo lo abre.
    if ((e.key === 'Enter' || e.key === ' ') && canReview && selected?.path === f.path && selected.staged === isStaged) {
      const info = infos.get(f.path)
      if (!info || isAccepted(record, f.path, info.fingerprint)) return
      e.preventDefault()
      accept([f.path])
      const nx = nextPending(rows, here, (p) => p !== f.path && pending.includes(p))
      if (nx) {
        focusKey.current = rowKey(nx)
        setSelected(nx)
      }
    }
  }
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
    <div className="flex h-full min-h-0 flex-col desk:@container">
      <div
        className={`flex items-center gap-2 border-b border-border px-3 text-xs text-muted ${mobile ? 'min-h-12 ' : 'py-1.5'} ${mobile && selectedFile ? 'hidden' : ''}`}
      >
        <span
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 font-mono"
          title={status?.upstream ? t('code.changes.tracks', { upstream: status.upstream }) : t('code.changes.noUpstream')}
        >
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate">{status?.branch ?? '—'}</span>
          {status && status.ahead > 0 && <span className="text-subtle">↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="text-subtle">↓{status.behind}</span>}
        </span>
        {/* En escritorio el recuento ya está en la pestaña del panel y en «N por revisar»: aquí solo empuja los botones a la derecha. */}
        <span className="ml-auto shrink-0">
          <span className="inline desk:hidden">{status ? t('code.changes.fileCount', { count: status.files.length }) : ''}</span>
        </span>
        {native && (
          <IconButton label={t('code.changes.newBranch')} onClick={() => setDialog(true)} className={ib}>
            <GitBranchPlus size={13} />
          </IconButton>
        )}
        <IconButton label={t('code.changes.refresh')} onClick={() => void refresh()} className={ib}>
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
              className={`shrink-0 rounded-md bg-elevated px-2 py-0.5 font-medium text-fg hover:bg-hover ${mobile ? 'min-h-11 px-4 text-[13px]' : ''}`}
            >
              {t('code.changes.discardUndo')}
            </button>
          )}
          <IconButton label={t('code.changes.discardDismiss')} onClick={() => setNotice(null)} className={mobile ? 'h-11 w-11' : 'h-5 w-5'}>
            <X size={12} />
          </IconButton>
        </div>
      )}

      {!mobile && native && status && status.files.length > 0 && (
        <div
          role="group"
          aria-label={t('code.changes.reviewActions')}
          className="flex shrink-0 flex-nowrap items-center gap-2 border-b border-border px-3 py-1.5"
        >
          <span className="min-w-0 flex-1 basis-24 truncate text-meta text-muted" title={t('code.changes.acceptHint')}>
            {canReview ? (pending.length > 0 ? t('code.changes.pending', { count: pending.length }) : t('code.changes.allReviewed')) : ''}
          </span>
          {canReview && (
            <Button
              size="xs"
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              // Sin diff conocido de ningún pendiente (cargando, con error o enorme) todavía no hay nada que aceptar.
              disabled={acceptable === 0}
              onClick={acceptAll}
              aria-label={t('code.changes.acceptAll')}
              title={`${t('code.changes.acceptAll')}. ${t('code.changes.acceptHint')}`}
            >
              <CheckCheck size={12} aria-hidden />
              <span className="whitespace-nowrap desk:@max-[26rem]:hidden">{t('code.changes.acceptAll')}</span>
            </Button>
          )}
          {/* Envoltorio con el tooltip: un botón desactivado no recibe el ratón y no mostraría por qué. */}
          <span className="flex shrink-0" title={revertBlocked ?? t('code.changes.revertAll')}>
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0 whitespace-nowrap hover:text-danger"
              disabled={revertBlocked !== null || !status.files.some(canDiscard)}
              onClick={() => void revertAll()}
              aria-label={t('code.changes.revertAll')}
              aria-description={revertBlocked ?? undefined}
            >
              <Undo2 size={12} aria-hidden />
              <span className="whitespace-nowrap desk:@max-[26rem]:hidden">{t('code.changes.revertAll')}</span>
            </Button>
          </span>
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
          <div className="flex min-h-0 flex-1 flex-col desk:@min-[40rem]:flex-row">
            <div
              ref={listRef}
              className={
                mobile
                  ? `min-h-0 flex-1 overflow-y-auto ${selectedFile ? 'hidden' : ''}`
                  : 'max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1 desk:@min-[40rem]:max-h-none desk:@min-[40rem]:w-52 desk:@min-[40rem]:border-b-0 desk:@min-[40rem]:border-r'
              }
            >
              {staged.length > 0 && (
                <Section title={t('code.changes.staged')} count={staged.length}>
                  {staged.map((f) => (
                    <FileRow
                      key={`s:${f.path}`}
                      file={f}
                      directory={directory}
                      staged
                      selected={selected?.path === f.path && selected.staged}
                      onDiscard={native && canDiscard(f) ? () => void discard(f, 'all') : undefined}
                      {...rowReview(f)}
                      onRowKeyDown={(e) => onRowKeyDown(e, f, true)}
                      onSelect={() => ((closedByUser.current = false), setSelected({ path: f.path, staged: true }))}
                    />
                  ))}
                </Section>
              )}
              {unstaged.length > 0 && (
                <Section
                  title={staged.length ? t('code.changes.unstaged') : t('code.panel.changes')}
                  count={unstaged.length}
                  sole={staged.length === 0}
                >
                  {unstaged.map((f) => (
                    <FileRow
                      key={`u:${f.path}`}
                      file={f}
                      directory={directory}
                      staged={false}
                      selected={selected?.path === f.path && !selected.staged}
                      onDiscard={native && canDiscard(f) ? () => void discard(f, 'unstaged') : undefined}
                      {...rowReview(f)}
                      onRowKeyDown={(e) => onRowKeyDown(e, f, false)}
                      onSelect={() => ((closedByUser.current = false), setSelected({ path: f.path, staged: false }))}
                    />
                  ))}
                </Section>
              )}
            </div>
            <div className={`flex min-h-0 flex-1 flex-col desk:min-w-0 ${mobile && !selectedFile ? 'hidden' : ''}`}>
              {selectedFile && mobile && (
                <div className="flex min-h-14 shrink-0 items-center gap-0.5 border-b border-border px-1">
                  <IconButton label={t('code.m.backToChanges')} className="h-11 w-11" onClick={() => setSelected(null)}>
                    <ChevronLeft size={22} />
                  </IconButton>
                  <span className="min-w-0 flex-1 px-1">
                    <span className="block truncate text-[15px] font-semibold">{splitPath(selectedFile.path).name}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-[11.5px] desk:text-meta text-subtle" dir="ltr">
                        {abbreviatePath(displayPath(directory, splitPath(selectedFile.path).dir), 28)}
                      </span>
                      {stats && (
                        <span className="shrink-0 whitespace-nowrap">
                          <DiffStats {...stats} />
                        </span>
                      )}
                    </span>
                  </span>
                  <IconButton
                    label={t('code.m.wrap')}
                    active={wrap}
                    aria-pressed={wrap}
                    className="h-11 w-11"
                    onClick={() => setWrap((w) => !w)}
                  >
                    <WrapText size={18} />
                  </IconButton>
                  {native && canDiscard(selectedFile) && (
                    <IconButton
                      label={t('code.changes.discard')}
                      className="h-11 w-11 hover:text-danger"
                      onClick={() => void discard(selectedFile, selStaged ? 'all' : 'unstaged')}
                    >
                      <Undo2 size={18} />
                    </IconButton>
                  )}
                </div>
              )}
              {selectedFile && !mobile && (
                // Escritorio: nombre y acciones en UNA fila; si no cabe, se acorta la carpeta y luego el nombre (las acciones son iconos).
                <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5 desk:min-h-10 desk:flex-nowrap desk:px-4">
                  <span className="flex min-w-0 flex-1 basis-44 items-center gap-2 desk:basis-0">
                    <span className="flex min-w-0 font-mono text-xs" title={selectedFile.path}>
                      {(() => {
                        const { dir, name } = splitPath(selectedFile.path)
                        return (
                          <>
                            {/* Si no cabe, se acorta la carpeta antes que el nombre. */}
                            {dir && <span className="min-w-0 truncate text-muted">{dir.replace(/[/\\]+$/, '')}/</span>}
                            <span className="max-w-full shrink-0 truncate font-semibold text-fg">{name}</span>
                          </>
                        )
                      })()}
                    </span>
                    {stats && (
                      <span className="flex shrink-0 gap-1.5 font-mono text-xs tabular-nums desk:@max-[26rem]:hidden">
                        {stats.additions > 0 && <span className="text-success">+{stats.additions}</span>}
                        {stats.deletions > 0 && <span className="text-danger">−{stats.deletions}</span>}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center">
                    {canReview && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mr-1"
                        disabled={
                          isAccepted(record, selectedFile.path, infos.get(selectedFile.path)?.fingerprint) || !infos.has(selectedFile.path)
                        }
                        title={t('code.changes.acceptHint')}
                        aria-label={t('code.changes.accept')}
                        onClick={() => accept([selectedFile.path])}
                      >
                        <Check size={12} aria-hidden />
                        <span className="whitespace-nowrap desk:@max-[30rem]:hidden">
                          {isAccepted(record, selectedFile.path, infos.get(selectedFile.path)?.fingerprint)
                            ? t('code.changes.accepted')
                            : t('code.changes.accept')}
                        </span>
                      </Button>
                    )}
                    {native && (
                      <>
                        {dialogs && (
                          <>
                            <IconButton
                              label={t('code.menu.openEditor')}
                              className="h-6 w-6"
                              onClick={() => void native.dialog.openInEditor(abs)}
                            >
                              <Code2 size={13} />
                            </IconButton>
                            <IconButton
                              label={t('code.menu.reveal')}
                              className="h-6 w-6"
                              onClick={() => void native.dialog.revealInFinder(abs)}
                            >
                              <FolderOpen size={13} />
                            </IconButton>
                          </>
                        )}
                        {canDiscard(selectedFile) && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="hover:text-danger"
                            aria-label={t('code.changes.discard')}
                            title={t('code.changes.discard')}
                            onClick={() => void discard(selectedFile, selStaged ? 'all' : 'unstaged')}
                          >
                            <Undo2 size={12} aria-hidden />
                            <span className="hidden desk:@min-[30rem]:inline">{t('code.changes.revert')}</span>
                          </Button>
                        )}
                      </>
                    )}
                    <IconButton
                      label={t('code.changes.closeDiff')}
                      className="h-6 w-6"
                      onClick={() => ((closedByUser.current = true), setSelected(null))}
                    >
                      <X size={13} />
                    </IconButton>
                  </span>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                {!selectedFile && !mobile && status && status.files.length > 0 && (
                  <div className="px-3 py-4 text-center text-xs text-subtle">{t('code.changes.selectFile')}</div>
                )}
                {selectedFile && diffLoading && !diff && (
                  <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
                    <Loader2 size={14} className="animate-spin" /> {t('code.changes.loadingDiff')}
                  </div>
                )}
                {selectedFile && diff && (
                  <DiffView
                    patch={diff}
                    path={selectedFile.path}
                    hideFileHeaders
                    // Escritorio: el código nunca se parte (una línea = una fila, desplazamiento horizontal dentro del diff con los
                    // números fijos); el diff ocupa el alto del panel para que la barra horizontal quede a la vista. El celular conserva su ajuste.
                    wrap={mobile ? wrap : false}
                    className={mobile ? '' : 'h-full'}
                    onDiscardHunk={
                      native && !selStaged && selectedFile.kind === 'modified' && isSingleFileDiff(diff)
                        ? (i) => void discardHunk(selectedFile, i)
                        : undefined
                    }
                  />
                )}
                {selectedFile && diffError && !diffLoading && (
                  <div className="px-3 py-3 text-xs text-danger">{t('code.changes.diffFailed', { error: diffError })}</div>
                )}
                {selectedFile && !diff && !diffLoading && !diffError && (
                  <div className="px-3 py-3 text-sm text-subtle">{t('code.changes.noTextDiff')}</div>
                )}
              </div>
            </div>
          </div>
          {status && !(mobile && selectedFile) && (
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
