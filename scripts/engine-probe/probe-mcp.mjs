// MCP stdio mínimo: herramientas `start` y `secret` que devuelven sus argumentos (para ver qué llega al servidor), `slow` (responde
// tras `ms`) y, para las comprobaciones «formularios B-n», `caps` / `form` / `form_password` / `late`, que le piden un formulario
// al cliente (`elicitation/create`) y devuelven lo que recibieron (eco).
// Si PROBE_MCP_OUT apunta a un archivo, el servidor anota ahí (una línea JSON por evento) lo que le llega del cliente.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
// PROBE_MCP_MANY=<n>: n herramientas extra con descripción y esquema realistas (~900 caracteres de JSON cada una, como las de Gmail o Jira),
// para medir cuánto pesa la lista de herramientas (`medir-herramientas.mjs`) y probar la búsqueda diferida. Determinista.
const VERBS = ['create', 'update', 'delete', 'list', 'get', 'search', 'archive', 'assign']
const NOUNS = [
  'ticket',
  'comment',
  'project',
  'label',
  'milestone',
  'sprint',
  'attachment',
  'user',
  'board',
  'webhook',
  'release',
  'filter'
]
const manyTool = (i) => {
  const verb = VERBS[i % VERBS.length]
  const noun = NOUNS[Math.floor(i / VERBS.length) % NOUNS.length]
  const name = i < VERBS.length * NOUNS.length ? `${verb}_${noun}` : `${verb}_${noun}_${Math.floor(i / (VERBS.length * NOUNS.length)) + 1}`
  const description =
    `${verb[0].toUpperCase()}${verb.slice(1)} a ${noun} in the workspace tracker; returns its id, status and URL. ` +
    `Use it when the user asks to ${verb} a ${noun} or mentions one by title or number. Dates are ISO 8601 (UTC). ` +
    `Results are paginated: pass the previous cursor to continue. Errors come back as text with a stable code (NOT_FOUND, FORBIDDEN, RATE_LIMITED). ` +
    `This operation is ${['create', 'update', 'delete', 'archive', 'assign'].includes(verb) ? 'a write: confirm with the user first' : 'read-only and safe to repeat'}.`
  const inputSchema = {
    type: 'object',
    properties: {
      workspace: { type: 'string', description: 'Workspace identifier, e.g. "acme-engineering".' },
      title: { type: 'string', description: `Short title of the ${noun}.`, maxLength: 200 },
      body: { type: 'string', description: `Description of the ${noun} in Markdown.` },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'], description: 'Workflow state.' },
      assignee: { type: 'string', description: 'User handle or email.' },
      due: { type: 'string', description: 'Due date, ISO 8601.' },
      limit: { type: 'number', description: 'Maximum items to return (1-100).' },
      cursor: { type: 'string', description: 'Pagination cursor.' }
    },
    required: ['workspace']
  }
  return { name, description, inputSchema }
}
const many = Array.from({ length: Math.max(0, Number(process.env.PROBE_MCP_MANY ?? 0) || 0) }, (_, i) => manyTool(i))
const log = (o) => {
  if (process.env.PROBE_MCP_OUT) appendFileSync(process.env.PROBE_MCP_OUT, JSON.stringify(o) + '\n')
}
const schema = { type: 'object', properties: { command: { type: 'string' } } }
const obj = (properties = {}) => ({ type: 'object', properties })
const text = (t) => ({ content: [{ type: 'text', text: t }] })

let clientCaps = null
// Solicitudes que ESTE servidor le manda al cliente (id propio) y esperan su respuesta.
let nextId = 1000
const waiting = new Map()
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = 's' + nextId++
    waiting.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
  })

