/**
 * Plugin `lazunox-subagent-guard`: contención de subagentes (`task`) y de los rechazos dentro de
 * Code Mode (`execute`) en el motor 1.19. Se escribe en `userData/opencode-config/plugins/` junto a
 * `lazunox-plan-gate`, así que corre en TODOS los servidores de la app (sidecar principal, Overdrive
 * y Control total). Aquí solo vive el TEXTO del plugin; lo escribe `prepareOpencodeConfigDir`
 * (`src/main/tasks/opencode-config.ts`, ZONA INTOCABLE: una línea).
 *
 * POR QUÉ HACE FALTA (prueba real del 2026-10-22, `docs/PRUEBA-CODE-MODE-Y-SEGUNDO-PLANO.md`): un
 * padre con `bash: deny` lanzó una hija `general` que ejecutó `bash` sin preguntar. Leyendo el
 * binario 1.19 (`TaskTool.execute`), el permiso de una hija es
 * `merge(permisos del AGENTE de la hija, permisos de SU sesión)`, y la sesión de la hija solo hereda
 * del padre las reglas de `session.permission` que sean `deny` o `external_directory` (más
 * `todowrite: deny` y `task: deny` si el subagente no los declara). Los permisos del AGENTE del
 * padre (los de `agents/*.md` y los de la config inline) NO se heredan. Por eso hay dos capas:
 *
 *  1. Estática (los `.md`): `tasks.md` solo puede lanzar `lazunox-helper` (permiso `task` con lista
 *     blanca en vez de `allow`), `computer.md` tiene `task: deny` y `chat.md` `'*': deny`. Los
 *     agentes integrados `general` y `explore` quedan fuera de esos tres.
 *  2. Dinámica (este plugin, `tool.execute.before` sobre `task`): antes de crear la hija se calcula
 *     el permiso efectivo del padre (agente + sesión) y el de la hija (agente + las reglas que el
 *     motor le añade) y se BLOQUEA el `task` si la hija podría hacer algo con MÁS libertad que el
 *     padre (deny < ask < allow) en alguna herramienta o patrón conocido. Cubre también a Code, donde
 *     el padre puede ser cualquier agente (`plan` con `edit: deny` no puede lanzar `general`).
 *
 * CÓDIGO MODE (`execute`): un `reject` del usuario en una llamada interna se devuelve al programa como
 * excepción que el propio programa puede atrapar y seguir. El plugin escucha `permission.asked` y
 * `permission.replied` (gancho `event`; `permission.ask` NO existe en 1.19 aunque la documentación
 * lo liste), y al ver un `reject` sobre una llamada que pertenece a un `execute` en curso: (a) marca ESE
 * `execute` como revocado y bloquea toda llamada interna posterior suya (`callID` = `<execute>/<n>`),
 * y (b) aborta la sesión (`session.abort`), que es lo que pasa tras un rechazo fuera de Code Mode.
 *
 * DE DONDE SALEN LOS DATOS: en Code y Control total, del cliente del motor que recibe el plugin (HTTP al propio
 * servidor). En Tareas con sandbox Seatbelt NO deja salir al puerto del motor (y no debe: la contraseña del motor es
 * legible desde dentro por KERN_PROCARGS2), así que la sesión y los agentes llegan por el canal de solo lectura de main
 * (`LAZUNOX_GUARD_URL`/`LAZUNOX_GUARD_TOKEN`, `src/main/tasks/guard-info.ts`, F8-B208). La decisión es la misma.
 *
 * Todo es fail-closed: si no se puede evaluar (cliente sin API, agente desconocido, error del motor),
 * el `task` se bloquea. Qué NO garantiza: ver `docs/SEGURIDAD.md` §3 sexagies.
 */

/** Herramientas/permisos que siempre se comparan además de las claves que aparezcan en las reglas. */
export const SUBAGENT_GUARD_BASE_KEYS = [
  '*',
  'bash',
  'edit',
  'write',
  'read',
  'glob',
  'grep',
  'list',
  'webfetch',
  'websearch',
  'task',
  'skill',
  'question',
  'external_directory',
  'doom_loop',
  'computer_*',
  'browser_*'
] as const

