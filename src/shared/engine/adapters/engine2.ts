/**
 * `Engine2Adapter`: ESQUELETO para OpenCode 2.x (`@opencode/cli`, rutas `/api/*`).
 *
 * Todavía no habla con ningún servidor: cada método rechaza con `EngineError('unsupported')`, y no
 * importa `@opencode/client` hasta que se decida la migración (docs/INVESTIGACION-OPENCODE-2.md).
 * Los comentarios `v2:` fijan qué ruta le correspondería a cada método según el spike
 * (docs/SPIKE-OPENCODE-2.md §b-§c); lo marcado «(inferido)» sale del OpenAPI y NO se probó en vivo.
 *
 * Diferencias de fondo que el adaptador real tendrá que absorber (para que la UI no las vea):
 * - Auth: Basic con usuario fijo `opencode`; sin credenciales `/api/*` responde 401.
 * - Carpeta: ya no es `?directory=` sino `?location=…` (o el cwd del proceso); `create` usa `location:{directory}`.
 * - Mensajes: lista de ítems tipados `user|assistant|shell|idle` con `content[]`, otro modelo que el de `Message`/`Part`.
 * - Eventos: `GET /api/event` trae `{id,created,type,location,data}` con tipos `session.text.delta`,
 *   `session.tool.*`, `session.execution.*`…; no hay `message.part.*` ni `session.status`/`idle`: se
 *   reconstruyen a `EngineEvent`.
 * - Permisos: la respuesta exige `sessionID` y usa `decision`; la acción `bash` ahora es `shell`, `task` es `subagent`.
 */
import type { EngineClient } from '../client'
import { EngineError } from '../errors'

/** Rechazo común: `what` dice qué ruta de v2 corresponde, para quien lo implemente. */
function unsupported(what: string): Promise<never> {
  return Promise.reject(new EngineError('unsupported', `Motor 2 aún no implementado: ${what}`))
}

export class Engine2Adapter implements EngineClient {
  readonly kind = 'engine2' as const

  readonly sessions: EngineClient['sessions'] = {
    // v2: GET /api/session (paginada con cursor `{data,cursor}`; `?parentID=` filtra hijos)
    list: () => unsupported('GET /api/session'),
    // v2: GET /api/session/{id}
    get: () => unsupported('GET /api/session/{id}'),
    // v2: POST /api/session con `location:{directory}`, `agent`, `model:{id,providerID}`, `permissions:[{action,resource,effect}]`
    create: () => unsupported('POST /api/session'),
    // v2: PATCH /api/session/{id}
    update: () => unsupported('PATCH /api/session/{id}'),
    // v2: DELETE /api/session/{id}
    remove: () => unsupported('DELETE /api/session/{id}'),
    // v2: no hay ruta propia; GET /api/session?parentID={id}
    children: () => unsupported('GET /api/session?parentID='),
    // v2: GET /api/session/active
    status: () => unsupported('GET /api/session/active'),
    // v2: sin ruta propia (los todos viajan por eventos); a investigar
    todos: () => unsupported('(sin ruta equivalente: todos por eventos)'),
    // v2: GET /api/session/{id}/diff (inferido, no comparado con 1.x)
    diff: () => unsupported('GET /api/session/{id}/diff'),
    // v2: GET /api/session/{id}/message (otro modelo: ítems user|assistant|shell|idle)
    messages: () => unsupported('GET /api/session/{id}/message'),
    // v2: sin ruta por id probada (inferido: filtrar la lista de mensajes)
    message: () => unsupported('GET /api/session/{id}/message (filtrar)'),
    // v2: sin ruta equivalente probada
    deleteMessage: () => unsupported('(sin ruta equivalente)'),
    // v2: POST /api/session/{id}/prompt (responde 200 con el mensaje de usuario y sigue en segundo plano; `delivery`: steer/…)
    send: () => unsupported('POST /api/session/{id}/prompt'),
    // v2: POST /api/session/{id}/command (inferido)
    runCommand: () => unsupported('POST /api/session/{id}/command'),
    // v2: POST /api/session/{id}/interrupt
    abort: () => unsupported('POST /api/session/{id}/interrupt'),
    // v2: POST /api/session/{id}/fork (inferido)
    fork: () => unsupported('POST /api/session/{id}/fork'),
    // v2: POST /api/session/{id}/revert/stage + POST .../revert/commit (inferido)
    revert: () => unsupported('POST /api/session/{id}/revert/stage'),
    // v2: DELETE /api/session/{id}/revert (inferido)
    unrevert: () => unsupported('DELETE /api/session/{id}/revert'),
    // v2: POST /api/session/{id}/compact (inferido)
    summarize: () => unsupported('POST /api/session/{id}/compact')
  }

