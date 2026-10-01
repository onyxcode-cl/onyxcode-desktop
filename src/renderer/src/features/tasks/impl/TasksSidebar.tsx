/** Contenido de la barra lateral del shell en modo Tareas: carpeta, proyecto, secciones transversales y lista de tareas. */
import { BookText } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { FolderMenu } from './FolderMenu'
import { SidebarSections } from './SidebarSections'
import { setProjectPanelOpen, useTasks } from './store'
import { TaskList } from './TaskList'

export function TasksSidebar(): React.JSX.Element {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  return (
    <div className="flex flex-col px-1">
      <FolderMenu variant="block" />
      {folder && (
        <button
          type="button"
          onClick={() => setProjectPanelOpen(true)}
          title={t('tasks.sidebar.projectTitle')}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg"
        >
          <BookText size={13} /> {t('tasks.sidebar.project')}
        </button>
      )}
      <SidebarSections />
      <TaskList />
    </div>
  )
}
