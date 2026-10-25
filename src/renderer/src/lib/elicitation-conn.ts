/**
 * Conexión al motor para las rutas de formularios de conectores (`GET /mcp/elicitation`, `POST …/reply`), que el SDK fijado no trae
 * y por eso se llaman con `fetch` (ver `@shared/mcp-elicitation`). Misma URL y autorización que el cliente SDK del sidecar.
 */
import type { ElicitationConn } from '@shared/mcp-elicitation'
import { useServer } from '../stores/server'

export function elicitationConn(): ElicitationConn | null {
  const c = useServer.getState().connection
  return c ? { baseUrl: c.baseUrl, authorization: c.authorization } : null
}
