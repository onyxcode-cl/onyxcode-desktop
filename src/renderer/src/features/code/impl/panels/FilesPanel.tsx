import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileContent, FileNode } from '@opencode-ai/sdk/v2/client'
import { ArrowLeft, ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { IconButton } from '../../../../components/IconButton'
import { errorMessage, useClient, sdkData } from '../client'
import { DiffView, highlightLine, languageFor } from '../DiffView'
import { useVisibleFsVersion } from '../useVisibleFsVersion'

type Listing = Record<string, FileNode[] | 'loading' | { error: string }>

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) =>
    a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })
  )
}

function FileViewer({ directory, path, onClose }: { directory: string; path: string; onClose: () => void }): React.JSX.Element {
  const client = useClient()
  const fsVersion = useVisibleFsVersion()
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)

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
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <IconButton label="Volver" onClick={onClose} className="h-6 w-6">
          <ArrowLeft size={14} />
        </IconButton>
        <span className="min-w-0 truncate font-mono text-xs">{path}</span>
        {content?.diff && (
          <button
            type="button"
            onClick={() => setShowDiff((d) => !d)}
            className={`ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs ${showDiff ? 'bg-active text-fg' : 'text-muted hover:bg-hover'}`}
          >
            Diff
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-code">
        {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
        {!content && !error && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        )}
        {content?.type === 'binary' && <div className="px-3 py-3 text-sm text-subtle">Archivo binario.</div>}
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

export function FilesPanel({ directory }: { directory: string }): React.JSX.Element {
  const client = useClient()
  const [listing, setListing] = useState<Listing>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['.']))
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[] | null>(null)

  const loadDir = useCallback(
    async (path: string) => {
      if (!client) return
      setListing((l) => ({ ...l, [path]: 'loading' }))
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
    void loadDir('.')
  }, [loadDir])

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
  }

  if (openFile) return <FileViewer directory={directory} path={openFile} onClose={() => setOpenFile(null)} />

  const renderDir = (path: string, depth: number): React.JSX.Element | null => {
    const entry = listing[path]
    if (!entry) return null
    if (entry === 'loading')
      return (
        <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-xs text-subtle">
          <Loader2 size={12} className="inline animate-spin" />
        </div>
      )
    if (!Array.isArray(entry))
      return (
        <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-xs text-danger">
          {entry.error}
        </div>
      )
    return (
      <>
        {entry.map((n) => {
          const isDir = n.type === 'directory'
          const open = expanded.has(n.path)
          return (
            <div key={n.path}>
              <button
                type="button"
                onClick={() => (isDir ? toggle(n) : setOpenFile(n.path))}
                style={{ paddingLeft: 8 + depth * 14 }}
                className={`flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] hover:bg-hover ${n.ignored ? 'opacity-50' : ''}`}
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
              {isDir && open && renderDir(n.path, depth + 1)}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Search size={13} className="ml-1 shrink-0 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar archivos…"
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-subtle"
        />
        {query && (
          <IconButton label="Limpiar" onClick={() => setQuery('')} className="h-6 w-6">
            <X size={13} />
          </IconButton>
        )}
        <IconButton label="Actualizar" onClick={refreshAll} className="h-6 w-6">
          <RefreshCw size={13} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {results ? (
          results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-subtle">Sin resultados.</div>
          ) : (
            results.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setOpenFile(p)}
                className="flex w-full items-center gap-1.5 px-3 py-[3px] text-left text-[13px] hover:bg-hover"
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
    </div>
  )
}
