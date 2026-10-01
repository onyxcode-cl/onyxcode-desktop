/** Etiqueta visible del modo de acceso a una carpeta, en el idioma activo (antes `FOLDER_MODE_LABEL_ES` en shared). */
import { t } from '@shared/i18n'
import type { FolderAccessMode } from '@shared/ipc-tasks'

export function folderModeLabel(mode: FolderAccessMode): string {
  return t(mode === 'rw' ? 'tasksSettings.folderMode.rw' : 'tasksSettings.folderMode.ro')
}
