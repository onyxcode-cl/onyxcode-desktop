#!/usr/bin/env node
/**
 * Servidor OpenCode FALSO y determinista para tests E2E (sin LLM ni costo).
 *
 * Imita las rutas de `opencode serve` (v1.18.32) que usa la app: /global/*, /session/*,
 * /permission, /question, /provider, /config, /auth, /mcp, /file, /command, /experimental/session.
 * Solo depende de Node (http/crypto/fs). Estado en memoria por proceso.
 *
 * Lanzamiento (igual que el real):  opencode serve --port <n> --hostname <h> [--cors <origin>]...
 *   OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD  -> HTTP Basic (401 si no coincide)
 *   OPENCODE_CONFIG_CONTENT / OPENCODE_CONFIG            -> config (mcp, ...) que devuelven /config y /mcp
 *   FAKE_OPENCODE_HEARTBEAT_MS                           -> latido SSE (por defecto 10000; 0 = sin latido)
 *   OPENCODE_AUTH_CONTENT / XDG_DATA_HOME                -> credenciales, como el real (1.18.33): al arrancar, si hay
 *                                                           OPENCODE_AUTH_CONTENT (JSON) sus claves entran en authProviders
 *                                                           y el contenido SUSTITUYE al auth.json (no se mezcla); si no, se
 *                                                           lee $XDG_DATA_HOME/opencode/auth.json. PUT /auth/{id} y el callback
 *                                                           OAuth ESCRIBEN ese fichero (0600). El reset vuelve a las
 *                                                           credenciales de arranque.
 *
 * API de control (misma auth), prefijo /__e2e/:
 *   POST emit       { type, properties, directory?, id? } | { directory, payload } | { events: [...] }
 *   POST script     { steps:[...], model?, sessionID?, match?, forModel?: 'proveedor/modelo', sticky?, title?, startDelayMs?, cost? } | { scripts:[...] }
 *                   `forModel` solo lo toma el prompt_async cuyo `body.model` coincide (comparar modelos: un guion por modelo).
 *   POST session-usage { sessions:[{ directory, title?, agent?, model?, tokens?, cost?, agoMs?, parentID? }] }  crea sesiones con uso registrado (Ajustes › Uso)
 *   GET  status     resumen del estado
 *   POST drop-sse   corta todos los streams SSE ({ blockMs? } rechaza SSE nuevos ese tiempo)
 *   GET  requests   ?limit=100&path=<prefijo>&method=GET&since=<seq>
 *   GET  config     OPENCODE_CONFIG_CONTENT recibido: { raw, content, config }
 *   GET  unknown-routes
 *   GET  env        { xdgDataHome, authContent:{ providers:[ids], allPlaceholder }, flags:{ codeMode, backgroundSubagents, mcpElicitation } }: NUNCA devuelve valores secretos;
 *                   allPlaceholder = todas las claves de OPENCODE_AUTH_CONTENT son centinelas (sandboxed-placeholder-*)
 *   POST set        { failPrompt: N|-1|0 (prompt_async corta la conexión N veces / siempre / nunca), sessionStatus:{id:'idle'|'busy'}, mcp:{name:{status,error?}}, config:{...}, todos:{sessionID:[...]}, fileStatus:{dir:[...]},
 *                     commands:[...], connectedProviders:[ids] }
 *   POST log        { stream?:'stdout'|'stderr', text }: escribe `text` (tal cual, más salto de línea) en la salida del proceso,
 *                   que la app recoge como registro del motor (prueba de Diagnóstico)
 *   GET  access-responses  respuestas que recibió el paso de guion `request-access` (tarjeta de plan/acceso de Control total)
 *   POST reset      vuelve al estado inicial (aborta ejecuciones; no corta los SSE)
 *   --- Subagentes en segundo plano y Code Mode (motor 1.19 con OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS / _CODE_MODE) ---
 *   POST bg-set     { delayMs?, hold?, failNext?, failMessage? } valores por defecto de los HIJOS en segundo plano que se creen DESPUÉS:
 *                   `delayMs` = cuánto tardan en arrancar su guion (0 = al instante), `hold: true` = esperan hasta `bg-release`,
 *                   `failNext: N|-1` = los próximos N hijos fallan (con `failMessage`) en cuanto se abre su compuerta.
 *   POST bg-release { sessionID? }  abre la compuerta de un hijo (o de todos los que esperan): salta el retraso y el `hold`.
 *   POST bg-fail    { sessionID, message? }  fuerza el fallo de un hijo en curso (session.error + aviso de error al padre).
 *   POST restart    { mode?: 'lose'|'resume', blockMs? } simula reiniciar el servidor con hijos en curso: aborta TODAS las ejecuciones, corta
 *                   los SSE y pierde los permisos «siempre». 'lose' (1.19, por defecto): los trabajos se pierden SIN aviso al padre.
 *                   'resume' (2.x): los hijos en segundo plano se reanudan desde cero y avisan al padre al terminar.
 *   GET  bg         lista de trabajos: { childID, parentID, status, background, generation, delayMs, hold, notified, ... }
 *   POST /experimental/session/{id}/background  (ruta del motor, no de control) manda al fondo los subagentes en primer plano que bloquean
 *                   a esa sesión; responde true si alguno pasó al fondo.
 *
 * Pasos de un guion (todos aceptan delayMs): text|reasoning {text|deltas, chunkDelayMs}, tool {tool,input,output,title,
 * error,metadata}, request-access {apps?,plan?,reason?} (espera la tarjeta de acceso de Control total, solo ahí), permission {permission,patterns,tool?,input?,output?}, question {questions}, todo {todos},
 * elicitation {server?,message?,fields?,expiresInMs?,requestID?}: formulario de un conector (MCP `elicitation`, motor propio): publica
 *   `mcp.elicitation.asked {id,sessionID,server,callID,message,fields,expiresAt}` y espera `POST /mcp/elicitation/{id}/reply` (valida como el
 *   motor: obligatorios y tope de `maxLength`; 400 con `errors:[{campo,motivo}]` deja el formulario abierto, 404 si ya no existe). Abortar la
 *   sesión publica `mcp.elicitation.rejected {reason:'abort'}`. Un rechazo inmediato (secreto, esquema, ambiguo) se simula con el paso `emit`
 *   de `mcp.elicitation.rejected` SIN `asked` previo. Lo recibido se ve en GET /__e2e/state (`elicitationReplies`, solo nombres de campo).
 * error {message,name?,statusCode?}, retry {attempt,message,nextMs}, title {title}, emit {event:{type,properties}},
 * child {title,text,agent?}, delay {ms}, fs {op:'write'|'delete', path, content?} (escribe o borra un archivo REAL, siempre
 * dentro del `directory` de la sesión: una ruta que salga de él hace fallar el paso; sirve para probar puntos de restauración).
 *   task {title?, prompt?, agent?, steps?|text?, background?, childDelayMs?, hold?, fail?, notify?}: herramienta `task` del motor. Crea una sesión
 *   hija (parentID). Con `background: true` el padre recibe de inmediato «Background task started» y el hijo corre aparte; al terminar
 *   (completed o error; la cancelación NO avisa, como el motor) se inyecta en el padre un mensaje de usuario sintético y se arranca un
 *   turno nuevo (consume el siguiente guion encolado, p. ej. con `match: 'Background task'`). Sin `background` el padre espera al hijo
 *   (se puede mandar al fondo con la ruta experimental; abortar al padre cancela al hijo). `fail: 'msg'` hace fallar a ese hijo.
 *   code_mode {calls:[{tool,input?,output?,error?,delayMs?}], code?, value?, rules?:[{permission,pattern?,action}], tool?}: herramienta
 *   `execute` ({code}) del Code Mode del 1.19. Cada llamada interna a una herramienta MCP (`servidor_herramienta`) evalúa las reglas
 *   (config `permission`, `permission` de la sesión y `rules`; la última que casa gana, por defecto ask): allow = sin pregunta, deny =
 *   herramienta invisible (UnknownTool), ask = permission.asked {permission:<clave MCP>, patterns:['*'], always:['*']} y espera.
 *   La metadata de la parte trae `toolCalls:[{tool,status,input?}]` actualizada en cada llamada.
 */
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Credenciales de arranque: OPENCODE_AUTH_CONTENT (sustituye) o $XDG_DATA_HOME/opencode/auth.json. */
function authFileOf(env) {
  return env.XDG_DATA_HOME ? join(env.XDG_DATA_HOME, 'opencode', 'auth.json') : null
}

