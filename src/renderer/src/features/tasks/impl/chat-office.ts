/** Prepara una tarea aislada con copias del Chat; nunca llama a sendToTask ni crea una sesión del modelo. */
import type { OfficeExtractRequest } from '@shared/attach-office'
import { t } from '@shared/i18n'
import { cw } from './bridge'
import { connectFolder, useTasks } from './store'
import { useUnified } from './unified'
import { useUi } from '../../../stores/ui'
import { chatOfficeAvailable } from '../../chat/office-overdrive'

let preparing = false
export async function prepareOfficeTask(draft: string, files: OfficeExtractRequest[]): Promise<void> {
  if (preparing) throw new Error(t('chat.overdrive.preparing'))
  preparing = true
  try {
    if (!(await chatOfficeAvailable())) throw new Error(t('chat.overdrive.unavailable'))
    const created = await cw('tasks:chatOffice:prepare', { files })
    // No usar openChatFolder: aplicaría el Automático pendiente de otra pantalla.
    useUnified.setState({ wantAuto: false })
    await connectFolder(created.folder.path, false)
    const st = useTasks.getState()
    // connectFolder recoge los errores: resolver la promesa NO demuestra una conexión lista.
    if (st.phase !== 'ready' || st.folder !== created.folder.path || !st.conn?.sandboxed || st.conn.fullAccess)
      throw new Error(st.error || t('chat.overdrive.unavailable'))
    useTasks.setState({
      folders: [...st.folders.filter((f) => f.path !== created.folder.path), created.folder],
      activeTaskId: null,
      taskModel: null,
      taskVariant: null,
      sideChat: null,
      draft,
      attachments: created.files
    })
    useUi.getState().setMode('tasks')
  } finally {
    preparing = false
  }
}