const FORM = {
  type: 'object',
  properties: {
    nombre: { type: 'string', title: 'Nombre' },
    edad: { type: 'integer', title: 'Edad', minimum: 0 },
    peso: { type: 'number', title: 'Peso' },
    activo: { type: 'boolean', title: 'Activo' },
    color: { type: 'string', title: 'Color', enum: ['rojo', 'verde', 'azul'] }
  },
  required: ['nombre']
}
const FORM_PASSWORD = {
  type: 'object',
  // Campo llamado `password`. Sin `format: 'password'`: el SDK del cliente ya rechaza ese formato (no es de la especificación)
  // con un error de parámetros inválidos ANTES de llegar al motor, así que no probaría la regla de secretos del motor.
  properties: { usuario: { type: 'string', title: 'Usuario' }, password: { type: 'string', title: 'Contraseña' } },
  required: ['usuario']
}
/** Pide el formulario y devuelve el eco de lo que contestó el cliente (o su error). */
const pedir = async (schemaForm, message) => {
  const r = await ask('elicitation/create', { message, requestedSchema: schemaForm })
  const eco = r.error ? { error: r.error.message ?? String(r.error) } : { action: r.result?.action, content: r.result?.content }
  log({ evento: 'respuesta-formulario', ...eco })
  return eco
}

rl.on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  // Respuesta del cliente a una solicitud nuestra.
  if (m.method === undefined && m.id !== undefined && waiting.has(m.id)) {
    const f = waiting.get(m.id)
    waiting.delete(m.id)
    return f(m)
  }
  if (m.method === 'notifications/cancelled') return log({ evento: 'cancelled', requestId: m.params?.requestId, reason: m.params?.reason })
  if (m.method === 'initialize') {
    clientCaps = m.params?.capabilities ?? {}
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '1.0.0' }
      }
    })
  } else if (m.method === 'tools/list')
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        tools: [
          { name: 'start', description: 'echo args', inputSchema: schema },
          { name: 'secret', description: 'echo args', inputSchema: schema },
          {
            name: 'slow',
            description: 'responde tras ms milisegundos',
            inputSchema: { type: 'object', properties: { ms: { type: 'number' } } }
          },
          ...many,
          // Herramientas de formularios: solo si el escenario pide anotar lo que llega al servidor (PROBE_MCP_OUT), para no cambiar
          // el tamaño de la lista de herramientas que miden A-2 y `medir-herramientas.mjs`.
          ...(process.env.PROBE_MCP_OUT
            ? [
                { name: 'caps', description: 'capacidades que declaró el cliente', inputSchema: obj() },
                {
                  name: 'form',
                  description: 'pide un formulario (texto, número, boolean, enum) y devuelve lo recibido',
                  inputSchema: obj({ message: { type: 'string' } })
                },
                { name: 'form_password', description: 'pide un formulario con campo password', inputSchema: obj() },
                { name: 'late', description: 'responde ya y pide un formulario 400 ms DESPUÉS (sin llamada viva)', inputSchema: obj() }
              ]
            : [])
        ]
      }
    })
  else if (m.method === 'tools/call' && m.params.name === 'slow')
    setTimeout(
      () => send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'LENTO-LISTO' }] } }),
      Number(m.params.arguments?.ms ?? 100)
    )
  else if (m.method === 'tools/call' && m.params.name === 'caps')
    send({ jsonrpc: '2.0', id: m.id, result: text('CAPS:' + JSON.stringify(clientCaps ?? {})) })
  else if (m.method === 'tools/call' && (m.params.name === 'form' || m.params.name === 'form_password'))
    pedir(m.params.name === 'form' ? FORM : FORM_PASSWORD, m.params.arguments?.message ?? '¿Quién eres?').then((eco) =>
      send({ jsonrpc: '2.0', id: m.id, result: text('FORM:' + JSON.stringify(eco)) })
    )
  else if (m.method === 'tools/call' && m.params.name === 'late') {
    setTimeout(() => void pedir(FORM, 'tardío'), 400)
    send({ jsonrpc: '2.0', id: m.id, result: text('LATE-OK') })
  } else if (m.method === 'tools/call')
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: { content: [{ type: 'text', text: 'ECHO:' + m.params.name + ':' + JSON.stringify(m.params.arguments ?? {}) }] }
    })
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} })
})