function parseAuthObject(raw) {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export function initialAuth(env) {
  if (typeof env.OPENCODE_AUTH_CONTENT === 'string' && env.OPENCODE_AUTH_CONTENT) return parseAuthObject(env.OPENCODE_AUTH_CONTENT) ?? {}
  const file = authFileOf(env)
  if (!file) return {}
  try {
    return parseAuthObject(readFileSync(file, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

function initialConnected() {
  try {
    const list = JSON.parse(readFileSync(new URL('./connected.json', import.meta.url), 'utf8'))
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

export const FAKE_VERSION = '1.18.32'
const DEFAULT_MODEL = { providerID: 'fake', modelID: 'fake-model' }

// ───────────────────────────── argumentos ─────────────────────────────

export function parseArgs(argv) {
  const out = { command: null, port: 0, hostname: '127.0.0.1', cors: [], version: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const eq = a.indexOf('=')
    const [flag, inline] = a.startsWith('--') && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined]
    const value = () => (inline !== undefined ? inline : argv[++i])
    if (flag === '--version' || flag === '-v') out.version = true
    else if (flag === '--port') out.port = Number(value()) || 0
    else if (flag === '--hostname') out.hostname = String(value() ?? out.hostname)
    else if (flag === '--cors') {
      const v = value()
      if (v) out.cors.push(v)
    } else if (!a.startsWith('-') && !out.command) out.command = a
    // flags desconocidos: se ignoran (y su posible valor se toma como posicional inofensivo)
  }
  return out
}

// ───────────────────────────── servidor ─────────────────────────────

export function createFakeServer(options = {}) {
  const env = options.env ?? process.env
  const cors = new Set(options.cors ?? [])
  const heartbeatMs = env.FAKE_OPENCODE_HEARTBEAT_MS !== undefined ? Number(env.FAKE_OPENCODE_HEARTBEAT_MS) : 10_000
  const username = env.OPENCODE_SERVER_USERNAME || 'opencode'
  const password = env.OPENCODE_SERVER_PASSWORD || ''
  const startedAt = Date.now()
  const startupAuth = initialAuth(env)
  const persistAuth = () => {
    const file = authFileOf(env)
    if (!file) return
    try {
      mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
      writeFileSync(file, JSON.stringify(state.authProviders), { mode: 0o600 })
    } catch {
      // sin disco: el falso sigue con el estado en memoria
    }
  }
  let state = freshState()

  function freshState() {
    return {
      seq: { session: 0, message: 0, part: 0, permission: 0, question: 0, elicitation: 0, call: 0, request: 0 },
      sessions: new Map(), // id -> { info, messages:[{info,parts}], status, run, chain }
      permissions: new Map(), // id -> { req, resolve }
      questions: new Map(),
      elicitations: new Map(), // id -> { req, resolve } (formularios de conectores pendientes)
      elicitationReplies: [], // { requestID, action, fields } (solo NOMBRES de campo: los valores no se guardan)
      accessResponses: [], // respuestas a pasos `request-access` (lo que recibió el "MCP")
      scripts: [],
      failPrompt: 0, // prompt_async corta la conexión (red caída) las próximas N veces; -1 = siempre
      todos: new Map(),
      mcpUser: {}, // conectar/desconectar de la app (se pierde en dispose)
      mcpForced: {}, // fijado por /__e2e/set (persistente)
      mcpAdded: {}, // POST /mcp
      configPatch: {},
      authProviders: { ...startupAuth },
      // `connected.json` junto al falso (lista de ids; el sidecar no hereda variables de entorno ajenas) fija los proveedores conectados desde el arranque.
      connectedOverride: initialConnected(),
      fileStatus: {},
      commands: null,
      requests: [],
      unknownRoutes: new Map(),
      permissionReplies: [],
      questionReplies: [],
      jobs: new Map(), // childID -> trabajo de subagente (task)
      bg: { delayMs: 0, hold: false, failNext: 0, failMessage: 'Fallo simulado del hijo' }, // valores por defecto de bg-set
      permissionSaved: new Set(), // claves MCP con «siempre» (en memoria de la instancia, como el 1.19)
      restartCount: 0,
      disposeCount: 0,
      instanceDisposeCount: 0
    }
  }
  let eventCounter = 0
  let sysCounter = 0
  const events = [] // últimos eventos emitidos
  const sse = new Set() // { res, directory|null }
  let sseBlockedUntil = 0

  const nextId = (kind, prefix) => `${prefix}_${String(++state.seq[kind]).padStart(4, '0')}`

  // ───────────── eventos ─────────────

  function emit(type, properties, directory, id) {
    const envelope = { directory, payload: { id: id ?? `evt_${String(++eventCounter).padStart(4, '0')}`, type, properties } }
    events.push(envelope)
    if (events.length > 1000) events.splice(0, events.length - 1000)
    broadcast(envelope)
    return envelope
  }
  function broadcast(envelope) {
    for (const c of sse) {
      if (c.directory !== null && c.directory !== envelope.directory) continue
      write(c, c.raw ? envelope.payload : envelope)
    }
  }
  function write(c, obj) {
    try {
      c.res.write(`data: ${JSON.stringify(obj)}\n\n`)
    } catch {
      sse.delete(c)
    }
  }
  function sysEvent(type) {
    return { directory: 'global', payload: { id: `sys_${String(++sysCounter).padStart(4, '0')}`, type, properties: {} } }
  }

  // ───────────── config / mcp / providers ─────────────

  function readJsonFile(p) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8'))
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch {
      return {}
    }
  }
  function mergedConfig() {
    const file = env.OPENCODE_CONFIG && existsSync(env.OPENCODE_CONFIG) ? readJsonFile(env.OPENCODE_CONFIG) : {}
    let content = {}
    if (env.OPENCODE_CONFIG_CONTENT) {
      try {
        const v = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
        if (v && typeof v === 'object') content = v
      } catch {
        /* JSON inválido: se ignora, como el real */
      }
    }
    const layers = [file, content, state.configPatch]
    const out = {}
    for (const l of layers) Object.assign(out, l)
    out.mcp = { ...file.mcp, ...content.mcp, ...state.configPatch.mcp, ...state.mcpAdded }
    return out
  }
  function mcpStatus() {
    const out = {}
    for (const [name, entry] of Object.entries(mergedConfig().mcp ?? {})) {
      const enabled = entry && typeof entry === 'object' && entry.enabled === false ? false : true
      out[name] = state.mcpForced[name] ?? state.mcpUser[name] ?? (enabled ? { status: 'connected' } : { status: 'disabled' })
    }
    return out
  }

  const model = (providerID, id, name, extra = {}) => ({
    id,
    providerID,
    api: { id, url: 'http://127.0.0.1:0/fake', npm: '@ai-sdk/openai-compatible' },
    name,
    family: 'fake',
    capabilities: {
      temperature: true,
      reasoning: !!extra.variants,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200000, output: 32000 },
    status: 'active',
    options: {},
    headers: {},
    release_date: '2026-01-01',
    ...extra
  })
  const provider = (id, name, models, source = 'config') => ({
    id,
    name,
    source,
    env: [],
    options: {},
    models: Object.fromEntries(models.map((m) => [m.id, m]))
  })
  const catalog = () => [
    provider('fake', 'Fake (E2E)', [
      model('fake', 'fake-model', 'Fake Model'),
      model('fake', 'fake-reasoner', 'Fake Reasoner', { variants: { low: { reasoningEffort: 'low' }, high: { reasoningEffort: 'high' } } })
    ]),
    provider('opencode-go', 'OpenCode Go', [model('opencode-go', 'fake-go-model', 'Fake Go Model')], 'api'),
    provider('anthropic', 'Anthropic', [model('anthropic', 'fake-claude', 'Fake Claude')], 'api'),
    provider('openai', 'OpenAI', [model('openai', 'fake-gpt', 'Fake GPT')], 'api'),
    // Gratuito preinstalado del motor real: origen `custom`, sin clave. Solo está conectado si se pide (connected.json o /__e2e/set).
    provider('opencode', 'OpenCode Zen', [model('opencode', 'fake-free-model', 'Fake Free')], 'custom')
  ]
  const connectedIds = () => [...new Set([...(state.connectedOverride ?? ['fake', 'opencode-go']), ...Object.keys(state.authProviders)])]
  const connectedProviders = () => catalog().filter((p) => connectedIds().includes(p.id))
  const defaultModels = (list) => Object.fromEntries(list.map((p) => [p.id, Object.keys(p.models)[0]]))

  // ───────────── sesiones ─────────────

  function sessionInfo(directory, body) {
    const n = state.seq.session + 1
    const id = nextId('session', 'ses_e2e')
    const now = Date.now()
    const info = {
      id,
      slug: `fake-session-${n}`,
      projectID: 'proj_fake',
      directory,
      title: body.title || `New session - ${new Date(now).toISOString()}`,
      version: FAKE_VERSION,
      time: { created: now, updated: now }
    }
    if (body.parentID) info.parentID = body.parentID
    if (body.agent) info.agent = body.agent
    if (body.metadata) info.metadata = body.metadata
    if (body.permission) info.permission = body.permission
    if (body.model)
      info.model = {
        id: body.model.modelID ?? body.model.id,
        providerID: body.model.providerID,
        ...(body.model.variant ? { variant: body.model.variant } : {})
      }
    return info
  }
  function createSession(directory, body = {}) {
    const info = sessionInfo(directory, body)
    const s = { info, messages: [], status: { type: 'idle' }, run: null, chain: Promise.resolve() }
    state.sessions.set(info.id, s)
    emit('session.created', { sessionID: info.id, info }, directory)
    return s
  }
  function touch(s) {
    s.info.time.updated = Date.now()
  }
  function setStatus(s, status) {
    s.status = status
    emit('session.status', { sessionID: s.info.id, status }, s.info.directory)
    if (status.type === 'idle') emit('session.idle', { sessionID: s.info.id }, s.info.directory)
  }

  // ───────────── guiones ─────────────

  function takeScript(sessionID, text, model) {
    const modelKey = model && typeof model === 'object' && model.providerID ? `${model.providerID}/${model.modelID ?? model.id}` : null
    const i = state.scripts.findIndex((e) => {
      if (e.sessionID && e.sessionID !== sessionID) return false
      if (e.forModel && e.forModel !== modelKey) return false
      if (e.match && !new RegExp(e.match).test(text)) return false
      return true
    })
    if (i < 0) return null
    const e = state.scripts[i]
    if (!e.sticky) state.scripts.splice(i, 1)
    return e
  }

  function sleep(run, ms) {
    if (!ms || ms <= 0) return new Promise((r) => setImmediate(r))
    return new Promise((resolveSleep) => {
      const t = setTimeout(done, ms)
      function done() {
        clearTimeout(t)
        run.wakers.delete(done)
        resolveSleep()
      }
      run.wakers.add(done)
    })
  }
  function waitFor(run, register) {
    return new Promise((resolveWait) => {
      const done = (v) => {
        run.wakers.delete(wake)
        resolveWait(v)
      }
      const wake = () => done('aborted')
      run.wakers.add(wake)
      register(done)
    })
  }

  const words = (t) => t.match(/\S+\s*/g) ?? (t ? [t] : [])

  function promptText(parts) {
    return (parts ?? [])
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n')
  }

  function upsertPart(s, message, part) {
    const i = message.parts.findIndex((p) => p.id === part.id)
    if (i >= 0) message.parts[i] = part
    else message.parts.push(part)
    touch(s)
    emit('message.part.updated', { sessionID: s.info.id, part, time: Date.now() }, s.info.directory)
  }

  async function execute(s, body, script, runOpts = {}) {
    const dir = s.info.directory
    const text = promptText(body.parts)
    // Un revert pendiente se consolida con el siguiente prompt (como el real).
    if (s.info.revert) {
      const idx = s.messages.findIndex((m) => m.info.id === s.info.revert.messageID)
      if (idx >= 0) s.messages.splice(idx)
      delete s.info.revert
    }
    const run = { aborted: false, wakers: new Set() }
    s.run = run
    const reqModel = body.model ?? {}
    const m = script?.model ?? {
      providerID: reqModel.providerID ?? DEFAULT_MODEL.providerID,
      modelID: reqModel.modelID ?? DEFAULT_MODEL.modelID
    }
    const agent = body.agent ?? s.info.agent ?? 'build'

    const userId = body.messageID ?? nextId('message', 'msg')
    const userInfo = {
      id: userId,
      sessionID: s.info.id,
      role: 'user',
      time: { created: Date.now() },
      agent,
      model: {
        providerID: reqModel.providerID ?? m.providerID,
        modelID: reqModel.modelID ?? m.modelID,
        ...(body.variant ? { variant: body.variant } : {})
      }
    }
    const userMsg = { info: userInfo, parts: [] }
    s.messages.push(userMsg)
    touch(s)
    emit('message.updated', { sessionID: s.info.id, info: userInfo }, dir)
    for (const p of body.parts ?? [])
      upsertPart(s, userMsg, { ...p, id: p.id ?? nextId('part', 'prt'), sessionID: s.info.id, messageID: userId })
    if (body.noReply) {
      s.run = null
      return null
    }

    await sleep(run, script?.startDelayMs ?? runOpts.startDelayMs ?? 0)
    setStatus(s, { type: 'busy' })
    const asstId = nextId('message', 'msg')
    const asstInfo = {
      id: asstId,
      sessionID: s.info.id,
      role: 'assistant',
      time: { created: Date.now() },
      parentID: userId,
      modelID: m.modelID,
      providerID: m.providerID,
      mode: agent,
      agent,
      path: { cwd: dir, root: dir },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    }
    if (body.variant) asstInfo.variant = body.variant
    const asst = { info: asstInfo, parts: [] }
    s.messages.push(asst)
    emit('message.updated', { sessionID: s.info.id, info: asstInfo }, dir)

    const ctx = { s, run, dir, asst, asstId, text, outText: '', failed: null }
    const steps = script?.steps ?? [{ type: 'text', text: `Respuesta simulada: ${text}` }]
    try {
      for (const step of steps) {
        // Fallo forzado desde fuera (bg-fail): se aplica en el siguiente límite de paso.
        if (run.failure && !ctx.failed && !run.aborted) {
          ctx.failed = { name: 'UnknownError', data: { message: run.failure } }
          emit('session.error', { sessionID: s.info.id, error: ctx.failed }, dir)
        }
        if (run.aborted || ctx.failed) break
        if (step.delayMs) await sleep(run, step.delayMs)
        if (run.aborted) break
        await runStep(ctx, step)
      }
    } catch (err) {
      ctx.failed = { name: 'UnknownError', data: { message: err instanceof Error ? err.message : String(err) } }
    }

    // Herramientas sin terminar quedan como error si se abortó.
    if (run.aborted) {
      for (const p of asst.parts) {
        if (p.type === 'tool' && (p.state.status === 'running' || p.state.status === 'pending')) {
          upsertPart(s, asst, {
            ...p,
            state: {
              status: 'error',
              input: p.state.input ?? {},
              error: 'Tool execution aborted',
              time: { start: p.state.time?.start ?? Date.now(), end: Date.now() }
            }
          })
        }
      }
      ctx.failed = { name: 'MessageAbortedError', data: { message: 'The operation was aborted.' } }
    }
    const done = { ...asst.info, time: { ...asst.info.time, completed: Date.now() } }
    done.tokens = { input: text.length, output: ctx.outText.length, reasoning: 0, cache: { read: 0, write: 0 } }
    if (script?.cost) {
      done.cost = script.cost
      s.info.cost = (s.info.cost ?? 0) + script.cost
    }
    if (ctx.failed) done.error = ctx.failed
    else done.finish = 'stop'
    asst.info = done
    if (script?.title) s.info.title = script.title
    // `summary` {files,additions,deletions}: el resumen de cambios de la sesión (alimenta el estado «por revisar» de la lista de Code).
    if (script?.summary) s.info.summary = script.summary
    touch(s)
    emit('message.updated', { sessionID: s.info.id, info: done }, dir)
    if (script?.title || script?.summary) emit('session.updated', { sessionID: s.info.id, info: s.info }, dir)
    s.run = null
    setStatus(s, { type: 'idle' })
    return asst
  }

  async function streamText(ctx, kind, step) {
    const { s, run, dir, asst, asstId } = ctx
    const id = nextId('part', 'prt')
    const base = { id, sessionID: s.info.id, messageID: asstId, type: kind }
    const full = step.text ?? (step.deltas ?? []).join('')
    const deltas = step.deltas ?? words(full)
    upsertPart(s, asst, { ...base, text: '', ...(kind === 'reasoning' ? { time: { start: Date.now() } } : {}) })
    let acc = ''
    for (const d of deltas) {
      if (run.aborted) break
      acc += d
      emit('message.part.delta', { sessionID: s.info.id, messageID: asstId, partID: id, field: 'text', delta: d }, dir)
      await sleep(run, step.chunkDelayMs ?? 0)
    }
    upsertPart(s, asst, {
      ...base,
      text: acc,
      ...(kind === 'reasoning' ? { time: { start: Date.now(), end: Date.now() } } : { time: { start: Date.now(), end: Date.now() } })
    })
    if (kind === 'text') ctx.outText += acc
  }

  async function runStep(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    switch (step.type) {
      case 'delay':
      case 'wait':
        await sleep(run, step.ms ?? 0)
        return
      case 'text':
      case 'reasoning':
        return streamText(ctx, step.type, step)
      case 'title':
        s.info.title = step.title
        touch(s)
        emit('session.updated', { sessionID: s.info.id, info: s.info }, dir)
        return
      case 'todo': {
        state.todos.set(s.info.id, step.todos ?? [])
        emit('todo.updated', { sessionID: s.info.id, todos: step.todos ?? [] }, dir)
        return
      }
      case 'emit':
        emit(step.event.type, step.event.properties ?? {}, step.event.directory ?? dir)
        return
      case 'retry':
        setStatus(s, {
          type: 'retry',
          attempt: step.attempt ?? 1,
          message: step.message ?? 'Reintentando…',
          next: Date.now() + (step.nextMs ?? 1000)
        })
        await sleep(run, step.nextMs ?? 0)
        setStatus(s, { type: 'busy' })
        return
      case 'error': {
        // `preset: 'quota'`: límite de uso como lo da el proveedor (friendlyError → quota; 429 sin reintento del motor).
        const quota = step.preset === 'quota'
        const name = step.name ?? (quota ? 'APIError' : 'UnknownError')
        const statusCode = step.statusCode ?? (quota ? 429 : undefined)
        const data = {
          message: step.message ?? (quota ? 'token rate limit exceeded' : 'Error simulado'),
          ...(statusCode ? { statusCode, isRetryable: !!step.isRetryable } : {})
        }
        ctx.failed = { name, data }
        emit('session.error', { sessionID: s.info.id, error: ctx.failed }, dir)
        return
      }
      case 'request-access':
        return runRequestAccess(ctx, step)
      case 'child':
        return runChild(ctx, step)
      case 'task':
        return runTask(ctx, step)
      case 'bg-gate': // interno: compuerta de arranque de un hijo en segundo plano
        return runBgGate(ctx, step)
      case 'code_mode':
        return runCodeMode(ctx, step)
      case 'fs':
        return runFs(ctx, step)
      case 'elicitation':
        return runElicitation(ctx, step)
      case 'tool':
      case 'permission':
      case 'question':
        return runTool(ctx, step)
      default:
        throw new Error(`Paso de guion desconocido: ${step.type}`)
    }
  }

  /**
   * Paso `request-access`: hace lo que el MCP `computer_request_access` (POST `<LAZUNOX_PLAN_GATE_URL>/request-access`, el canal
   * lateral de main) y ESPERA la respuesta del usuario. Solo existe en servidores de Control total (la app pasa la URL por entorno).
   * `{ apps?: [], plan?: string[], reason?: string }`; la respuesta se guarda en `state.accessResponses` (GET /__e2e/access-responses).
   */
  async function runRequestAccess(ctx, step) {
    const base = process.env.LAZUNOX_PLAN_GATE_URL
    if (!base) throw new Error('Paso request-access: sin LAZUNOX_PLAN_GATE_URL (solo hay en Control total)')
    const ac = new AbortController()
    const wake = () => ac.abort()
    ctx.run.wakers.add(wake)
    try {
      const res = await fetch(`${base}/request-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apps: step.apps ?? [],
          plan: step.plan ?? [],
          reason: step.reason,
          session: ctx.s.info.id
        }),
        signal: ac.signal
      })
      const body = await res.json().catch(() => ({}))
      state.accessResponses.push({ sessionID: ctx.s.info.id, status: res.status, body })
    } catch (err) {
      if (!ctx.run.aborted) throw err
    } finally {
      ctx.run.wakers.delete(wake)
    }
  }

  /** Paso `fs`: escribe o borra un archivo real, confinado al directorio de la sesión. */
  function runFs(ctx, step) {
    const base = realpathSync(ctx.dir)
    const abs = resolve(base, String(step.path ?? ''))
    if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`Paso fs fuera del directorio de la sesión: ${step.path}`)
    // El directorio padre (si existe) tampoco puede salir por un enlace simbólico.
    let parent = dirname(abs)
    while (!existsSync(parent) && parent !== base) parent = dirname(parent)
    const realParent = realpathSync(parent)
    if (realParent !== base && !realParent.startsWith(base + sep))
      throw new Error(`Paso fs fuera del directorio de la sesión: ${step.path}`)
    if (step.op === 'write') {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, String(step.content ?? ''))
    } else if (step.op === 'delete') {
      rmSync(abs, { force: true })
    } else {
      throw new Error(`Operación fs desconocida: ${step.op}`)
    }
  }

  async function runTool(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    const tool = step.type === 'question' ? 'question' : (step.tool ?? step.permission ?? 'bash')
    const input =
      step.input ??
      (step.type === 'question' ? { questions: step.questions ?? [] } : tool === 'bash' ? { command: step.patterns?.[0] ?? 'echo ok' } : {})
    const id = nextId('part', 'prt')
    const callID = `call_${String(++state.seq.call).padStart(4, '0')}`
    const mk = (st) => ({ id, sessionID: s.info.id, messageID: asstId, type: 'tool', callID, tool, state: st })
    const start = Date.now()
    upsertPart(s, asst, mk({ status: 'pending', input: {}, raw: '' }))
    upsertPart(s, asst, mk({ status: 'running', input, time: { start } }))

    let output = step.output ?? 'ok'
    let error = step.error
    if (step.type === 'permission') {
      const reqId = step.requestID ?? nextId('permission', 'per_e2e')
      const req = {
        id: reqId,
        sessionID: s.info.id,
        permission: step.permission ?? tool,
        patterns: step.patterns ?? [],
        metadata: step.metadata ?? {},
        always: step.always ?? [],
        tool: { messageID: asstId, callID }
      }
      const reply = await waitFor(run, (done) => {
        state.permissions.set(reqId, { req, resolve: done })
        emit('permission.asked', req, dir)
      })
      state.permissions.delete(reqId)
      if (reply === 'aborted') return
      if (reply === 'reject') {
        error = step.rejectMessage ?? 'The user rejected permission to use this specific tool call.'
        ctx.failed = { name: 'UnknownError', data: { message: error } }
      }
    } else if (step.type === 'question') {
      const reqId = step.requestID ?? nextId('question', 'que_e2e')
      const req = { id: reqId, sessionID: s.info.id, questions: step.questions ?? [], tool: { messageID: asstId, callID } }
      const answer = await waitFor(run, (done) => {
        state.questions.set(reqId, { req, resolve: done })
        emit('question.asked', req, dir)
      })
      state.questions.delete(reqId)
      if (answer === 'aborted') return
      if (answer.rejected) {
        error = 'The user dismissed this question'
        ctx.failed = { name: 'UnknownError', data: { message: error } }
      } else {
        output = step.output ?? `User answered: ${JSON.stringify(answer.answers)}`
      }
    } else if (step.runMs) {
      await sleep(run, step.runMs)
      if (run.aborted) return
    }
    const end = Date.now()
    if (error) upsertPart(s, asst, mk({ status: 'error', input, error, time: { start, end } }))
    else
      upsertPart(
        s,
        asst,
        mk({ status: 'completed', input, output, title: step.title ?? tool, metadata: step.metadata ?? {}, time: { start, end } })
      )
  }

  /** Paso `elicitation`: una herramienta de un conector que pide un formulario y espera la respuesta de la persona. */
  async function runElicitation(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    const server = step.server ?? 'forms'
    const tool = `${server}_form`
    const input = step.input ?? {}
    const id = nextId('part', 'prt')
    const callID = `call_${String(++state.seq.call).padStart(4, '0')}`
    const mk = (st) => ({ id, sessionID: s.info.id, messageID: asstId, type: 'tool', callID, tool, state: st })
    const start = Date.now()
    upsertPart(s, asst, mk({ status: 'pending', input: {}, raw: '' }))
    upsertPart(s, asst, mk({ status: 'running', input, time: { start } }))
    const reqId = step.requestID ?? nextId('elicitation', 'eli_e2e')
    const req = {
      id: reqId,
      sessionID: s.info.id,
      server,
      callID,
      message: step.message ?? '',
      fields: step.fields ?? [],
      expiresAt: Date.now() + (step.expiresInMs ?? 600_000)
    }
    const reply = await waitFor(run, (done) => {
      state.elicitations.set(reqId, { req, resolve: done })
      emit('mcp.elicitation.asked', req, dir)
    })
    state.elicitations.delete(reqId)
    if (reply === 'aborted') {
      // Como el motor: todo cierre sin respuesta publica `rejected`.
      emit('mcp.elicitation.rejected', { id: reqId, sessionID: s.info.id, reason: 'abort' }, dir)
      return
    }
    const output =
      reply.action === 'accept' ? `El conector recibió: ${JSON.stringify(reply.content ?? {})}` : `La persona respondió: ${reply.action}`
    upsertPart(s, asst, mk({ status: 'completed', input, output, title: tool, metadata: {}, time: { start, end: Date.now() } }))
  }

  async function runChild(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    const child = createSession(dir, { parentID: s.info.id, title: step.title ?? 'Subagente', agent: step.agent ?? 'explore' })
    const input = { description: step.title ?? 'Subagente', subagent_type: step.agent ?? 'explore' }
    const id = nextId('part', 'prt')
    const callID = `call_${String(++state.seq.call).padStart(4, '0')}`
    const start = Date.now()
    const mk = (st) => ({ id, sessionID: s.info.id, messageID: asstId, type: 'tool', callID, tool: 'task', state: st })
    upsertPart(s, asst, mk({ status: 'running', input, time: { start } }))
    const childScript = { steps: step.steps ?? [{ type: 'text', text: step.text ?? 'Listo.' }] }
    const res = await execute(
      child,
      { parts: [{ type: 'text', text: step.prompt ?? input.description }], agent: step.agent ?? 'explore' },
      childScript
    )
    if (run.aborted) return
    const out = res
      ? res.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('')
      : ''
    upsertPart(
      s,
      asst,
      mk({
        status: 'completed',
        input,
        output: out,
        title: input.description,
        metadata: { sessionId: child.info.id },
        time: { start, end: Date.now() }
      })
    )
  }


  // ───────────── subagentes en segundo plano (herramienta `task`) ─────────────

  /** Texto de resultado de la herramienta `task` (aproximación del formato del 1.19: `task_id` + `<task_result>`). */
  const taskResult = (id, st, summary, text) => `task_id: ${id}\nstate: ${st}\nsummary: ${summary}\n\n<task_result>\n${text}\n</task_result>`
  const BG_HINT = 'The subagent runs in the background. Do not sleep or poll: you will be notified when it finishes.'

  const jobView = (j) => ({
    childID: j.childID,
    parentID: j.parentID,
    status: j.status,
    background: j.background,
    generation: j.generation,
    delayMs: j.delayMs,
    hold: j.hold,
    released: j.released,
    waiting: !!j.gate,
    notified: j.notified,
    lost: j.lost,
    description: j.description
  })

  /** Arranca (o reanuda) el trabajo: el hijo corre su guion tras la compuerta. */
  function startJob(job) {
    const gen = ++job.generation
    job.status = 'running'
    job.released = false
    const child = state.sessions.get(job.childID)
    if (!child) return settleJob(job, gen, null, new Error('Sesión hija inexistente'))
    const steps = [{ type: 'bg-gate', jobID: job.childID }, ...job.steps]
    job.done = execute(child, { parts: [{ type: 'text', text: job.prompt }], agent: job.agent }, { steps }).then(
      (res) => settleJob(job, gen, res, null),
      (err) => settleJob(job, gen, null, err)
    )
  }

  /** Cierra el trabajo según cómo terminó el hijo y, si va al fondo, avisa al padre. */
  function settleJob(job, gen, res, err) {
    if (job.generation !== gen || state.jobs.get(job.childID) !== job) return // reiniciado o reseteado: este final ya no cuenta
    const failed = res?.info.error
    if (err || (failed && failed.name !== 'MessageAbortedError')) {
      job.status = 'error'
      job.error = err ? String(err.message ?? err) : (failed.data?.message ?? failed.name)
    } else if (failed || !res) {
      job.status = 'cancelled'
    } else {
      job.status = 'completed'
      job.output = res.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')
    }
    for (const w of [...job.waiters]) w('done')
    job.waiters.clear()
    // Como el motor: solo completed y error avisan; cancelled no. Solo los trabajos que ya van al fondo.
    if (job.background && job.status !== 'cancelled') notifyParent(job)
  }

  /** Aviso de fin: mensaje de usuario sintético en el padre + turno nuevo del padre (como `injectBackgroundResult`). */
  function notifyParent(job) {
    const parent = state.sessions.get(job.parentID)
    if (!parent) return
    job.notified = true
    const ok = job.status === 'completed'
    const text = taskResult(
      job.childID,
      job.status,
      ok ? `Background task completed: ${job.description}` : `Background task failed: ${job.description}`,
      ok ? (job.output ?? '') : (job.error ?? '')
    )
    enqueue(parent, { parts: [{ type: 'text', synthetic: true, text }], agent: parent.info.agent }, {}).catch(() => undefined)
  }

  /** Paso interno: espera el retraso/`hold` del hijo (o la apertura por bg-release) antes de ejecutar su guion. */
  async function runBgGate(ctx, step) {
    const job = state.jobs.get(step.jobID)
    if (!job) return
    const outcome = await waitFor(ctx.run, (done) => {
      if (job.released) return done('open')
      job.gate = (v) => {
        if (job.gateTimer) clearTimeout(job.gateTimer)
        job.gateTimer = null
        job.gate = null
        done(v)
      }
      if (!job.hold) {
        job.gateTimer = setTimeout(() => job.gate?.('open'), Math.max(0, job.delayMs))
        job.gateTimer.unref?.()
      }
    })
    if (job.gateTimer) clearTimeout(job.gateTimer)
    job.gateTimer = null
    job.gate = null
    if (outcome === 'aborted') return
    if (job.failMessage) ctx.run.failure = job.failMessage
  }

  /** Paso `task`: crea la sesión hija y la ejecuta en primer plano (bloquea) o en segundo plano (vuelve de inmediato). */
  async function runTask(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    const background = step.background === true
    const description = step.title ?? 'Subagente'
    const agent = step.agent ?? 'explore'
    const child = createSession(dir, { parentID: s.info.id, title: description, agent })
    const prompt = step.prompt ?? description
    const cfg = state.bg
    const job = {
      childID: child.info.id,
      parentID: s.info.id,
      description,
      agent,
      prompt,
      steps: step.steps ?? [{ type: 'text', text: step.text ?? 'Listo.' }],
      status: 'running',
      background,
      generation: 0,
      delayMs: step.childDelayMs ?? cfg.delayMs,
      hold: step.hold ?? cfg.hold,
      released: false,
      gate: null,
      gateTimer: null,
      failMessage: typeof step.fail === 'string' ? step.fail : null,
      waiters: new Set(),
      notified: false,
      lost: false
    }
    if (!job.failMessage && cfg.failNext !== 0) {
      job.failMessage = cfg.failMessage
      if (cfg.failNext > 0) cfg.failNext--
    }
    state.jobs.set(job.childID, job)

    const id = nextId('part', 'prt')
    const callID = `call_${String(++state.seq.call).padStart(4, '0')}`
    const input = { description, prompt, subagent_type: agent, ...(background ? { background: true } : {}) }
    const meta = { parentSessionId: s.info.id, sessionId: child.info.id, ...(background ? { background: true } : {}) }
    const start = Date.now()
    const mk = (st) => ({ id, sessionID: s.info.id, messageID: asstId, type: 'tool', callID, tool: 'task', state: st })
    upsertPart(s, asst, mk({ status: 'running', input, metadata: meta, time: { start } }))
    startJob(job)

    const started = () =>
      upsertPart(
        s,
        asst,
        mk({
          status: 'completed',
          input,
          output: taskResult(child.info.id, 'running', 'Background task started', BG_HINT),
          title: description,
          metadata: { ...meta, background: true, jobId: child.info.id },
          time: { start, end: Date.now() }
        })
      )
    if (background) return started()

    // Primer plano: espera al hijo; la ruta experimental `background` lo puede mandar al fondo.
    const outcome = await waitFor(run, (done) => {
      if (job.status !== 'running') return done('done')
      job.waiters.add(done)
    })
    job.waiters.clear()
    if (outcome === 'aborted') {
      // Interrumpir al padre mientras espera cancela al hijo (en segundo plano NO pasa).
      const c = state.sessions.get(job.childID)
      if (c) abortSession(c)
      return
    }
    if (outcome === 'promoted') return started()
    const end = Date.now()
    if (job.status === 'completed')
      upsertPart(
        s,
        asst,
        mk({
          status: 'completed',
          input,
          output: taskResult(child.info.id, 'completed', description, job.output ?? ''),
          title: description,
          metadata: meta,
          time: { start, end }
        })
      )
    else
      upsertPart(
        s,
        asst,
        mk({
          status: 'error',
          input,
          error: job.status === 'cancelled' ? 'Task cancelled' : `Subagent failed (task_id: ${child.info.id}): ${job.error}`,
          time: { start, end }
        })
      )
  }

  // ───────────── Code Mode (herramienta `execute` del 1.19) ─────────────

  const wildcard = (pattern, value) =>
    new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(String(value))

  /** Reglas de la config (`permission`: clave→acción o clave→{patrón→acción}) como lista ordenada. */
  function configRules() {
    const perm = mergedConfig().permission
    if (!perm || typeof perm !== 'object') return []
    const out = []
    for (const [k, v] of Object.entries(perm)) {
      if (typeof v === 'string') out.push({ permission: k, pattern: '*', action: v })
      else if (v && typeof v === 'object') for (const [pat, action] of Object.entries(v)) out.push({ permission: k, pattern: pat, action })
    }
    return out
  }
  /** Última regla que casa (comodín) con la acción; por defecto `ask`. */
  function evalRules(rules, permission, pattern = '*') {
    let effect = 'ask'
    for (const r of rules) if (wildcard(r.permission, permission) && wildcard(r.pattern ?? '*', pattern)) effect = r.action
    return effect
  }

  async function runCodeMode(ctx, step) {
    const { s, run, dir, asst, asstId } = ctx
    const tool = step.tool ?? 'execute' // nombre de la herramienta en el 1.19 (CODE_MODE_TOOL = "execute")
    const calls = step.calls ?? []
    const code =
      step.code ??
      calls
        .map((c) => {
          const i = String(c.tool).indexOf('_')
          const path = i > 0 ? `${c.tool.slice(0, i)}.${c.tool.slice(i + 1)}` : c.tool
          return `await tools.${path}(${JSON.stringify(c.input ?? {})})`
        })
        .join('\n')
    const input = { code }
    const id = nextId('part', 'prt')
    const callID = `call_${String(++state.seq.call).padStart(4, '0')}`
    const mk = (st) => ({ id, sessionID: s.info.id, messageID: asstId, type: 'tool', callID, tool, state: st })
    const start = Date.now()
    const toolCalls = []
    const publish = () =>
      upsertPart(s, asst, mk({ status: 'running', input, metadata: { toolCalls: toolCalls.map((t) => ({ ...t })) }, time: { start } }))
    upsertPart(s, asst, mk({ status: 'pending', input: {}, raw: '' }))
    publish()
    const rules = [...configRules(), ...(Array.isArray(s.info.permission) ? s.info.permission : []), ...(step.rules ?? [])]

    const fail = (message, reject = false) => {
      if (reject) ctx.failed = { name: 'UnknownError', data: { message } }
      upsertPart(
        s,
        asst,
        mk({ status: 'error', input, error: message, metadata: { toolCalls, error: true }, time: { start, end: Date.now() } })
      )
    }

    const results = []
    for (let i = 0; i < calls.length; i++) {
      if (run.aborted) return
      const call = calls[i]
      toolCalls[i] = { tool: call.tool, status: 'running', ...(call.input && Object.keys(call.input).length ? { input: call.input } : {}) }
      publish()
      if (call.delayMs) await sleep(run, call.delayMs)
      if (run.aborted) return
      const effect = evalRules(rules, call.tool)
      if (effect === 'deny') {
        toolCalls[i].status = 'error'
        return fail(`UnknownTool: ${call.tool} is not available in Code Mode (denied by permission rules).`)
      }
      if (effect !== 'allow' && !state.permissionSaved.has(call.tool)) {
        const reqId = nextId('permission', 'per_e2e')
        const req = {
          id: reqId,
          sessionID: s.info.id,
          permission: call.tool, // en el 1.19 el permiso es la clave MCP, no `execute`
          patterns: ['*'],
          metadata: {},
          always: ['*'],
          tool: { messageID: asstId, callID }
        }
        const reply = await waitFor(run, (done) => {
          state.permissions.set(reqId, { req, resolve: done })
          emit('permission.asked', req, dir)
        })
        state.permissions.delete(reqId)
        if (reply === 'aborted') return
        if (reply === 'reject') {
          toolCalls[i].status = 'error'
          return fail('The user rejected permission to use this specific tool call.', true)
        }
        if (reply === 'always') state.permissionSaved.add(call.tool)
      }
      if (call.error) {
        toolCalls[i].status = 'error'
        return fail(String(call.error))
      }
      toolCalls[i].status = 'completed'
      results.push(call.output ?? null)
      publish()
    }
    const value = step.value !== undefined ? step.value : results
    upsertPart(
      s,
      asst,
      mk({
        status: 'completed',
        input,
        output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        title: tool,
        metadata: { toolCalls },
        time: { start, end: Date.now() }
      })
    )
  }

  /** Encola una ejecución en la sesión (una a la vez, como el real). */
  // Como el motor real: un modelo de un proveedor no conectado falla con `ProviderModelNotFoundError` (con pila cruda).
  function failModelNotFound(s, m) {
    const message = `ProviderModelNotFoundError: Model not found: ${m.providerID}/${m.modelID}. Did you mean: ${m.modelID}?\n    at <anonymous> (/$bunfs/root/chunk.js:1:1)`
    emit('session.error', { sessionID: s.info.id, error: { name: 'UnknownError', data: { message } } }, s.info.directory)
    setStatus(s, { type: 'idle' })
  }

  function enqueue(s, body, runOpts) {
    const m = body.model
    if (m && typeof m === 'object' && m.providerID && !connectedIds().includes(m.providerID)) {
      const p = s.chain.then(async () => {
        await new Promise((r) => setTimeout(r, runOpts?.startDelayMs ?? 0))
        failModelNotFound(s, { providerID: m.providerID, modelID: m.modelID ?? m.id })
      })
      s.chain = p.catch(() => undefined)
      return p
    }
    const text = promptText(body.parts)
    const p = s.chain.then(() => execute(s, body, takeScript(s.info.id, text, body.model) ?? null, runOpts))
    s.chain = p.catch(() => undefined)
    return p
  }

  function abortSession(s) {
    const run = s.run
    if (!run) return false
    run.aborted = true
    for (const w of [...run.wakers]) w()
    return true
  }

  // ───────────── HTTP ─────────────

  const json = (res, data, status = 200) => {
    const body = data === undefined ? '' : JSON.stringify(data)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  const notFound = (res, message) => json(res, { name: 'NotFoundError', data: { message } }, 404)
  const badRequest = (res, message) => json(res, { name: 'BadRequestError', data: { message } }, 400)

  function readBody(req) {
    return new Promise((resolveBody, reject) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw.trim()) return resolveBody({ raw, data: undefined })
        try {
          resolveBody({ raw, data: JSON.parse(raw) })
        } catch {
          reject(new Error('JSON inválido'))
        }
      })
      req.on('error', reject)
    })
  }

  function corsHeaders(req, res) {
    const origin = req.headers.origin
    if (!origin || !cors.has(origin)) return
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader(
      'access-control-allow-headers',
      req.headers['access-control-request-headers'] || 'authorization, content-type, x-opencode-directory, x-opencode-workspace'
    )
    res.setHeader('access-control-expose-headers', 'x-next-cursor, x-total-count, link')
  }

  function authorized(req) {
    if (!password) return true
    const h = req.headers.authorization
    if (!h || !h.startsWith('Basic ')) return false
    const got = Buffer.from(h.slice(6), 'base64')
    const want = Buffer.from(`${username}:${password}`)
    return got.length === want.length && timingSafeEqual(got, want)
  }

  function directoryOf(req, url) {
    const q = url.searchParams.get('directory')
    if (q) return q
    const h = req.headers['x-opencode-directory']
    if (h) {
      try {
        return decodeURIComponent(h)
      } catch {
        return h
      }
    }
    return options.cwd ?? process.cwd()
  }

  const routes = []
  const route = (method, pattern, handler) => {
    const keys = []
    const re = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
    routes.push({ method, re, keys, handler })
  }

  function getSession(c) {
    const s = state.sessions.get(c.params.sessionID)
    if (!s) notFound(c.res, `Session not found: ${c.params.sessionID}`)
    return s
  }

  // --- global ---
  route('GET', '/global/health', (c) => json(c.res, { healthy: true, version: FAKE_VERSION, fake: true }))
  route('GET', '/global/event', (c) => openSse(c, false))
  route('GET', '/event', (c) => openSse(c, true))
  route('POST', '/global/dispose', (c) => {
    state.disposeCount++
    state.mcpUser = {}
    emit('global.disposed', {}, 'global')
    json(c.res, true)
  })
  // Está en api-routes.json aunque la app no lo llama hoy: se registra por si un E2E lo pide.
  route('POST', '/instance/dispose', (c) => {
    state.instanceDisposeCount++
    json(c.res, true)
  })
  route('GET', '/global/config', (c) => json(c.res, mergedConfig()))
  route('PATCH', '/global/config', (c) => {
    Object.assign(state.configPatch, c.body ?? {})
    json(c.res, mergedConfig())
  })
  route('POST', '/global/upgrade', (c) => json(c.res, { success: true, version: FAKE_VERSION }))
  route('POST', '/log', (c) => json(c.res, true))
  route('GET', '/path', (c) =>
    json(c.res, {
      home: env.HOME ?? '/',
      state: '/tmp/fake-opencode/state',
      config: '/tmp/fake-opencode/config',
      worktree: c.directory,
      directory: c.directory
    })
  )
  route('GET', '/vcs', (c) => json(c.res, { branch: 'main', default_branch: 'main' }))
  route('GET', '/agent', (c) => json(c.res, []))
  route('GET', '/skill', (c) => json(c.res, []))
  route('GET', '/project', (c) =>
    json(c.res, [{ id: 'proj_fake', worktree: c.directory, time: { created: startedAt, updated: startedAt }, sandboxes: [] }])
  )
  route('GET', '/project/current', (c) =>
    json(c.res, { id: 'proj_fake', worktree: c.directory, time: { created: startedAt, updated: startedAt }, sandboxes: [] })
  )

  function openSse(c, raw) {
    if (Date.now() < sseBlockedUntil)
      return json(c.res, { name: 'UnavailableError', data: { message: 'SSE bloqueado por /__e2e/drop-sse' } }, 503)
    c.res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    const client = { res: c.res, raw, directory: raw ? c.directory : null }
    sse.add(client)
    c.req.on('close', () => sse.delete(client))
    const connected = sysEvent('server.connected')
    write(client, raw ? connected.payload : connected)
    if (heartbeatMs > 0) {
      const t = setInterval(() => {
        const hb = sysEvent('server.heartbeat')
        write(client, raw ? hb.payload : hb)
      }, heartbeatMs)
      t.unref()
      c.res.on('close', () => clearInterval(t))
    }
    return 'handled'
  }

  // --- session ---
  route('GET', '/session/status', (c) => {
    const out = {}
    for (const s of state.sessions.values()) {
      if (s.info.directory === c.directory && s.status.type !== 'idle') out[s.info.id] = s.status
    }
    json(c.res, out)
  })
  route('GET', '/session', (c) => {
    const q = c.url.searchParams
    let list = [...state.sessions.values()].map((s) => s.info)
    if (q.get('scope') !== 'project') list = list.filter((i) => i.directory === c.directory)
    if (q.get('roots') === 'true') list = list.filter((i) => !i.parentID)
    if (q.get('search')) list = list.filter((i) => i.title.toLowerCase().includes(q.get('search').toLowerCase()))
    if (q.get('start')) list = list.filter((i) => i.time.updated >= Number(q.get('start')))
    list.sort((a, b) => b.time.updated - a.time.updated || (a.id < b.id ? 1 : -1))
    if (q.get('limit')) list = list.slice(0, Number(q.get('limit')))
    json(c.res, list)
  })
  route('POST', '/session', (c) => json(c.res, createSession(c.directory, c.body ?? {}).info))
  route('GET', '/experimental/session', (c) => {
    const q = c.url.searchParams
    let list = [...state.sessions.values()].map((s) => ({
      ...s.info,
      project: { id: 'proj_fake', name: 'fake', worktree: s.info.directory }
    }))
    if (q.get('cursor')) list = list.filter((i) => i.time.updated < Number(q.get('cursor')))
    list.sort((a, b) => b.time.updated - a.time.updated || (a.id < b.id ? 1 : -1))
    if (q.get('limit')) list = list.slice(0, Number(q.get('limit')))
    json(c.res, list)
  })
  route('GET', '/session/{sessionID}', (c) => {
    const s = getSession(c)
    if (s) json(c.res, s.info)
  })
  route('PATCH', '/session/{sessionID}', (c) => {
    const s = getSession(c)
    if (!s) return
    const b = c.body ?? {}
    if (typeof b.title === 'string') s.info.title = b.title
    if (b.permission !== undefined) s.info.permission = b.permission
    if (b.time && 'archived' in b.time) {
      if (b.time.archived) s.info.time.archived = b.time.archived
      else delete s.info.time.archived
    }
    touch(s)
    emit('session.updated', { sessionID: s.info.id, info: s.info }, s.info.directory)
    json(c.res, s.info)
  })
  route('DELETE', '/session/{sessionID}', (c) => {
    const s = getSession(c)
    if (!s) return
    const drop = (x) => {
      abortSession(x)
      state.sessions.delete(x.info.id)
      emit('session.deleted', { sessionID: x.info.id, info: x.info }, x.info.directory)
    }
    for (const child of [...state.sessions.values()]) if (child.info.parentID === s.info.id) drop(child)
    drop(s)
    json(c.res, true)
  })
  route('GET', '/session/{sessionID}/children', (c) => {
    const s = getSession(c)
    if (s)
      json(
        c.res,
        [...state.sessions.values()].filter((x) => x.info.parentID === s.info.id).map((x) => x.info)
      )
  })
  // Manda al fondo los subagentes en primer plano que bloquean a la sesión (responde si alguno pasó).
  route('POST', '/experimental/session/{sessionID}/background', (c) => {
    const s = getSession(c)
    if (!s) return
    let any = false
    for (const job of state.jobs.values()) {
      if (job.parentID !== s.info.id || job.status !== 'running' || job.background || job.waiters.size === 0) continue
      job.background = true
      for (const w of [...job.waiters]) w('promoted')
      job.waiters.clear()
      any = true
    }
    json(c.res, any)
  })
  route('GET', '/session/{sessionID}/todo', (c) => {
    const s = getSession(c)
    if (s) json(c.res, state.todos.get(s.info.id) ?? [])
  })
  route('GET', '/session/{sessionID}/diff', (c) => {
    if (getSession(c)) json(c.res, [])
  })
  route('GET', '/session/{sessionID}/message', (c) => {
    const s = getSession(c)
    if (!s) return
    let list = s.messages
    const limit = c.url.searchParams.get('limit')
    if (limit) list = list.slice(-Number(limit))
    json(c.res, list)
  })
  route('GET', '/session/{sessionID}/message/{messageID}', (c) => {
    const s = getSession(c)
    if (!s) return
    const m = s.messages.find((x) => x.info.id === c.params.messageID)
    if (m) json(c.res, m)
    else notFound(c.res, `Message not found: ${c.params.messageID}`)
  })
  route('DELETE', '/session/{sessionID}/message/{messageID}', (c) => {
    const s = getSession(c)
    if (!s) return
    const i = s.messages.findIndex((x) => x.info.id === c.params.messageID)
    if (i < 0) return notFound(c.res, `Message not found: ${c.params.messageID}`)
    s.messages.splice(i, 1)
    emit('message.removed', { sessionID: s.info.id, messageID: c.params.messageID }, s.info.directory)
    json(c.res, true)
  })
  route('POST', '/session/{sessionID}/prompt_async', (c) => {
    const s = getSession(c)
    if (!s) return
    const b = c.body ?? {}
    if (!Array.isArray(b.parts)) return badRequest(c.res, 'parts requerido')
    if (state.failPrompt !== 0) {
      // Red caída simulada: se corta la conexión sin respuesta (el cliente ve una excepción de red).
      if (state.failPrompt > 0) state.failPrompt--
      c.res.socket?.destroy()
      return
    }
    // La respuesta HTTP sale antes de los eventos (el real también responde 204 de inmediato).
    enqueue(s, b, { startDelayMs: 5 }).catch(() => undefined)
    c.res.writeHead(204)
    c.res.end()
  })
  route('POST', '/session/{sessionID}/message', async (c) => {
    const s = getSession(c)
    if (!s) return
    const b = c.body ?? {}
    if (!Array.isArray(b.parts)) return badRequest(c.res, 'parts requerido')
    const asst = await enqueue(s, b, {})
    json(c.res, asst ?? s.messages[s.messages.length - 1])
  })
  route('POST', '/session/{sessionID}/command', async (c) => {
    const s = getSession(c)
    if (!s) return
    const b = c.body ?? {}
    const text = `/${b.command ?? ''}${b.arguments ? ' ' + b.arguments : ''}`
    const asst = await enqueue(
      s,
      { parts: [{ type: 'text', text }], agent: b.agent, model: typeof b.model === 'string' ? undefined : b.model, messageID: b.messageID },
      {}
    )
    json(c.res, asst ?? s.messages[s.messages.length - 1])
  })
  route('POST', '/session/{sessionID}/shell', async (c) => {
    const s = getSession(c)
    if (!s) return
    const asst = await enqueue(s, { parts: [{ type: 'text', text: c.body?.command ?? '' }], agent: c.body?.agent }, {})
    json(c.res, asst ?? s.messages[s.messages.length - 1])
  })
  route('POST', '/session/{sessionID}/abort', (c) => {
    const s = getSession(c)
    if (!s) return
    abortSession(s)
    json(c.res, true)
  })
  route('POST', '/session/{sessionID}/revert', (c) => {
    const s = getSession(c)
    if (!s) return
    const b = c.body ?? {}
    s.info.revert = { messageID: b.messageID, ...(b.partID ? { partID: b.partID } : {}) }
    touch(s)
    emit('session.updated', { sessionID: s.info.id, info: s.info }, s.info.directory)
    json(c.res, s.info)
  })
  route('POST', '/session/{sessionID}/unrevert', (c) => {
    const s = getSession(c)
    if (!s) return
    delete s.info.revert
    touch(s)
    emit('session.updated', { sessionID: s.info.id, info: s.info }, s.info.directory)
    json(c.res, s.info)
  })
  route('POST', '/session/{sessionID}/fork', (c) => {
    const s = getSession(c)
    if (!s) return
    const upTo = c.body?.messageID
    const copy = createSession(s.info.directory, { title: `${s.info.title} (fork #1)`, agent: s.info.agent })
    const idx = upTo ? s.messages.findIndex((m) => m.info.id === upTo) : -1
    const src = idx >= 0 ? s.messages.slice(0, idx) : s.messages
    copy.messages = src.map((m) => ({
      info: { ...m.info, sessionID: copy.info.id },
      parts: m.parts.map((p) => ({ ...p, sessionID: copy.info.id }))
    }))
    json(c.res, copy.info)
  })
  route('POST', '/session/{sessionID}/summarize', (c) => {
    const s = getSession(c)
    if (!s) return
    setStatus(s, { type: 'busy' })
    setTimeout(() => {
      emit('session.compacted', { sessionID: s.info.id }, s.info.directory)
      setStatus(s, { type: 'idle' })
    }, 5)
    json(c.res, true)
  })
  route('POST', '/session/{sessionID}/share', (c) => {
    const s = getSession(c)
    if (!s) return
    s.info.share = { url: `https://fake.opencode.local/s/${s.info.id}` }
    json(c.res, s.info)
  })
  route('DELETE', '/session/{sessionID}/share', (c) => {
    const s = getSession(c)
    if (!s) return
    delete s.info.share
    json(c.res, s.info)
  })
  route('POST', '/session/{sessionID}/init', (c) => {
    if (getSession(c)) json(c.res, true)
  })

  // --- permisos / preguntas ---
  const pending = (map, dir) => [...map.values()].map((e) => e.req).filter((r) => state.sessions.get(r.sessionID)?.info.directory === dir)
  route('GET', '/permission', (c) => json(c.res, pending(state.permissions, c.directory)))
  route('POST', '/permission/{requestID}/reply', (c) => {
    const e = state.permissions.get(c.params.requestID)
    if (!e) return notFound(c.res, `Permission not found: ${c.params.requestID}`)
    const reply = c.body?.reply
    if (!['once', 'always', 'reject'].includes(reply)) return badRequest(c.res, 'reply inválido')
    state.permissionReplies.push({ requestID: e.req.id, reply, message: c.body?.message })
    emit(
      'permission.replied',
      { sessionID: e.req.sessionID, requestID: e.req.id, reply },
      state.sessions.get(e.req.sessionID)?.info.directory ?? c.directory
    )
    e.resolve(reply)
    json(c.res, true)
  })
  route('POST', '/session/{sessionID}/permissions/{permissionID}', (c) => {
    const e = state.permissions.get(c.params.permissionID)
    if (!e) return notFound(c.res, `Permission not found: ${c.params.permissionID}`)
    const reply = c.body?.response ?? 'once'
    state.permissionReplies.push({ requestID: e.req.id, reply })
    emit(
      'permission.replied',
      { sessionID: e.req.sessionID, requestID: e.req.id, reply },
      state.sessions.get(e.req.sessionID)?.info.directory ?? c.directory
    )
    e.resolve(reply)
    json(c.res, true)
  })
  // --- formularios de conectores (motor propio) ---
  route('GET', '/mcp/elicitation', (c) => json(c.res, pending(state.elicitations, c.directory)))
  route('POST', '/mcp/elicitation/{requestID}/reply', (c) => {
    const e = state.elicitations.get(c.params.requestID)
    if (!e) return notFound(c.res, `Elicitation not found: ${c.params.requestID}`)
    const action = c.body?.action
    if (!['accept', 'decline', 'cancel'].includes(action)) return badRequest(c.res, 'action inválida')
    const content = c.body?.content && typeof c.body.content === 'object' ? c.body.content : {}
    if (action === 'accept') {
      const errors = []
      for (const f of e.req.fields) {
        const v = content[f.name]
        if (f.required && (v === undefined || v === '')) errors.push({ campo: f.name, motivo: 'obligatorio' })
        else if (typeof v === 'string' && typeof f.maxLength === 'number' && v.length > f.maxLength) errors.push({ campo: f.name, motivo: 'demasiado largo' })
        else if (f.type === 'string' && f.forbid && typeof v === 'string' && v.includes(f.forbid)) errors.push({ campo: f.name, motivo: 'valor no permitido' })
      }
      for (const k of Object.keys(content)) if (!e.req.fields.some((f) => f.name === k)) errors.push({ campo: k, motivo: 'campo desconocido' })
      if (errors.length) return json(c.res, { errors }, 400)
    }
    state.elicitationReplies.push({ requestID: e.req.id, action, fields: action === 'accept' ? Object.keys(content) : [] })
    emit(
      'mcp.elicitation.replied',
      { id: e.req.id, sessionID: e.req.sessionID, action },
      state.sessions.get(e.req.sessionID)?.info.directory ?? c.directory
    )
    e.resolve({ action, content })
    json(c.res, true)
  })
  route('GET', '/question', (c) => json(c.res, pending(state.questions, c.directory)))
  route('POST', '/question/{requestID}/reply', (c) => {
    const e = state.questions.get(c.params.requestID)
    if (!e) return notFound(c.res, `Question not found: ${c.params.requestID}`)
    const answers = c.body?.answers ?? []
    state.questionReplies.push({ requestID: e.req.id, answers })
    emit(
      'question.replied',
      { sessionID: e.req.sessionID, requestID: e.req.id, answers },
      state.sessions.get(e.req.sessionID)?.info.directory ?? c.directory
    )
    e.resolve({ answers })
    json(c.res, true)
  })
  route('POST', '/question/{requestID}/reject', (c) => {
    const e = state.questions.get(c.params.requestID)
    if (!e) return notFound(c.res, `Question not found: ${c.params.requestID}`)
    state.questionReplies.push({ requestID: e.req.id, rejected: true })
    emit(
      'question.rejected',
      { sessionID: e.req.sessionID, requestID: e.req.id },
      state.sessions.get(e.req.sessionID)?.info.directory ?? c.directory
    )
    e.resolve({ rejected: true })
    json(c.res, true)
  })

  // --- providers / config / auth ---
  route('GET', '/provider', (c) => {
    const all = catalog()
    json(c.res, {
      all,
      default: defaultModels(connectedProviders()),
      connected: connectedIds().filter((id) => all.some((p) => p.id === id))
    })
  })
  route('GET', '/provider/auth', (c) =>
    json(
      c.res,
      Object.fromEntries(
        catalog().map((p) => [
          p.id,
          p.id === 'openai'
            ? [
                { type: 'oauth', label: 'Cuenta (E2E)' },
                { type: 'api', label: 'API key' }
              ]
            : [{ type: 'api', label: 'API key' }]
        ])
      )
    )
  )
  // OAuth falso: «authorize» devuelve una URL local con método `code`; «callback» exige el código y deja el proveedor conectado.
  route('POST', '/provider/{providerID}/oauth/authorize', (c) =>
    json(c.res, {
      url: `http://127.0.0.1/fake-oauth/provider/${c.params.providerID}`,
      method: 'code',
      instructions: 'Pega el código (E2E)'
    })
  )
  route('POST', '/provider/{providerID}/oauth/callback', (c) => {
    if (!c.body?.code) return badRequest(c.res, 'code requerido')
    state.authProviders[c.params.providerID] = { type: 'oauth' }
    persistAuth()
    json(c.res, true)
  })
  route('GET', '/config/providers', (c) => {
    const providers = connectedProviders()
    json(c.res, { providers, default: defaultModels(providers) })
  })
  route('GET', '/config', (c) => json(c.res, mergedConfig()))
  route('PATCH', '/config', (c) => {
    Object.assign(state.configPatch, c.body ?? {})
    json(c.res, mergedConfig())
  })
  route('PUT', '/auth/{providerID}', (c) => {
    state.authProviders[c.params.providerID] = c.body ?? {}
    persistAuth()
    json(c.res, true)
  })
  route('DELETE', '/auth/{providerID}', (c) => {
    delete state.authProviders[c.params.providerID]
    persistAuth()
    json(c.res, true)
  })

  // --- mcp ---
  route('GET', '/mcp', (c) => json(c.res, mcpStatus()))
  route('POST', '/mcp', (c) => {
    const b = c.body ?? {}
    if (!b.name) return badRequest(c.res, 'name requerido')
    state.mcpAdded[b.name] = b.config ?? {}
    json(c.res, mcpStatus())
  })
  const mcpKnown = (c) =>
    c.params.name in mcpStatus()
      ? true
      : (json(c.res, { _tag: 'McpServerNotFoundError', name: c.params.name, message: `MCP server not found: ${c.params.name}` }, 404),
        false)
  route('POST', '/mcp/{name}/connect', (c) => {
    if (!mcpKnown(c)) return
    delete state.mcpForced[c.params.name]
    state.mcpUser[c.params.name] = { status: 'connected' }
    emit('mcp.tools.changed', { server: c.params.name }, c.directory)
    json(c.res, true)
  })
  route('POST', '/mcp/{name}/disconnect', (c) => {
    if (!mcpKnown(c)) return
    state.mcpUser[c.params.name] = { status: 'disabled' }
    emit('mcp.tools.changed', { server: c.params.name }, c.directory)
    json(c.res, true)
  })
  route('POST', '/mcp/{name}/auth', (c) => {
    if (!mcpKnown(c)) return
    json(c.res, { authorizationUrl: `http://127.0.0.1/fake-oauth/${c.params.name}` })
  })
  route('POST', '/mcp/{name}/auth/authenticate', (c) => {
    if (!mcpKnown(c)) return
    delete state.mcpForced[c.params.name]
    state.mcpUser[c.params.name] = { status: 'connected' }
    json(c.res, state.mcpUser[c.params.name])
  })
  route('POST', '/mcp/{name}/auth/callback', (c) => {
    if (!mcpKnown(c)) return
    delete state.mcpForced[c.params.name]
    state.mcpUser[c.params.name] = { status: 'connected' }
    json(c.res, state.mcpUser[c.params.name])
  })
  route('DELETE', '/mcp/{name}/auth', (c) => {
    if (!mcpKnown(c)) return
    json(c.res, { success: true })
  })

  // --- archivos / comandos ---
  const within = (base, rel) => {
    const abs = resolve(base, rel || '.')
    return abs === resolve(base) || abs.startsWith(resolve(base) + sep) ? abs : null
  }
  route('GET', '/file', (c) => {
    const abs = within(c.directory, c.url.searchParams.get('path') ?? '')
    if (!abs || !existsSync(abs)) return json(c.res, [])
    try {
      const nodes = readdirSync(abs, { withFileTypes: true }).map((d) => ({
        name: d.name,
        path: relative(c.directory, join(abs, d.name)),
        absolute: join(abs, d.name),
        type: d.isDirectory() ? 'directory' : 'file',
        ignored: d.name === 'node_modules' || d.name === '.git'
      }))
      nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
      json(c.res, nodes)
    } catch {
      json(c.res, [])
    }
  })
  route('GET', '/file/content', (c) => {
    const abs = within(c.directory, c.url.searchParams.get('path') ?? '')
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return notFound(c.res, 'File not found')
    const buf = readFileSync(abs)
    if (buf.includes(0)) {
      const mime =
        { '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' }[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      return json(c.res, { type: 'binary', content: buf.toString('base64'), encoding: 'base64', mimeType: mime })
    }
    json(c.res, { type: 'text', content: buf.toString('utf8') })
  })
  route('GET', '/file/status', (c) => json(c.res, state.fileStatus[c.directory] ?? []))
  route('GET', '/command', (c) =>
    json(
      c.res,
      state.commands ?? [
        { name: 'init', description: 'Crear AGENTS.md', source: 'command', template: 'Analiza el proyecto y crea AGENTS.md', hints: [] },
        {
          name: 'review',
          description: 'Revisar cambios',
          source: 'command',
          template: 'Revisa los cambios: $ARGUMENTS',
          hints: ['$ARGUMENTS']
        }
      ]
    )
  )

  // ───────────── API de control ─────────────

  const control = {
    'POST emit': (c) => {
      const b = c.body ?? {}
      const list = Array.isArray(b.events) ? b.events : [b]
      const out = list.map((e) => {
        if (e.payload) return emit(e.payload.type, e.payload.properties ?? {}, e.directory ?? 'global', e.payload.id)
        if (!e.type) throw new Error('emit: falta type')
        return emit(e.type, e.properties ?? {}, e.directory ?? 'global', e.id)
      })
      json(c.res, { emitted: out })
    },
    'GET access-responses': (c) => json(c.res, { responses: state.accessResponses }),
    'POST log': (c) => {
      const b = c.body ?? {}
      if (typeof b.text !== 'string') throw new Error('log: falta text')
      ;(b.stream === 'stdout' ? process.stdout : process.stderr).write(`${b.text}\n`)
      json(c.res, { written: b.text.length })
    },
    // Sesiones con uso ya registrado (para la pantalla Ajustes › Uso): { sessions:[{ directory, title?, agent?, model?:{providerID,modelID},
    // tokens?:{input,output,reasoning?,cache?:{read,write}}, cost?, agoMs?, parentID? }] }. Devuelve los ids.
    'POST session-usage': (c) => {
      const b = c.body ?? {}
      const list = Array.isArray(b.sessions) ? b.sessions : [b]
      const created = list.map((x) => {
        const s = createSession(x.directory ?? '/', { title: x.title, agent: x.agent, model: x.model, parentID: x.parentID })
        const t = x.tokens
        if (t) s.info.tokens = { input: t.input ?? 0, output: t.output ?? 0, reasoning: t.reasoning ?? 0, cache: { read: t.cache?.read ?? 0, write: t.cache?.write ?? 0 } }
        if (typeof x.cost === 'number') s.info.cost = x.cost
        const at = Date.now() - (x.agoMs ?? 0)
        s.info.time = { created: at, updated: at }
        return s.info.id
      })
      json(c.res, { created })
    },
    'POST script': (c) => {
      const b = c.body ?? {}
      const list = Array.isArray(b.scripts) ? b.scripts : [b]
      for (const sc of list) {
        if (!Array.isArray(sc.steps)) throw new Error('script: falta steps[]')
        state.scripts.push(sc)
      }
      json(c.res, { queued: state.scripts.length })
    },
    'GET status': (c) =>
      json(c.res, {
        fake: true,
        pid: process.pid,
        version: FAKE_VERSION,
        startedAt,
        sseClients: sse.size,
        eventCount: eventCounter,
        lastEventId: events.length ? events[events.length - 1].payload.id : null,
        scriptsQueued: state.scripts.length,
        sessions: [...state.sessions.values()].map((s) => ({
          id: s.info.id,
          directory: s.info.directory,
          parentID: s.info.parentID ?? null,
          title: s.info.title,
          status: s.status.type,
          messages: s.messages.length,
          running: !!s.run
        })),
        pendingPermissions: [...state.permissions.values()].map((e) => e.req),
        pendingQuestions: [...state.questions.values()].map((e) => e.req),
        permissionReplies: state.permissionReplies,
        questionReplies: state.questionReplies,
        pendingElicitations: [...state.elicitations.values()].map((e) => e.req),
        elicitationReplies: state.elicitationReplies,
        mcp: mcpStatus(),
        authProviders: Object.keys(state.authProviders),
        disposeCount: state.disposeCount,
        instanceDisposeCount: state.instanceDisposeCount,
        restartCount: state.restartCount,
        jobs: [...state.jobs.values()].map(jobView),
        requestCount: state.seq.request,
        unknownRoutes: state.unknownRoutes.size,
        recentEvents: events.slice(-50).map((e) => ({ directory: e.directory, id: e.payload.id, type: e.payload.type }))
      }),
    'POST drop-sse': (c) => {
      const n = sse.size
      const blockMs = Number(c.body?.blockMs) || 0
      if (blockMs > 0) sseBlockedUntil = Date.now() + blockMs
      for (const client of [...sse]) {
        sse.delete(client)
        client.res.destroy()
      }
      json(c.res, { dropped: n, blockMs })
    },
    'GET requests': (c) => {
      const q = c.url.searchParams
      const limit = Number(q.get('limit') ?? 100)
      let list = state.requests
      if (q.get('path')) list = list.filter((r) => r.path.startsWith(q.get('path')))
      if (q.get('method')) list = list.filter((r) => r.method === q.get('method').toUpperCase())
      if (q.get('since')) list = list.filter((r) => r.seq > Number(q.get('since')))
      json(c.res, limit > 0 ? list.slice(-limit) : list)
    },
    'GET config': (c) => {
      const raw = env.OPENCODE_CONFIG_CONTENT ?? null
      let content = null
      try {
        content = raw ? JSON.parse(raw) : null
      } catch {
        content = null
      }
      json(c.res, { raw, content, config: mergedConfig() })
    },
    'GET env': (c) => {
      const content =
        typeof env.OPENCODE_AUTH_CONTENT === 'string' && env.OPENCODE_AUTH_CONTENT ? (parseAuthObject(env.OPENCODE_AUTH_CONTENT) ?? {}) : {}
      const providers = Object.keys(content)
      const allPlaceholder = Object.values(content).every(
        (e) => e && typeof e === 'object' && typeof e.key === 'string' && e.key.startsWith('sandboxed-placeholder-')
      )
      // `flags`: solo booleanos de OPENCODE_EXPERIMENTAL_CODE_MODE / _BACKGROUND_SUBAGENTS (los E2E comprueban qué familia de motor las recibió).
      const flags = {
        codeMode: env.OPENCODE_EXPERIMENTAL_CODE_MODE === 'true',
        backgroundSubagents: env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS === 'true',
        // Formularios de conectores: `LAZUNOX_MCP_ELICITATION=1` (solo el sidecar principal; nunca Overdrive).
        mcpElicitation: env.LAZUNOX_MCP_ELICITATION === '1'
      }
      json(c.res, { xdgDataHome: env.XDG_DATA_HOME ?? null, authContent: { providers, allPlaceholder }, flags })
    },
    'GET unknown-routes': (c) => json(c.res, [...state.unknownRoutes.values()]),
    'POST set': (c) => {
      const b = c.body ?? {}
      if (b.mcp) Object.assign(state.mcpForced, b.mcp)
      if (b.config) Object.assign(state.configPatch, b.config)
      if (b.todos) for (const [k, v] of Object.entries(b.todos)) state.todos.set(k, v)
      if (b.fileStatus) Object.assign(state.fileStatus, b.fileStatus)
      if (b.commands) state.commands = b.commands
      if (b.connectedProviders) state.connectedOverride = b.connectedProviders
      if (b.failPrompt !== undefined) state.failPrompt = Number(b.failPrompt)
      // sessionStatus:{id:'idle'|'busy'} fuerza el estado que ve GET /session/status (simula un motor reiniciado: la ejecución se perdió pero el mensaje quedó a medias).
      if (b.sessionStatus)
        for (const [k, v] of Object.entries(b.sessionStatus)) if (state.sessions.get(k)) state.sessions.get(k).status = { type: v }
      json(c.res, true)
    },
    'POST bg-set': (c) => {
      const b = c.body ?? {}
      if (b.delayMs !== undefined) state.bg.delayMs = Number(b.delayMs)
      if (b.hold !== undefined) state.bg.hold = !!b.hold
      if (b.failNext !== undefined) state.bg.failNext = Number(b.failNext)
      if (typeof b.failMessage === 'string') state.bg.failMessage = b.failMessage
      json(c.res, state.bg)
    },
    'POST bg-release': (c) => {
      let n = 0
      for (const job of state.jobs.values()) {
        if (c.body?.sessionID && job.childID !== c.body.sessionID) continue
        if (job.status !== 'running') continue
        job.released = true
        if (job.gate) {
          job.gate('open')
          n++
        }
      }
      json(c.res, { released: n })
    },
    'POST bg-fail': (c) => {
      const job = state.jobs.get(c.body?.sessionID)
      if (!job || job.status !== 'running') return notFound(c.res, `Trabajo en curso no encontrado: ${c.body?.sessionID}`)
      job.failMessage = c.body?.message ?? state.bg.failMessage
      const child = state.sessions.get(job.childID)
      if (child?.run) child.run.failure = job.failMessage
      if (job.gate) job.gate('open')
      else if (child?.run) for (const w of [...child.run.wakers]) w()
      json(c.res, true)
    },
    'GET bg': (c) => json(c.res, [...state.jobs.values()].map(jobView)),
    'POST restart': async (c) => {
      const mode = c.body?.mode === 'resume' ? 'resume' : 'lose'
      const blockMs = Number(c.body?.blockMs) || 0
      state.restartCount++
      const running = [...state.jobs.values()].filter((j) => j.status === 'running')
      for (const job of running) job.generation++ // los finales de la ejecución anterior ya no cuentan
      const resumable = mode === 'resume' ? running.filter((j) => j.background) : []
      for (const job of running) if (!resumable.includes(job)) Object.assign(job, { status: 'cancelled', lost: true })
      const previous = running.map((j) => j.done)
      for (const s of state.sessions.values()) abortSession(s) // un reinicio pierde TODA ejecución en curso
      await Promise.all(previous)
      state.permissionSaved.clear() // el «siempre» del 1.19 vive en la memoria de la instancia
      if (blockMs > 0) sseBlockedUntil = Date.now() + blockMs
      for (const client of [...sse]) {
        sse.delete(client)
        client.res.destroy()
      }
      for (const job of resumable) startJob(job)
      json(c.res, { mode, resumed: resumable.map((j) => j.childID), lost: running.filter((j) => !resumable.includes(j)).map((j) => j.childID) })
    },
    'POST reset': (c) => {
      for (const s of state.sessions.values()) abortSession(s)
      const keepEvents = !c.body?.eventIds
      const prevSeq = state.seq.request
      state = freshState()
      state.seq.request = prevSeq
      if (!keepEvents) eventCounter = 0
      events.length = 0
      json(c.res, true)
    }
  }

  async function handle(req, res) {
    corsHeaders(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    if (!authorized(req)) {
      res.setHeader('www-authenticate', 'Basic realm="opencode"')
      return json(res, { name: 'UnauthorizedError', data: { message: 'Unauthorized' } }, 401)
    }
    const url = new URL(req.url ?? '/', 'http://fake')
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
    const isControl = path.startsWith('/__e2e/')
    let parsed
    try {
      parsed = req.method === 'GET' || req.method === 'HEAD' ? { raw: '', data: undefined } : await readBody(req)
    } catch (err) {
      return badRequest(res, err.message)
    }
    const directory = directoryOf(req, url)
    if (!isControl) {
      state.requests.push({
        seq: ++state.seq.request,
        at: Date.now(),
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        directory,
        body: parsed.data === undefined ? null : parsed.data
      })
      if (state.requests.length > 2000) state.requests.splice(0, state.requests.length - 2000)
    }
    const c = { req, res, url, path, body: parsed.data, directory, params: {} }
    try {
      if (isControl) {
        const fn = control[`${req.method} ${path.slice('/__e2e/'.length)}`]
        if (!fn) return notFound(res, `Ruta de control desconocida: ${req.method} ${path}`)
        return await fn(c)
      }
      for (const r of routes) {
        if (r.method !== req.method) continue
        const m = r.re.exec(path)
        if (!m) continue
        r.keys.forEach((k, i) => (c.params[k] = decodeURIComponent(m[i + 1])))
        return await r.handler(c)
      }
      const key = `${req.method} ${path}`
      const prev = state.unknownRoutes.get(key)
      if (prev) prev.count++
      else state.unknownRoutes.set(key, { method: req.method, path, count: 1, firstAt: Date.now() })
      json(res, { name: 'NotFoundError', data: { message: `Ruta no implementada en el fake: ${key}` } }, 404)
    } catch (err) {
      if (!res.headersSent) json(res, { name: 'UnknownError', data: { message: err instanceof Error ? err.message : String(err) } }, 500)
      else res.end()
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res)
  })
  server.keepAliveTimeout = 5000

  return {
    server,
    listen(port, hostname) {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, hostname, () => resolveListen(server.address()))
      })
    },
    close() {
      for (const s of state.sessions.values()) abortSession(s)
      for (const client of sse) client.res.destroy()
      sse.clear()
      server.closeAllConnections?.()
      return new Promise((r) => server.close(() => r()))
    }
  }
}

// ───────────────────────────── main ─────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (args.version) {
    console.log(FAKE_VERSION)
    process.exit(0)
  }
  const fake = createFakeServer({ cors: args.cors })
  const addr = await fake.listen(args.port, args.hostname).catch((err) => {
    console.error(`[fake-opencode] no se pudo escuchar: ${err.message}`)
    process.exit(1)
  })
  console.log(`opencode server listening on http://${args.hostname}:${addr.port}`)
  const stop = () => {
    void fake.close().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
