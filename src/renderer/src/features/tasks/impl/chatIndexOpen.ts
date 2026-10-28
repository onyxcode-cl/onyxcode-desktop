/** Modo unificado: abrir un chat del índice, conectando antes su carpeta si ya no es la conectada. */
import { t } from '@shared/i18n'
import type { ChatIndexEntry } from '@shared/ipc-tasks'
import { openTask } from './actions'
import { useChatIndex } from './chatIndex'
import { connectFolder, useTasks } from './store'

const samePath = (a: string | null | undefined, b: string): boolean =>
  !!a && a.replace(/\\/g, '/').replace(/\/+$/, '') === b.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * Clic en una entrada del índice. Si su carpeta ya está conectada se abre directo; si no, `connectFolder(folder, false)`
 * (respeta los consentimientos; nunca con Control total desde aquí) y luego se abre la sesión. Un fallo deja un mensaje y no toca la lista.
 */
export async function openIndexedChat(entry: ChatIndexEntry): Promise<boolean> {
  const idx = useChatIndex
  if (idx.getState().opening) return false
  idx.setState({ opening: { folder: entry.folder, sessionId: entry.sessionId }, error: null })
  try {
    const st = useTasks.getState()
    if (!(samePath(st.folder, entry.folder) && st.phase === 'ready' && !st.fullAccess)) {
      await connectFolder(entry.folder, false)
      const now = useTasks.getState()
      if (!(samePath(now.folder, entry.folder) && now.phase === 'ready')) {
        idx.setState({ error: t('tasks.unified.openFailed') })
        return false
      }
    }
    await openTask(entry.sessionId)
    return true
  } catch {
    idx.setState({ error: t('tasks.unified.openFailed') })
    return false
  } finally {
    idx.setState({ opening: null })
  }
}
