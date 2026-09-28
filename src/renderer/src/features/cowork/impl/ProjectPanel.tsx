/**
 * Panel "Proyecto" de la carpeta actual: instrucciones propias de la carpeta (además de las
 * instrucciones globales de Ajustes) y "Memoria" (`.lapis/memoria.md`, que el agente lee y
 * actualiza entre tareas) — ver `resources/opencode/agents/cowork.md`.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, BookText, Check, Loader2, NotebookText, Trash2, X } from 'lucide-react'
import { Button } from '../../../components/Button'
import { DeleteGrantToggle } from './DeleteGrant'
import { deleteMemoryNotes, saveMemoryNotes, saveProject, setProjectPanelOpen, useCowork } from './store'
import { baseName } from './util'

type Tab = 'project' | 'memory'

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'
const labelCls = 'mb-1.5 block text-xs font-medium text-muted'

export function ProjectPanel(): React.JSX.Element | null {
  const open = useCowork((s) => s.projectPanelOpen)
  const folder = useCowork((s) => s.folder)
  const project = useCowork((s) => s.project)
  const memory = useCowork((s) => s.memory)
  const [tab, setTab] = useState<Tab>('project')
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [memoryText, setMemoryText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? (folder ? baseName(folder) : ''))
    setInstructions(project?.instructions ?? '')
    setMemoryText(memory?.content ?? '')
    setTab('project')
    setError(null)
  }, [open, project, memory, folder])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setProjectPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || !folder) return null

  const flashSaved = (): void => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const submitProject = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await saveProject({ name, instructions })
      flashSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const submitMemory = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await saveMemoryNotes(memoryText)
      flashSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const clearMemory = async (): Promise<void> => {
    if (!window.confirm('¿Borrar la memoria guardada de este proyecto? No se puede deshacer.')) return
    setSaving(true)
    setError(null)
    try {
      await deleteMemoryNotes()
      setMemoryText('')
      flashSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const tabCls = (on: boolean): string =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-elevated text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25 backdrop-blur-[1px]" onMouseDown={() => setProjectPanelOpen(false)}>
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-panel-title"
      >
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <BookText size={15} />
          </span>
          <h2 id="project-panel-title" className="min-w-0 truncate text-base font-semibold">
            {project?.name || baseName(folder)}
          </h2>
          <button
            type="button"
            onClick={() => setProjectPanelOpen(false)}
            className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-border px-5 py-2">
          <button type="button" className={tabCls(tab === 'project')} onClick={() => setTab('project')}>
            <BookText size={13} /> Proyecto
          </button>
          <button type="button" className={tabCls(tab === 'memory')} onClick={() => setTab('memory')}>
            <NotebookText size={13} /> Memoria
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {tab === 'project' ? (
            <>
              <div>
                <label className={labelCls} htmlFor="proj-name">
                  Nombre del proyecto
                </label>
                <input id="proj-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
              </div>
              <div>
                <label className={labelCls} htmlFor="proj-instructions">
                  Instrucciones de esta carpeta
                </label>
                <textarea
                  id="proj-instructions"
                  className={`${inputCls} min-h-56 resize-y leading-relaxed`}
                  value={instructions}
                  placeholder="Convenciones, tono, formatos preferidos, contexto del proyecto…"
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={20_000}
                />
                <p className="mt-1.5 text-xs text-subtle">
                  Se añaden a todas las tareas de esta carpeta, junto con las instrucciones globales de
                  Ajustes y la memoria guardada.
                </p>
              </div>
              <div>
                <span className={labelCls}>Carpeta</span>
                <DeleteGrantToggle />
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className={labelCls} htmlFor="proj-memory">
                    Notas guardadas (.lapis/memoria.md)
                  </label>
                  {memory?.exists && (
                    <button
                      type="button"
                      onClick={() => void clearMemory()}
                      className="flex items-center gap-1 text-xs text-danger hover:underline"
                    >
                      <Trash2 size={12} /> Borrar
                    </button>
                  )}
                </div>
                <textarea
                  id="proj-memory"
                  className={`${inputCls} min-h-64 resize-y font-mono leading-relaxed`}
                  value={memoryText}
                  placeholder="El agente guarda aquí notas útiles entre tareas (preferencias, decisiones, datos recurrentes)…"
                  onChange={(e) => setMemoryText(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-subtle">
                  El agente Cowork lee y actualiza este archivo. También puedes editarlo tú a mano; se
                  incluye como contexto en cada nueva tarea de esta carpeta.
                </p>
              </div>
            </>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-subtle">
            {saved && (
              <span className="flex items-center gap-1 text-accent">
                <Check size={13} /> Guardado
              </span>
            )}
          </span>
          <Button variant="ghost" onClick={() => setProjectPanelOpen(false)}>
            Cerrar
          </Button>
          <Button variant="primary" onClick={() => void (tab === 'project' ? submitProject() : submitMemory())} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </Button>
        </footer>
      </div>
    </div>
  )
}
