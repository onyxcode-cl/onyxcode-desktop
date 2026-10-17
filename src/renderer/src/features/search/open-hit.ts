/**
 * Abrir un resultado de la búsqueda: cambia al modo, abre la conversación y baja hasta el mensaje (lo resalta un momento).
 */
import { openChatSession } from '../chat/actions'
import { useCode } from '../code/impl/store'
import { useUi } from '../../stores/ui'
import type { SearchGroup, SearchHit } from './search-index'

const FLASH_MS = 2200
const WAIT_MS = 5000

/** Busca el mensaje en pantalla (la conversación puede tardar en pintarse) y lo centra. Devuelve si lo encontró. */
export function scrollToMessage(anchor: string): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const find = (): void => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find((e) => e.dataset.messageId === anchor)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.setAttribute('data-search-flash', '')
        // Con `content-visibility` la altura real se conoce al pintar: se centra una segunda vez.
        setTimeout(() => el.scrollIntoView({ block: 'center' }), 250)
        setTimeout(() => el.removeAttribute('data-search-flash'), FLASH_MS)
        resolve(true)
      } else if (Date.now() - started > WAIT_MS) resolve(false)
      else setTimeout(find, 100)
    }
    find()
  })
}

export async function openSearchHit(group: SearchGroup, hit?: SearchHit): Promise<void> {
  const ui = useUi.getState()
  ui.openSettings(false)
  if (group.mode === 'chat') {
    ui.setMode('chat')
    await openChatSession(group.sessionId)
  } else {
    ui.setMode('code')
    const code = useCode.getState()
    if (code.directory !== group.directory) {
      if (code.openDirectories.includes(group.directory)) await code.focusProject(group.directory)
      else await code.openProject(group.directory)
    }
    await useCode.getState().selectSession(group.sessionId)
  }
  if (hit) await scrollToMessage(hit.anchor)
}