export function subagentGuardPluginSource(): string {
  return `// Generado por la app: no editar (se regenera al arrancar).
// Contencion de subagentes (task) y de rechazos dentro de Code Mode (execute). Ver
// src/main/opencode/subagent-guard.ts para el contexto completo y las garantias.
const BASE_KEYS = ${JSON.stringify(SUBAGENT_GUARD_BASE_KEYS)}
const RANK = { deny: 0, ask: 1, allow: 2 }
const AGENTS_TTL_MS = 10000
const REVOKE_TTL_MS = 600000
const MAX_TRACKED = 500
const BS = String.fromCharCode(92)
// Canal de solo lectura de main (F8-B208): solo en servidores de Tareas con sandbox, donde Seatbelt no deja al cliente
// del plugin llegar al puerto del motor. Sin la variable (Code, Control total) se usa el cliente del motor.
const GUARD_URL = process.env.LAZUNOX_GUARD_URL || ''
const GUARD_TOKEN = process.env.LAZUNOX_GUARD_TOKEN || ''
const GUARD_TIMEOUT_MS = 5000
const viaGuard = async (path) => {
  const r = await fetch(GUARD_URL + path, { headers: { authorization: 'Bearer ' + GUARD_TOKEN }, redirect: 'error', signal: AbortSignal.timeout(GUARD_TIMEOUT_MS) })
  return { status: r.status, json: r.status === 200 ? await r.json() : null }
}
const SPECIAL = '.+^$' + String.fromCharCode(123, 125) + '()|[]' + BS

// Mismo comparador que el motor 1.19 (Wildcard.match): * = cualquier cosa, ? = un caracter y un " *"
// final es opcional. Sin distinguir nada mas.
function wmatch(str, pattern) {
  const s = String(str).split(BS).join('/')
  const p = String(pattern).split(BS).join('/')
  let out = ''
  for (const ch of p) {
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if (SPECIAL.includes(ch)) out += BS + ch
    else out += ch
  }
  if (out.endsWith(' .*')) out = out.slice(0, -3) + '( .*)?'
  return new RegExp('^' + out + '$', 's').test(s)
}

// Mismo criterio que el motor: gana la ULTIMA regla que coincide; sin regla = ask.
function evaluate(permission, pattern, rules) {
  let hit
  for (const r of rules) if (wmatch(permission, r.permission) && wmatch(pattern, r.pattern)) hit = r
  return hit ? hit.action : 'ask'
}

const validRules = (v) =>
  Array.isArray(v) &&
  v.every((r) => r && typeof r.permission === 'string' && typeof r.pattern === 'string' && RANK[r.action] !== undefined)

// Permiso efectivo de la hija: el de su agente + lo que el motor le anade en TaskTool.execute
// (todowrite/task en deny si el subagente no los declara, y de la sesion del padre solo los deny y
// external_directory). Ver lt() en el binario 1.19.
function childRules(agentRules, parentSessionRules) {
  const extra = []
  if (!agentRules.some((r) => r.permission === 'todowrite')) extra.push({ permission: 'todowrite', pattern: '*', action: 'deny' })
  if (!agentRules.some((r) => r.permission === 'task')) extra.push({ permission: 'task', pattern: '*', action: 'deny' })
  const inherited = parentSessionRules.filter((r) => r.permission === 'external_directory' || r.action === 'deny')
  return agentRules.concat(inherited, extra)
}

// Pares (herramienta, patron) donde la hija tendria MAS libertad que el padre.
function escalations(parent, child) {
  const all = parent.concat(child)
  const keys = new Set(BASE_KEYS)
  for (const r of all) keys.add(r.permission)
  const out = []
  for (const k of keys) {
    const pats = new Set(['*'])
    for (const r of all) if (r.permission === k) pats.add(r.pattern)
    for (const p of pats) {
      const a = evaluate(k, p, parent)
      const b = evaluate(k, p, child)
      if (RANK[b] > RANK[a]) out.push(k + (p === '*' ? '' : ' ' + p) + ' (padre: ' + a + ', subagente: ' + b + ')')
    }
  }
  return out
}

const baseOf = (callID) => {
  if (typeof callID !== 'string') return ''
  const i = callID.indexOf('/')
  return i > 0 ? callID.slice(0, i) : callID
}

export default {
  id: 'lazunox-subagent-guard',
  server: async (pluginInput) => {
    const client = pluginInput && pluginInput.client
    let agentsCache = null
    const executing = new Map() // callID de un execute en curso -> sessionID
    const pending = new Map() // requestID de un permiso pendiente -> { sessionID, base, permission }
    const revoked = new Map() // sessionID|base -> instante del rechazo
    const cap = (m) => {
      if (m.size >= MAX_TRACKED) m.delete(m.keys().next().value)
    }

    // El cliente del plugin en el motor 1.19 usa { path: { id } } y responde { data } (verificado con
    // el binario real); se prueba tambien la forma plana por si cambia en otra version.
    // Devuelve { info, reached }: reached = false si ninguna llamada llego al motor (excepcion, o { error }
    // sin respuesta HTTP), p. ej. un sandbox sin salida a su propio puerto (F8-B208). Solo cambia el motivo
    // del bloqueo, no la decision: sin info siempre se bloquea.
    const sessionGet = async (id) => {
      if (GUARD_URL) {
        try {
          const r = await viaGuard('/session?id=' + encodeURIComponent(id))
          if (r.status === 200 && r.json && typeof r.json === 'object' && r.json.id === id) return { info: r.json, reached: true }
          return { info: null, reached: r.status === 404 || r.status === 400 }
        } catch {
          return { info: null, reached: false }
        }
      }
      let reached = false
      for (const args of [{ path: { id } }, { sessionID: id }]) {
        try {
          const r = await client.session.get(args)
          if (!(r && typeof r === 'object' && 'response' in r && !r.response)) reached = true
          const info = r && typeof r === 'object' && 'data' in r ? r.data : r
          if (info && typeof info === 'object' && info.id === id) return { info, reached: true }
        } catch {
          // probar la otra forma
        }
      }
      return { info: null, reached }
    }
    const lastUserAgent = async (id) => {
      // Con el canal de main, el agente de la raiz ya viene resuelto en la sesion (misma precedencia).
      if (GUARD_URL) return null
      for (const args of [{ path: { id }, query: { limit: 30 } }, { sessionID: id, limit: 30 }]) {
        try {
          const r = await client.session.messages(args)
          const list = r && typeof r === 'object' && 'data' in r ? r.data : r
          if (!Array.isArray(list)) continue
          const users = list
            .filter((m) => m && m.info && m.info.role === 'user' && typeof m.info.agent === 'string')
            .sort((a, b) => ((b.info.time && b.info.time.created) || 0) - ((a.info.time && a.info.time.created) || 0))
          return users.length ? users[0].info.agent : null
        } catch {
          // probar la otra forma
        }
      }
      return null
    }
    const agents = async () => {
      const now = Date.now()
      if (agentsCache && now - agentsCache.at < AGENTS_TTL_MS) return agentsCache.map
      let list = null
      try {
        if (GUARD_URL) {
          const r = await viaGuard('/agents')
          list = r.status === 200 ? r.json : null
        } else {
          const r = await client.app.agents()
          list = r && typeof r === 'object' && 'data' in r ? r.data : r
        }
      } catch {
        list = null
      }
      if (!Array.isArray(list)) return null
      const map = new Map()
      for (const a of list) if (a && typeof a.name === 'string' && validRules(a.permission)) map.set(a.name, a.permission)
      agentsCache = { at: now, map }
      return map
    }

    const guardTask = async (input, output) => {
      const deny = (why) => {
        throw new Error('Lanzamiento de subagente bloqueado por Lazunox: ' + why)
      }
      const type = output && output.args && output.args.subagent_type
      if (typeof type !== 'string' || !type) deny('falta subagent_type.')
      if (!GUARD_URL && (!client || !client.session || !client.app)) deny('no se puede verificar el permiso del subagente.')
      const got = await sessionGet(input.sessionID)
      const session = got.info
      if (!session) deny(got.reached ? 'sesion desconocida.' : 'no se pudo consultar la sesion al motor (sin conexion con el propio servidor).')
      const map = await agents()
      if (!map) deny('no se pudo leer la lista de agentes.')
      const childAgent = map.get(type)
      if (!childAgent) deny('el agente "' + type + '" no existe.')
      let parentName = typeof session.parentID === 'string' && session.parentID ? session.agent : null
      if (typeof parentName !== 'string' || !parentName) parentName = await lastUserAgent(input.sessionID)
      if (typeof parentName !== 'string' || !parentName) parentName = typeof session.agent === 'string' ? session.agent : null
      const parentAgent = parentName ? map.get(parentName) : null
      if (!parentAgent) deny('no se pudo determinar el agente que lo lanza.')
      const parentSession = validRules(session.permission) ? session.permission : []
      const parent = parentAgent.concat(parentSession)
      // task_id REANUDA una sesion existente en vez de crear una: el motor no comprueba de quien es ni con que permisos nacio. Sin esta
      // comprobacion, el guardian calcularia los permisos de una hija NUEVA y se saltaria las reglas de la sesion reanudada (de una hija vieja
      // que nacio con otros permisos, o de una sesion ajena mas permisiva). Solo se reanuda una hija DIRECTA de quien llama, y sus permisos
      // son los de esa sesion.
      const resume = output.args.task_id
      let kidSession = parentSession
      if (resume !== undefined && resume !== null && resume !== '') {
        if (typeof resume !== 'string') deny('task_id no es valido.')
        const t = await sessionGet(resume)
        if (!t.info) deny('no se pudo verificar la sesion a reanudar (task_id).')
        if (t.info.parentID !== input.sessionID) deny('task_id no es un subagente de esta sesion.')
        kidSession = validRules(t.info.permission) ? t.info.permission : []
      }
      const child = childRules(childAgent, kidSession)
      const bad = escalations(parent, child)
      if (bad.length) {
        deny(
          'el subagente "' + type + '" tendria mas libertad que quien lo lanza (' + parentName + '): ' + bad.slice(0, 5).join('; ') +
            '. Usa un subagente con permisos propios y minimos (p. ej. lazunox-helper).'
        )
      }
    }

    return {
      event: async ({ event }) => {
        const type = event && event.type
        const p = (event && event.properties) || {}
        if (type === 'permission.asked') {
          const callID = p.tool && p.tool.callID
          if (typeof p.id === 'string' && typeof callID === 'string') {
            cap(pending)
            pending.set(p.id, { sessionID: p.sessionID, base: baseOf(callID), permission: p.permission })
          }
          return
        }
        if (type !== 'permission.replied') return
        const info = pending.get(p.requestID)
        pending.delete(p.requestID)
        if (p.reply !== 'reject') return
        // Los execute afectados: el de la peticion si la conocemos; si no, todos los de esa sesion.
        const bases = []
        if (info) {
          if (info.permission !== 'execute' && executing.get(info.base) === info.sessionID) bases.push(info.base)
        } else {
          for (const [base, sid] of executing) if (sid === p.sessionID) bases.push(base)
        }
        if (!bases.length) return
        const now = Date.now()
        for (const base of bases) {
          cap(revoked)
          revoked.set(p.sessionID + '|' + base, now)
        }
        // Tras un rechazo el turno se detiene (igual que fuera de Code Mode).
        try {
          Promise.resolve(client.session.abort({ path: { id: p.sessionID } })).catch(() => {})
        } catch {
          // best effort: el bloqueo de llamadas internas ya esta puesto
        }
      },
      'tool.execute.before': async (input, output) => {
        const sid = input && input.sessionID
        const callID = input && input.callID
        if (input.tool === 'execute' && typeof callID === 'string') {
          cap(executing)
          executing.set(callID, sid)
          return
        }
        // Llamada interna de un execute (callID = <execute>/<n>) cuyo programa ya fue rechazado.
        if (typeof callID === 'string' && callID.indexOf('/') > 0) {
          const key = sid + '|' + baseOf(callID)
          const at = revoked.get(key)
          if (at !== undefined) {
            if (Date.now() - at < REVOKE_TTL_MS) {
              throw new Error('El usuario rechazo un permiso dentro de este programa de Code Mode: no se ejecutan mas herramientas.')
            }
            revoked.delete(key)
          }
        }
        if (input.tool === 'task') await guardTask(input, output)
      },
      'tool.execute.after': async (input) => {
        if (input && input.tool === 'execute' && typeof input.callID === 'string') {
          executing.delete(input.callID)
          revoked.delete(input.sessionID + '|' + input.callID)
        }
      }
    }
  }
}
`
}
