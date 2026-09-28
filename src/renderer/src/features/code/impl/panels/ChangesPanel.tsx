import { useCallback, useEffect, useState } from 'react'
import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { IconButton } from '../../../../components/IconButton'
import { errorMessage, getClient, getCodeApi } from '../client'
import { DiffView, makePatch } from '../DiffView'
import { useCode } from '../store'

interface ChangedFile {
  path: string
  /** Letra de estado (M, A, D, ?, R…) */
  code: string
  staged: boolean
}

interface StatusInfo {
  branch: string | null
  ahead: number
  behind: number
  files: ChangedFile[]
}

const CODE_COLOR: Record<string, string> = {
  M: 'text-[#d97706]',
  A: 'text-[#16a34a]',
  '?': 'text-[#16a34a]',
  D: 'text-danger',
  R: 'text-accent'
}

async function loadStatus(cwd: string): Promise<StatusInfo> {
  try {
    const st = await getCodeApi().gitStatus(cwd)
    return {
      branch: st.branch,
      ahead: st.ahead,
      behind: st.behind,
      files: st.files.map((f) => {
        const idx = f.index.trim()
        const wd = f.workingDir.trim()
        const code = idx === '?' || wd === '?' ? '?' : wd || idx || 'M'
        return { path: f.path, code, staged: !!idx && idx !== '?' && !wd }
      })
    }
  } catch (ipcErr) {
    // Alternativa: estado git vía OpenCode (`GET /file/status`).
    const client = getClient()
    if (!client) throw ipcErr
    const res = await client.file.status({ directory: cwd })
    if (res.error || !res.data) throw ipcErr
    return {
      branch: null,
      ahead: 0,
      behind: 0,
      files: res.data.map((f) => ({
        path: f.path,
        code: f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M',
        staged: false
      }))
    }
  }
}

async function loadDiff(cwd: string, file: ChangedFile): Promise<string> {
  let text = ''
  try {
    text = await getCodeApi().gitDiff({ cwd, path: file.path, staged: file.staged })
  } catch {
    // se intentará con OpenCode
  }
  if (text.trim()) return text
  const client = getClient()
  if (!client) return text
  const res = await client.file.read({ directory: cwd, path: file.path })
  if (res.data?.diff) return res.data.diff
  // Archivo nuevo sin seguimiento: se muestra todo como añadido.
  if (file.code === '?' || file.code === 'A') {
    if (res.data?.type === 'text') return makePatch(file.path, '', res.data.content)
  }
  return text
}

export function ChangesPanel({ directory }: { directory: string }): React.JSX.Element {
  const fsVersion = useCode((s) => s.fsVersion)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)

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

  const selectedFile = status?.files.find((f) => f.path === selected) ?? null
  useEffect(() => {
    if (!selectedFile) {
      setDiff('')
      return
    }
    let cancelled = false
    setDiffLoading(true)
    loadDiff(directory, selectedFile)
      .then((d) => !cancelled && setDiff(d))
      .catch((err: unknown) => !cancelled && setDiff(`Error: ${errorMessage(err)}`))
      .finally(() => !cancelled && setDiffLoading(false))
    return () => {
      cancelled = true
    }
  }, [directory, selectedFile])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <GitBranch size={13} />
        <span className="truncate font-mono">{status?.branch ?? '—'}</span>
        {status && (status.ahead > 0 || status.behind > 0) && (
          <span>
            ↑{status.ahead} ↓{status.behind}
          </span>
        )}
        <span className="ml-auto">{status ? `${status.files.length} archivos` : ''}</span>
        <IconButton label="Actualizar" onClick={() => void refresh()} className="h-6 w-6">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </IconButton>
      </div>
      {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border py-1">
        {status && status.files.length === 0 && <div className="px-3 py-3 text-sm text-subtle">Sin cambios.</div>}
        {status?.files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => setSelected(f.path === selected ? null : f.path)}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-hover ${selected === f.path ? 'bg-active' : ''}`}
          >
            <span className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${CODE_COLOR[f.code] ?? 'text-muted'}`}>
              {f.code === '?' ? 'U' : f.code}
            </span>
            <span className="min-w-0 truncate">
              <span className="text-fg">{f.path.split('/').pop()}</span>{' '}
              <span className="text-subtle">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
            </span>
            {f.staged && <span className="ml-auto shrink-0 text-[10px] text-subtle uppercase">preparado</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!selectedFile && status && status.files.length > 0 && (
          <div className="px-3 py-3 text-sm text-subtle">Selecciona un archivo para ver el diff.</div>
        )}
        {selectedFile && diffLoading && !diff && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Cargando diff…
          </div>
        )}
        {selectedFile && diff && <DiffView patch={diff} />}
        {selectedFile && !diff && !diffLoading && <div className="px-3 py-3 text-sm text-subtle">Sin diferencias de texto.</div>}
      </div>
    </div>
  )
}