  readonly permissions: EngineClient['permissions'] = {
    // v2: GET /api/permission/request
    list: () => unsupported('GET /api/permission/request'),
    // v2: POST /api/session/{sid}/permission/{rid}/reply con `{decision:'once'|'always'|'reject', message?}` (exige sessionID)
    reply: () => unsupported('POST /api/session/{sid}/permission/{rid}/reply')
  }

  readonly questions: EngineClient['questions'] = {
    // v2: las preguntas son formularios: GET /api/form
    list: () => unsupported('GET /api/form'),
    // v2: POST /api/session/{sid}/form/{formID}/reply
    reply: () => unsupported('POST /api/session/{sid}/form/{formID}/reply'),
    // v2: sin ruta de rechazo probada (inferido del OpenAPI)
    reject: () => unsupported('(formulario: rechazo sin ruta probada)')
  }

  readonly elicitations: EngineClient['elicitations'] = {
    // Formularios de conectores: solo existen en el motor propio (motor 1 fork); el motor 2 aún no los tiene.
    list: async () => [],
    reply: () => unsupported('POST /mcp/elicitation/{id}/reply')
  }

  readonly events: EngineClient['events'] = {
    // v2: GET /api/event (SSE `{id,created,type,location,data}`; primero `server.connected`, latido `: heartbeat`)
    subscribe: () => {
      throw new EngineError('unsupported', 'Motor 2 aún no implementado: GET /api/event')
    }
  }

  readonly providers: EngineClient['providers'] = {
    // v2: GET /api/provider y GET /api/model (+ /api/model/default)
    list: () => unsupported('GET /api/provider'),
    configured: () => unsupported('GET /api/provider + GET /api/model'),
    // v2: GET /api/integration (inferido)
    authMethods: () => unsupported('GET /api/integration'),
    // v2: POST /api/integration/{id}/connect/key {key} (204)
    setKey: () => unsupported('POST /api/integration/{id}/connect/key'),
    // v2: DELETE /api/credential (inferido)
    removeKey: () => unsupported('DELETE /api/credential'),
    // v2: /api/integration/{id}/connect/oauth[...] (inferido)
    oauthStart: () => unsupported('POST /api/integration/{id}/connect/oauth'),
    oauthFinish: () => unsupported('POST /api/integration/{id}/connect/oauth/…'),
    // v2: POST /api/location/reload (204; recarga plugins/config en caliente)
    refresh: () => unsupported('POST /api/location/reload')
  }

  readonly mcp: EngineClient['mcp'] = {
    // v2: GET /api/mcp
    status: () => unsupported('GET /api/mcp'),
    // v2: POST /api/experimental/mcp/{server}/connect
    connect: () => unsupported('POST /api/experimental/mcp/{server}/connect'),
    // v2: POST /api/experimental/mcp/{server}/disconnect
    disconnect: () => unsupported('POST /api/experimental/mcp/{server}/disconnect'),
    // v2: sin ruta probada para el OAuth de MCP
    authenticate: () => unsupported('(OAuth de MCP sin ruta probada)')
  }

  readonly files: EngineClient['files'] = {
    // v2: GET /api/fs/list
    list: () => unsupported('GET /api/fs/list'),
    // v2: GET /api/fs/read/*
    read: () => unsupported('GET /api/fs/read/*'),
    // v2: GET /api/vcs/* (el estado de archivos pasa a VCS; inferido)
    status: () => unsupported('GET /api/vcs/status'),
    // v2: GET /api/fs/find
    find: () => unsupported('GET /api/fs/find')
  }

  readonly vcs: EngineClient['vcs'] = {
    // v2: GET /api/vcs/* (inferido)
    info: () => unsupported('GET /api/vcs'),
    status: () => unsupported('GET /api/vcs/status'),
    // v2: GET /api/vcs/diff (no comparado con /vcs/diff/raw)
    diff: () => unsupported('GET /api/vcs/diff')
  }

  readonly pty: EngineClient['pty'] = {
    // v2: sin rutas PTY en el spike
    list: () => unsupported('(PTY sin ruta probada)'),
    create: () => unsupported('(PTY sin ruta probada)'),
    resize: () => unsupported('(PTY sin ruta probada)'),
    remove: () => unsupported('(PTY sin ruta probada)')
  }

  readonly config: EngineClient['config'] = {
    // v2: GET /api/config devuelve las FUENTES de config, no la efectiva: hará falta componerla
    get: () => unsupported('GET /api/config')
  }

  readonly agents: EngineClient['agents'] = {
    // v2: GET /api/agent
    list: () => unsupported('GET /api/agent'),
    // v2: GET /api/command
    commands: () => unsupported('GET /api/command')
  }

  // v2: GET /api/info `{version,pid,urls,paths,capabilities}` (con auth)
  health(): Promise<{ ok: boolean; version?: string }> {
    return Promise.resolve({ ok: false })
  }
}
