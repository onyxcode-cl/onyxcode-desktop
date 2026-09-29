/** Contenido de la barra lateral del shell en modo Cowork: carpeta, proyecto, secciones transversales y lista de tareas. */
import { BookText } from 'lucide-react'
import { FolderMenu } from './FolderMenu'
import { SidebarSections } from './SidebarSections'
import { setProjectPanelOpen, useCowork } from './store'
import { TaskList } from './TaskList'

export function CoworkSidebar(): React.JSX.Element {
  const folder = useCowork((s) => s.folder)
  return (
    <div className="flex flex-col px-1">
      <FolderMenu variant="block" />
      {folder && (
        <button
          type="button"
          onClick={() => setProjectPanelOpen(true)}
          title="Instrucciones y memoria de esta carpeta"
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg"
        >
          <BookText size={13} /> Proyecto e instrucciones
        </button>
      )}
      <SidebarSections />
      <TaskList />
    </div>
  )
}
