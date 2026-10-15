/** Contenido de la barra lateral del shell en modo Tareas: carpeta, proyecto, secciones transversales y lista de tareas. */
import { useState } from 'react'
import { BookText, ChevronDown } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { SidebarTreeRegion, useSidebarTree } from '../../../components/SidebarTree'
import { isRemoteSurface } from '../../../lib/platform'
import { FolderMenu } from './FolderMenu'
import { SidebarSections } from './SidebarSections'
import { setProjectPanelOpen, useTasks } from './store'
import { TaskList } from './TaskList'
import { baseName } from './util'

export function TasksSidebar(): React.JSX.Element {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const desktop = !isRemoteSurface()
  const tree = useSidebarTree()
  const [open, setOpen] = useState(true)
  const name = folder ? baseName(folder) : ''
  return (
    <div className="flex flex-col px-1 desk:px-0">
      {desktop ? (
        // Barra lateral 1b: la carpeta es una fila plegable (chevron + carpeta abierta + nombre); sus tareas cuelgan sangradas.
        <SidebarTreeRegion>
          <div
            className="flex h-8 shrink-0 items-center rounded-ctl hover:bg-hover focus-within:bg-hover"
            role={tree && folder ? 'treeitem' : undefined}
            aria-level={tree && folder ? 1 : undefined}
            aria-expanded={tree && folder ? open : undefined}
            aria-label={tree && folder ? name : undefined}
          >
            {folder && (
              <button
                type="button"
                aria-expanded={tree ? undefined : open}
                data-tree-primary={tree ? '' : undefined}
                aria-label={t(open ? 'app.sidebar.collapseProject' : 'app.sidebar.expandProject', { name })}
                onClick={() => setOpen((o) => !o)}
                className="no-drag flex h-8 w-[22px] shrink-0 items-center rounded-ctl pl-2 text-subtle hover:text-fg"
              >
                <ChevronDown
                  size={14}
                  strokeWidth={1.75}
                  className={`transition-transform duration-[var(--dur-fast)] ${open ? '' : '-rotate-90'}`}
                  aria-hidden="true"
                />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <FolderMenu variant="row" />
            </div>
          </div>
        </SidebarTreeRegion>
      ) : (
        <FolderMenu variant="block" />
      )}
      <div className={desktop && !open ? 'hidden' : 'contents'}>
        <SidebarTreeRegion>
          {folder && (
            <button
              type="button"
              onClick={() => setProjectPanelOpen(true)}
              title={t('tasks.sidebar.projectTitle')}
              role={tree ? 'treeitem' : undefined}
              aria-level={tree ? 2 : undefined}
              className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg desk:mt-0.5 desk:rounded-ctl desk:overflow-hidden desk:py-0 desk:whitespace-nowrap${tree ? ' desk:h-[30px] desk:gap-2 desk:px-2 desk:text-ui' : ' desk:h-8 desk:gap-2 desk:px-2 desk:pl-[30px] desk:text-sm'}`}
            >
              <BookText size={13} className="shrink-0 desk:size-[15px]" /> {t('tasks.sidebar.project')}
            </button>
          )}
          <SidebarSections />
        </SidebarTreeRegion>
        <TaskList />
      </div>
    </div>
  )
}
