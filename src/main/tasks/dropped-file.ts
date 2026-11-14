/** Adjuntos arrastrados: recibe bytes, nunca una ruta de origen elegida por el renderer. */
import { extname } from 'node:path'
import { PASTE_MAX_FILE_BYTES } from '@shared/paste-files'
import { t } from '@shared/i18n'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import type { TasksManager } from './manager'
import { BLOCKED_OPEN_EXTENSIONS } from './open-policy'
import { describeDeliverable, writeNewFile } from './files'

export function attachDroppedFile(
  req: { folder: string; name: string; base64: string },
  tasks: Pick<TasksManager, 'assertInsideApproved'>
): TasksDeliverable {
  const { name, base64 } = req
  const invalid = (): never => {
    throw new Error(t('chat.paste.errUnreadable', { name }))
  }
  if (!name || name.length > 255 || /[\\/:<>"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) invalid()
  if (typeof base64 !== 'string' || base64.length > Math.ceil(PASTE_MAX_FILE_BYTES / 3) * 4) invalid()
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) invalid()
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > PASTE_MAX_FILE_BYTES || bytes.toString('base64') !== base64) invalid()
  const ext = extname(name).toLowerCase()
  if (BLOCKED_OPEN_EXTENSIONS.has(ext)) throw new Error(t('chat.paste.errBlocked', { name }))
  // Nombre portátil, sin dispositivos/reservados de Windows; la escritura conserva la extensión.
  let stem = (ext ? name.slice(0, -ext.length) : name).replace(/[<>"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '')
  stem = Array.from(stem).slice(0, 120).join('') || 'archivo'
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = `_${stem}`
  const root = tasks.assertInsideApproved(req.folder)
  return describeDeliverable(writeNewFile(root, stem, ext, bytes), root)
}
