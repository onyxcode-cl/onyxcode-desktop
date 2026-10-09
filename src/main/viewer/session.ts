/**
 * Sesión aislada del visor de documentos (Fase 0 del plan del visor, `docs/SEGURIDAD.md`).
 *
 * - Partición propia EN MEMORIA (`doc-viewer`, sin `persist:`): no comparte cookies, storage ni
 *   caché con la app ni con el navegador integrado.
 * - `webRequest` cancela TODO lo que no sea el esquema propio del visor: ni un docx con una imagen
 *   enlazada a `http://127.0.0.1:<puerto>` puede llegar a tocar el sidecar o los proxys de Tareas.
 * - Permisos denegados, descargas bloqueadas: mismo patrón que `extras/artifact-window.ts`.
 */
import { session, type Session } from 'electron'
import { VIEWER_SCHEME } from '../security/app-protocol'

const PARTITION = 'doc-viewer'

let configured: Session | null = null

export function viewerSession(): Session {
  if (configured) return configured
  const ses = session.fromPartition(PARTITION, { cache: false })

  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${VIEWER_SCHEME}:`) })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())

  configured = ses
  return ses
}
