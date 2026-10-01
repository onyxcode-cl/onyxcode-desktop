/**
 * Panel "Proyecto" de la carpeta actual: instrucciones propias de la carpeta (además de las
 * instrucciones globales de Ajustes), enlaces de referencia, "Memoria" (`.onyxcode/memoria.md`, que el
 * agente lee y actualiza entre tareas, con interruptor "Usar memoria"), el `AGENTS.md` de la carpeta,
 * las skills disponibles y los permisos recordados — ver `resources/opencode/agents/tasks.md`.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, BookText, Check, FileText, Link2, Loader2, NotebookText, Plus, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import type { TasksPermissionRule } from '@shared/ipc-tasks'
import { TASKS_INSTRUCTIONS_MAX } from '@shared/tasks-prompt'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { dateLocale, useT } from '../../../lib/i18n'
import { cw } from './bridge'
import { DeleteGrantToggle } from './DeleteGrant'
import { RecordSkillButton, RecordSkillReview } from './RecordSkill'
import { deleteMemoryNotes, saveMemoryNotes, setProjectPanelOpen, useTasks } from './store'
import { baseName } from './util'
import { errText } from '../../../lib/format'
import { isSubmitKey } from '../../../lib/textarea'

type Tab = 'project' | 'memory' | 'agents'

const MAX_LINKS = 50
const AGENTS_MD_MAX = 200_000

interface SkillInfo {
  name: string
  description?: string
}

/** Acepta solo enlaces http(s) válidos. */
function normalizeLink(raw: string): string | null {
  const v = raw.trim()
  if (!v || v.length > 2048) return null
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'
const labelCls = 'mb-1.5 block text-xs font-medium text-muted'

export function ProjectPanel(): React.JSX.Element | null {
  const t = useT()
  const numFmt = new Intl.NumberFormat(dateLocale())
  const open = useTasks((s) => s.projectPanelOpen)
  const folder = useTasks((s) => s.folder)
  const project = useTasks((s) => s.project)
  const memory = useTasks((s) => s.memory)
  const [tab, setTab] = useState<Tab>('project')
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [memoryText, setMemoryText] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [linkDraft, setLinkDraft] = useState('')
  const [agentsText, setAgentsText] = useState('')
  const [agentsInfo, setAgentsInfo] = useState<{ path: string; exists: boolean } | null>(null)
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [rules, setRules] = useState<TasksPermissionRule[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? (folder ? baseName(folder) : ''))
    setInstructions(project?.instructions ?? '')
    setLinks(project?.links ?? [])
    setMemoryText(memory?.content ?? '')
    setError(null)
  }, [open, project, memory, folder])

  // La pestaña solo vuelve a "Proyecto" al abrir el panel o cambiar de carpeta (no al guardar).
  useEffect(() => {
    if (open) setTab('project')
  }, [open, folder])

  // Skills disponibles y permisos recordados de la carpeta.
  useEffect(() => {
    if (!open || !folder) return
    let cancelled = false
    setSkills(null)
    const client = useTasks.getState().client
    if (client) {
      void client.app
        .skills({ directory: folder })
        .then((r) => {
          if (!cancelled) setSkills((r.data ?? []).map((k) => ({ name: k.name, description: k.description })))
        })
        .catch(() => {
          if (!cancelled) setSkills([])
        })
    }
    void cw('tasks:rules:list', { folder })
      .then((list) => {
        if (!cancelled) setRules(list)
      })
      .catch(() => {
        if (!cancelled) setRules([])
      })
    return () => {
      cancelled = true
    }
  }, [open, folder])

  // AGENTS.md: se carga al entrar en su pestaña.
  useEffect(() => {
    if (!open || !folder || tab !== 'agents') return
    let cancelled = false
    setAgentsLoading(true)
    void cw('tasks:agentsMd:get', { folder })
      .then((a) => {
        if (cancelled) return
        setAgentsText(a.content)
        setAgentsInfo({ path: a.path, exists: a.exists })
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(errText(err))
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, folder, tab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setProjectPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // La revisión de una grabación no depende de que este panel esté abierto: se muestra en cuanto
  // llega `computer:recordDone`, sea cual sea la vista de Tareas en la que esté el usuario.
  if (!open || !folder) return <RecordSkillReview />

  const flashSaved = (): void => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const submitProject = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const p = await cw('tasks:project:save', { folder, name, instructions, links })
      if (useTasks.getState().folder === folder) useTasks.setState({ project: p })
      flashSaved()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSaving(false)
    }
  }

  const addLink = (): void => {
    const link = normalizeLink(linkDraft)
    if (!link) {
      setError(t('tasks.proj.linkInvalid'))
      return
    }
    setError(null)
    if (links.includes(link)) {
      setLinkDraft('')
      return
    }
    if (links.length >= MAX_LINKS) {
      setError(t('tasks.proj.maxLinks', { max: MAX_LINKS }))
      return
    }
    setLinks([...links, link])
    setLinkDraft('')
  }

  /** "Usar memoria" se guarda al instante (no depende del botón Guardar). */
  const toggleMemory = async (): Promise<void> => {
    setError(null)
    try {
      const p = await cw('tasks:project:save', { folder, memoryEnabled: project?.memoryEnabled === false })
      if (useTasks.getState().folder === folder) useTasks.setState({ project: p })
    } catch (err) {
      setError(errText(err))
    }
  }

  const submitAgents = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const a = await cw('tasks:agentsMd:save', { folder, content: agentsText })
      setAgentsText(a.content)
      setAgentsInfo({ path: a.path, exists: a.exists })
      flashSaved()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (id: string): Promise<void> => {
    setError(null)
    try {
      await cw('tasks:rules:remove', { id })
      setRules((cur) => cur.filter((r) => r.id !== id))
    } catch (err) {
      setError(errText(err))
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
    const ok = await confirmDialog({
      title: t('tasks.proj.clearTitle'),
      message: t('tasks.proj.clearMsg'),
      confirmLabel: t('tasks.proj.clearConfirm'),
      danger: true
    })
    if (!ok) return
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
    <>
      <RecordSkillReview />
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
              aria-label={t('tasks.proj.close')}
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex shrink-0 gap-1 border-b border-border px-5 py-2">
            <button type="button" className={tabCls(tab === 'project')} onClick={() => setTab('project')}>
              <BookText size={13} /> {t('tasks.proj.tabProject')}
            </button>
            <button type="button" className={tabCls(tab === 'memory')} onClick={() => setTab('memory')}>
              <NotebookText size={13} /> {t('tasks.proj.tabMemory')}
            </button>
            <button type="button" className={tabCls(tab === 'agents')} onClick={() => setTab('agents')}>
              <FileText size={13} /> AGENTS.md
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {tab === 'project' ? (
              <>
                <div>
                  <label className={labelCls} htmlFor="proj-name">
                    {t('tasks.proj.name')}
                  </label>
                  <input id="proj-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="proj-instructions">
                    {t('tasks.proj.instructions')}
                  </label>
                  <textarea
                    id="proj-instructions"
                    className={`${inputCls} min-h-56 resize-y leading-relaxed`}
                    value={instructions}
                    placeholder={t('tasks.proj.instructionsPh')}
                    onChange={(e) => setInstructions(e.target.value)}
                    maxLength={TASKS_INSTRUCTIONS_MAX}
                  />
                  <div className="mt-1.5 flex items-start gap-3">
                    <p className="min-w-0 flex-1 text-xs text-subtle">{t('tasks.proj.instructionsHint')}</p>
                    <span
                      className={`shrink-0 text-xs tabular-nums ${instructions.length >= TASKS_INSTRUCTIONS_MAX * 0.9 ? 'text-danger' : 'text-subtle'}`}
                      aria-live="polite"
                    >
                      {numFmt.format(instructions.length)} / {numFmt.format(TASKS_INSTRUCTIONS_MAX)}
                    </span>
                  </div>
                </div>

                <div>
                  <span className={labelCls}>{t('tasks.proj.links')}</span>
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      value={linkDraft}
                      placeholder="https://…"
                      inputMode="url"
                      aria-label={t('tasks.proj.newLinkAria')}
                      onChange={(e) => setLinkDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (isSubmitKey(e, { allowShift: true })) {
                          e.preventDefault()
                          addLink()
                        }
                      }}
                    />
                    <Button variant="ghost" onClick={addLink} disabled={!linkDraft.trim()}>
                      <Plus size={14} /> {t('tasks.proj.add')}
                    </Button>
                  </div>
                  {links.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {links.map((l) => (
                        <li key={l} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                          <Link2 size={13} className="shrink-0 text-subtle" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={l}>
                            {l}
                          </span>
                          <button
                            type="button"
                            onClick={() => setLinks(links.filter((x) => x !== l))}
                            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
                            aria-label={t('tasks.proj.removeLink', { link: l })}
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-xs text-subtle">{t('tasks.proj.linksHint', { max: MAX_LINKS })}</p>
                </div>

                <div>
                  <span className={labelCls}>{t('tasks.proj.folder')}</span>
                  <DeleteGrantToggle />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted">
                      <Sparkles size={12} className="mr-1 inline align-[-1px]" />
                      {t('tasks.proj.skills')}
                    </span>
                    <RecordSkillButton />
                  </div>
                  {skills === null ? (
                    <p className="text-xs text-subtle">
                      {useTasks.getState().client ? t('tasks.proj.loading') : t('tasks.proj.openTaskForSkills')}
                    </p>
                  ) : skills.length === 0 ? (
                    <p className="text-xs text-subtle">
                      {t('tasks.proj.noSkills')}
                      <code className="font-mono">{t('tasks.proj.skillPath')}</code>.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {skills.map((k) => (
                        <li key={k.name} className="rounded-lg border border-border px-2.5 py-1.5">
                          <span className="font-mono text-xs font-medium">{k.name}</span>
                          {k.description && <p className="mt-0.5 line-clamp-2 text-xs text-subtle">{k.description}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <span className={labelCls}>
                    <ShieldCheck size={12} className="mr-1 inline align-[-1px]" />
                    {t('tasks.proj.rules')}
                  </span>
                  {rules.length === 0 ? (
                    <p className="text-xs text-subtle">{t('tasks.proj.noRules')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {rules.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium">{r.permission}</span>
                            <p className="truncate font-mono text-xs text-subtle" title={r.pattern}>
                              {r.pattern}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeRule(r.id)}
                            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-danger hover:bg-danger/10"
                          >
                            <Trash2 size={12} /> {t('tasks.proj.removeRule')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rules.length > 0 && <p className="mt-1.5 text-xs text-subtle">{t('tasks.proj.rulesHint')}</p>}
                </div>
              </>
            ) : tab === 'agents' ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className={labelCls} htmlFor="proj-agents">
                    {t('tasks.proj.agentsTitle')}
                  </label>
                  {agentsLoading && <Loader2 size={13} className="animate-spin text-subtle" />}
                </div>
                <textarea
                  id="proj-agents"
                  className={`${inputCls} min-h-72 resize-y font-mono leading-relaxed`}
                  value={agentsText}
                  disabled={agentsLoading}
                  maxLength={AGENTS_MD_MAX}
                  placeholder={t('tasks.proj.agentsPh')}
                  onChange={(e) => setAgentsText(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-subtle">
                  {agentsInfo && !agentsInfo.exists ? t('tasks.proj.agentsNew') : t('tasks.proj.agentsExists')}
                  {agentsInfo && <span className="font-mono break-all">{agentsInfo.path}</span>}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t('tasks.proj.useMemory')}</p>
                      <p className="mt-0.5 text-xs text-subtle">{t('tasks.proj.useMemoryHint')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={project?.memoryEnabled !== false}
                      aria-label={t('tasks.proj.useMemory')}
                      onClick={() => void toggleMemory()}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                        project?.memoryEnabled !== false ? 'bg-accent' : 'bg-border-strong'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                          project?.memoryEnabled !== false ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className={labelCls} htmlFor="proj-memory">
                      {t('tasks.proj.notes')}
                    </label>
                    {memory?.exists && (
                      <button
                        type="button"
                        onClick={() => void clearMemory()}
                        className="flex items-center gap-1 text-xs text-danger hover:underline"
                      >
                        <Trash2 size={12} /> {t('tasks.proj.clearConfirm')}
                      </button>
                    )}
                  </div>
                  <textarea
                    id="proj-memory"
                    className={`${inputCls} min-h-64 resize-y font-mono leading-relaxed`}
                    value={memoryText}
                    placeholder={t('tasks.proj.notesPh')}
                    onChange={(e) => setMemoryText(e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-subtle">{t('tasks.proj.notesHint')}</p>
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
                  <Check size={13} /> {t('tasks.proj.saved')}
                </span>
              )}
            </span>
            <Button variant="ghost" onClick={() => setProjectPanelOpen(false)}>
              {t('tasks.proj.close')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void (tab === 'project' ? submitProject() : tab === 'agents' ? submitAgents() : submitMemory())}
              disabled={saving || (tab === 'agents' && agentsLoading)}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('tasks.proj.save')}
            </Button>
          </footer>
        </div>
      </div>
    </>
  )
}
