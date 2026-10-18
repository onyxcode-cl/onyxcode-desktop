/**
 * «Proyectos» en la barra lateral del Chat (F8-B185): lista, crear y abrir. Solo escritorio (el celular no los ve: los archivos
 * viven en el Mac y nada de esto se expone al control remoto).
 */
import { FolderPlus, Folders } from 'lucide-react'
import { useEffect } from 'react'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../components/Button'
import { promptDialog } from '../../components/ConfirmDialog'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { ROW, ROW_ACTIVE } from '../../components/ui/recipes'
import { getExtras } from '../../lib/extrasApi'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useProjects } from './store'

/** Pide un nombre, crea el proyecto y abre su pantalla. */
export async function createProjectFlow(t: ReturnType<typeof useT>): Promise<void> {
  const name = await promptDialog({
    title: t('projects.new.title'),
    message: t('projects.new.message'),
    placeholder: t('projects.new.placeholder'),
    confirmLabel: t('projects.new.confirm')
  })
  if (!name || !name.trim()) return
  const p = await useProjects.getState().create(name.trim())
  if (p) useProjects.getState().openProject(p.id)
}

export function ProjectsSidebarSection(): React.JSX.Element | null {
  const t = useT()
  const state = useProjects((s) => s.state)
  const loading = useProjects((s) => s.loading)
  const error = useProjects((s) => s.error)
  const viewId = useProjects((s) => s.viewId)
  const remote = isRemoteSurface()

  useEffect(() => {
    if (!remote) void useProjects.getState().load()
  }, [remote])

  if (remote || !getExtras()) return null
  const list = state?.projects ?? []
  return (
    <section aria-labelledby="projects-sidebar-title" data-testid="projects-sidebar" className="shrink-0 px-2 pb-1">
      <div className="flex h-7 items-center justify-between px-2.5">
        <h2 id="projects-sidebar-title" className="text-meta text-subtle">
          {t('projects.sidebar.title')}
        </h2>
        <IconButton
          label={t('projects.sidebar.new')}
          tooltip
          size="xs"
          onClick={() => void createProjectFlow(t)}
          data-testid="projects-new"
        >
          <FolderPlus size={12} />
        </IconButton>
      </div>
      {!state && loading && (
        <p role="status" className="flex items-center gap-2 px-2.5 py-1.5 text-ui text-muted">
          <Spinner size={12} /> {t('projects.sidebar.loading')}
        </p>
      )}
      {!state && !loading && error && (
        <div role="alert" className="flex flex-col items-start gap-1 px-2.5 py-1.5 text-ui text-danger">
          <span>{t('projects.sidebar.error')}</span>
          <Button variant="link" onClick={() => void useProjects.getState().load()}>
            {t('projects.sidebar.retry')}
          </Button>
        </div>
      )}
      {state && list.length === 0 && <p className="px-2.5 py-1.5 text-ui leading-snug text-muted">{t('projects.sidebar.empty')}</p>}
      {list.length > 0 && (
        <ul className="max-h-48 overflow-y-auto" aria-label={t('projects.sidebar.title')}>
          {list.map((p) => {
            const files = p.files.filter((f) => f.status === 'ready').length
            return (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid="project-row"
                  aria-current={viewId === p.id ? 'page' : undefined}
                  aria-label={t('projects.sidebar.open', { name: p.name })}
                  onClick={() => useProjects.getState().openProject(p.id)}
                  className={`no-drag ${ROW} ${viewId === p.id ? ROW_ACTIVE : ''}`}
                >
                  <Folders size={14} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 text-meta text-subtle">{t('projects.sidebar.meta' as MsgKey, { count: files })}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
