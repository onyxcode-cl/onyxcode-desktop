import { PASTE_MAX_FILES, PASTE_MAX_FILE_BYTES, PASTE_MAX_TOTAL_BYTES } from '@shared/paste-files'
import { t } from '@shared/i18n'
import { errorMessage } from '../../../lib/opencode'
import { cw } from './bridge'
import { connectFolder, useTasks } from './store'
import { useUnified } from './unified'

let attaching = false

/** Archivos del arrastre real: copia bytes a la carpeta de Tareas y reutiliza sus chips Ver/Presentar. */
export async function attachDroppedFiles(files: File[]): Promise<void> {
  if (!files.length || attaching) return
  attaching = true
  let folder = useTasks.getState().folder
  let taskId = useTasks.getState().activeTaskId
  const currentTarget = (): boolean => useTasks.getState().folder === folder && useTasks.getState().activeTaskId === taskId
  try {
    if (files.length > PASTE_MAX_FILES) throw new Error(t('tasks.drop.tooMany', { max: PASTE_MAX_FILES }))
    if (files.some((file) => file.size > PASTE_MAX_FILE_BYTES)) throw new Error(t('tasks.drop.tooBig', { mb: 25 }))
    if (files.reduce((sum, file) => sum + file.size, 0) > PASTE_MAX_TOTAL_BYTES) throw new Error(t('tasks.drop.tooBig', { mb: 50 }))
    if (!folder) {
      // También funciona en el inicio, sin pedir una carpeta ni enviar mensajes al modelo.
      const created = await cw('tasks:chatFolder:create')
      if (!currentTarget()) return
      useUnified.setState({ wantAuto: false, chatFolder: created.path })
      folder = created.path
      taskId = null
      await connectFolder(created.path, false)
      const current = useTasks.getState()
      if (!currentTarget()) return
      if (current.phase !== 'ready' || current.folder !== created.path) throw new Error(current.error || t('tasks.act.serverNotReady'))
      useTasks.setState({ folders: [...current.folders.filter((f) => f.path !== created.path), created] })
    }
    useTasks.setState({ error: null })
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.byteLength > PASTE_MAX_FILE_BYTES) throw new Error(t('tasks.drop.tooBig', { mb: 25 }))
      if (!currentTarget()) return // no adjuntar a otro chat tras cambiar de carpeta o tarea
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const saved = await cw('tasks:attachDroppedFile', { folder, name: file.name, base64: btoa(binary) })
      if (!currentTarget()) return
      useTasks.setState((s) => ({ attachments: [...s.attachments, saved] }))
    }
  } catch (error) {
    if (currentTarget()) useTasks.setState({ error: errorMessage(error) })
  } finally {
    attaching = false
  }
}
