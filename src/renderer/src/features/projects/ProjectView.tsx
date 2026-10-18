/**
 * Pantalla de un proyecto del Chat (F8-B185): nombre, instrucciones, archivos de conocimiento (añadir con el diálogo nativo o
 * arrastrando; estado de lectura con aviso para lectores de pantalla), espacio usado y conversaciones del proyecto.
 * Todo el contenido de los archivos lo lee y lo guarda `main`; aquí solo se muestra el estado.
 */
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, FolderOpen, Lock, MessageSquarePlus, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectFileFailReason, ProjectFileInfo, ProjectInfo } from '@shared/ipc-extras'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../components/Button'
import { confirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { getExtras } from '../../lib/extrasApi'
import { useLocale, useT } from '../../lib/i18n'
import { useSessions } from '../../stores/sessions'
import { newChat, openChatSession } from '../chat/actions'
import { formatBytes, projectErrorCode, useProjects, type UploadItem } from './store'

const TEXTAREA =
  'w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'
const FIELD =
  'w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15'

function failKey(reason: ProjectFileFailReason | undefined): MsgKey {
  return `projects.fail.${reason ?? 'unreadable'}` as MsgKey
}

function FileRow({ project, file, onRemove }: { project: ProjectInfo; file: ProjectFileInfo; onRemove: () => void }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const ok = file.status === 'ready'
  return (
    <li
      data-testid="project-file"
      data-status={file.status}
      className="flex items-start gap-3 rounded-lg border border-border bg-elevated px-3 py-2"
    >
      <span className="mt-0.5 shrink-0 text-muted" aria-hidden="true">
        {ok ? <FileText size={16} /> : <AlertCircle size={16} className="text-danger" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-ui font-medium" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-meta text-subtle">{formatBytes(file.bytes, locale)}</span>
        </div>
        {ok ? (
          <p className="flex items-center gap-1 text-meta text-muted">
            <CheckCircle2 size={12} className="text-success" aria-hidden="true" />
            {file.truncated ? t('projects.file.readyPartial') : t('projects.file.ready', { count: file.chunks ?? 0 })}
          </p>
        ) : (
          <p className="text-meta text-danger">
            {t('projects.file.error')}. {t(failKey(file.reason))}
          </p>
        )}
      </div>
      <IconButton label={t('projects.file.remove', { name: file.name })} tooltip size="sm" onClick={onRemove} data-project={project.id}>
        <Trash2 size={14} />
      </IconButton>
    </li>
  )
}

function LocalRow({ item }: { item: UploadItem }): React.JSX.Element {
  const t = useT()
  return (
    <li
      data-testid="project-upload"
      data-status={item.status}
      className="flex items-start gap-3 rounded-lg border border-border bg-elevated px-3 py-2"
    >
      <span className="mt-0.5 shrink-0 text-muted" aria-hidden="true">
        {item.status === 'error' ? <AlertCircle size={16} className="text-danger" /> : <Spinner size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium" title={item.name}>
          {item.name}
        </span>
        <p className={`text-meta ${item.status === 'error' ? 'text-danger' : 'text-muted'}`}>
          {item.status === 'error'
            ? `${t('projects.file.error')}. ${t(failKey(item.reason))}`
            : item.status === 'waiting'
              ? t('projects.file.waiting')
              : t('projects.file.reading')}
        </p>
      </div>
    </li>
  )
}

export function ProjectView(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const viewId = useProjects((s) => s.viewId)
  const state = useProjects((s) => s.state)
  const loading = useProjects((s) => s.loading)
  const error = useProjects((s) => s.error)
  const upload = useProjects((s) => s.upload)
  const sessions = useSessions((s) => s.sessions)
  const project = useMemo(() => state?.projects.find((p) => p.id === viewId) ?? null, [state, viewId])
  const limits = state?.limits

  const [name, setName] = useState(project?.name ?? '')
  const [instr, setInstr] = useState(project?.instructions ?? '')
  const [savedNote, setSavedNote] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busyPick, setBusyPick] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const dragDepth = useRef(0)

  // Al abrir (o cambiar de proyecto) se cargan sus textos y el foco va al título de la pantalla.
  useEffect(() => {
    setName(project?.name ?? '')
    setInstr(project?.instructions ?? '')
    setSavedNote(false)
    heading.current?.focus()
    // Solo al cambiar de proyecto: no pisar lo que la persona escribe cuando el estado se refresca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, !!project])

  useEffect(() => {
    if (!savedNote) return
    const id = setTimeout(() => setSavedNote(false), 4000)
    return () => clearTimeout(id)
  }, [savedNote])

  const mine = useMemo(() => {
    if (!state || !project) return []
    return Object.entries(state.assignments)
      .filter(([, pid]) => pid === project.id)
      .map(([sid]) => sessions[sid])
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => b.time.updated - a.time.updated)
  }, [state, project, sessions])

  const close = (): void => useProjects.getState().closeProject()

  if (!project || !limits) {
    return (
      <div className="flex h-full flex-col" data-testid="project-view">
        <div className="drag h-12 shrink-0" />
        <div className="flex flex-1 items-center justify-center px-6">
          {loading || (!state && !error) ? (
            <p role="status" className="flex items-center gap-2 text-ui text-muted">
              <Spinner size={14} /> {t('projects.view.loading')}
            </p>
          ) : (
            <EmptyState
              icon={<FolderOpen size={20} />}
              title={t('projects.view.missing')}
              action={
                <Button variant="secondary" onClick={close}>
                  {t('projects.view.back')}
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  const readyCount = project.files.filter((f) => f.status === 'ready').length
  const pending = (upload && upload.projectId === project.id ? upload.items : []).filter(
    (i) => i.status === 'waiting' || i.status === 'reading' || (i.status === 'error' && i.reason === 'tooBig' && i.local)
  )
  const instrDirty = instr !== project.instructions
  const busy = !!upload && upload.projectId === project.id && !upload.done

  const commitName = async (): Promise<void> => {
    const clean = name.trim()
    if (!clean) {
      setName(project.name)
      return
    }
    if (clean !== project.name) await useProjects.getState().update(project.id, { name: clean })
  }

  const saveInstr = async (): Promise<void> => {
    if (await useProjects.getState().update(project.id, { instructions: instr })) setSavedNote(true)
  }

  const pickFiles = async (): Promise<void> => {
    const x = getExtras()
    if (!x || busy) return
    setBusyPick(true)
    try {
      const picks = await x.invoke('projects:pickFiles', { id: project.id })
      if (picks && picks.length) {
        await useProjects.getState().addFiles(
          project.id,
          picks.map((p) => ({ kind: 'picked' as const, ...p }))
        )
      }
    } catch {
      // el diálogo falló: no hay archivos que añadir
    } finally {
      setBusyPick(false)
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (busy) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length)
      void useProjects.getState().addFiles(
        project.id,
        files.map((file) => ({ kind: 'dropped' as const, file }))
      )
  }
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

  const removeFile = async (f: ProjectFileInfo): Promise<void> => {
    await useProjects.getState().removeFile(project.id, f.id)
  }

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('projects.delete.title', { name: project.name }),
      message: t('projects.delete.message'),
      confirmLabel: t('projects.delete.confirm'),
      danger: true
    })
    if (ok) await useProjects.getState().remove(project.id)
  }

  const newConversation = (): void => {
    newChat()
    useProjects.getState().setPending(project.id)
    close()
  }

  // Aviso para lectores de pantalla: qué archivo se está leyendo y cómo terminó.
  let live = ''
  if (upload && upload.projectId === project.id) {
    const idx = upload.items.findIndex((i) => i.status === 'reading')
    if (!upload.done && idx >= 0) {
      live = t('projects.live.reading', { name: upload.items[idx].name, index: idx + 1, total: upload.items.length })
    } else if (upload.done) {
      const ok = upload.items.filter((i) => i.status === 'ready').length
      const bad = upload.items.length - ok
      live =
        bad === 0 ? t('projects.live.done', { count: ok }) : ok === 0 ? t('projects.live.none') : t('projects.live.doneSome', { ok, bad })
    }
  }

  return (
    <div
      role="region"
      aria-label={t('projects.view.region', { name: project.name })}
      data-testid="project-view"
      className="relative flex h-full min-w-0 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-4" data-mobile="hide">
        <IconButton label={t('projects.view.back')} tooltip size="sm" className="no-drag" onClick={close} data-testid="project-back">
          <ArrowLeft size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
          <header className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 ref={heading} tabIndex={-1} className="sr-only outline-none">
                {project.name}
              </h1>
              <label className="sr-only" htmlFor="project-name">
                {t('projects.view.name')}
              </label>
              <input
                id="project-name"
                data-testid="project-name"
                value={name}
                maxLength={limits.maxNameChars}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setName(project.name)
                }}
                className={`${FIELD} text-lg font-semibold`}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => void remove()} data-testid="project-delete">
              <Trash2 size={14} aria-hidden="true" /> {t('projects.view.delete')}
            </Button>
          </header>

          {error && (
            <div
              role="alert"
              data-testid="project-error"
              className="flex items-start gap-2 rounded-lg border border-danger/40 px-3 py-2 text-ui text-danger"
            >
              <span className="min-w-0 flex-1">{errorText(t, error, limits.maxProjects)}</span>
              <IconButton label={t('projects.err.close')} size="xs" onClick={() => useProjects.getState().clearError()}>
                <X size={12} />
              </IconButton>
            </div>
          )}

          <section aria-labelledby="project-privacy" className="flex items-start gap-3 rounded-lg bg-inset px-3 py-2.5">
            <Lock size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div>
              <h2 id="project-privacy" className="text-ui font-medium">
                {t('projects.privacy.title')}
              </h2>
              <p className="mt-0.5 text-meta leading-relaxed text-muted">{t('projects.privacy')}</p>
            </div>
          </section>

          <section aria-labelledby="project-instr">
            <h2 id="project-instr" className="text-sm font-semibold">
              {t('projects.instr.title')}
            </h2>
            <p id="project-instr-help" className="mt-0.5 text-meta leading-relaxed text-muted">
              {t('projects.instr.help')}
            </p>
            <textarea
              data-testid="project-instructions"
              value={instr}
              maxLength={limits.maxInstructionsChars}
              onChange={(e) => setInstr(e.target.value)}
              rows={5}
              placeholder={t('projects.instr.placeholder')}
              aria-labelledby="project-instr"
              aria-describedby="project-instr-help"
              className={`mt-2 min-h-28 ${TEXTAREA}`}
            />
            <div className="mt-1 flex items-center gap-3">
              <span className="text-meta text-subtle">
                {t('projects.instr.count', { count: instr.length, max: limits.maxInstructionsChars })}
              </span>
              <span role="status" aria-live="polite" className="text-meta text-success">
                {savedNote ? t('projects.instr.saved') : ''}
              </span>
              <Button
                variant="primary"
                size="sm"
                className="ml-auto"
                disabled={!instrDirty}
                onClick={() => void saveInstr()}
                data-testid="project-instructions-save"
              >
                {t('projects.instr.save')}
              </Button>
            </div>
          </section>

          <section aria-labelledby="project-files">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="project-files" className="text-sm font-semibold">
                {t('projects.files.title')}
              </h2>
              <span className="text-meta text-muted" data-testid="project-files-count">
                {t('projects.files.count', { count: readyCount, max: limits.maxFilesPerProject })} ·{' '}
                {t('projects.files.used', {
                  used: formatBytes(project.usedBytes, locale),
                  total: formatBytes(limits.maxProjectBytes, locale)
                })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                loading={busyPick}
                disabled={busy}
                onClick={() => void pickFiles()}
                data-testid="project-add-files"
              >
                {!busyPick && <Plus size={14} aria-hidden="true" />} {t('projects.files.add')}
              </Button>
            </div>
            <p className="mt-1 text-meta leading-relaxed text-muted">
              {t('projects.files.limits', {
                files: limits.maxFilesPerProject,
                size: formatBytes(limits.maxFileBytes, locale),
                total: formatBytes(limits.maxProjectBytes, locale),
                chars: limits.maxCharsPerFile.toLocaleString(locale)
              })}
            </p>
            <p
              role="status"
              aria-live="polite"
              data-testid="project-live"
              className={live ? 'mt-2 flex items-center gap-2 text-ui text-muted' : 'sr-only'}
            >
              {live && busy && <Spinner size={12} />}
              <span>{live}</span>
              {live && upload?.done && (
                <IconButton label={t('projects.live.dismiss')} size="xs" onClick={() => useProjects.getState().clearUpload()}>
                  <X size={12} />
                </IconButton>
              )}
            </p>
            {project.files.length === 0 && pending.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-border-strong">
                <EmptyState
                  icon={<FileText size={20} />}
                  title={t('projects.files.empty.title')}
                  description={`${t('projects.files.empty.desc')} ${t('projects.files.hint')}`}
                />
              </div>
            ) : (
              <>
                <ul aria-label={t('projects.files.list')} className="mt-3 flex flex-col gap-2">
                  {pending.map((i) => (
                    <LocalRow key={i.key} item={i} />
                  ))}
                  {project.files.map((f) => (
                    <FileRow key={f.id} project={project} file={f} onRemove={() => void removeFile(f)} />
                  ))}
                </ul>
                <p className="mt-2 text-meta text-subtle">{t('projects.files.hint')}</p>
              </>
            )}
          </section>

          <section aria-labelledby="project-convs">
            <div className="flex items-center gap-3">
              <h2 id="project-convs" className="text-sm font-semibold">
                {t('projects.convs.title')}
              </h2>
              <Button variant="secondary" size="sm" className="ml-auto" onClick={newConversation} data-testid="project-new-chat">
                <MessageSquarePlus size={14} aria-hidden="true" /> {t('projects.convs.new')}
              </Button>
            </div>
            {mine.length === 0 ? (
              <p className="mt-2 text-ui text-muted">{t('projects.convs.empty')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {mine.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void openChatSession(s.id)}
                      data-testid="project-conversation"
                      className="no-drag w-full truncate rounded-lg px-3 py-1.5 text-left text-ui hover:bg-hover"
                    >
                      {s.title || t('projects.convs.untitled')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {dragging && (
        <div
          data-testid="project-drop"
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-bg/80 text-ui font-medium text-accent"
        >
          {t('projects.files.drop')}
        </div>
      )}
    </div>
  )
}

/** Mensaje de error de `main` (códigos de `ProjectError`) en lenguaje llano. */
export function errorText(t: ReturnType<typeof useT>, raw: string, maxProjects: number): string {
  const code = projectErrorCode(raw)
  return t(`projects.err.${code}` as MsgKey, { max: maxProjects })
}
