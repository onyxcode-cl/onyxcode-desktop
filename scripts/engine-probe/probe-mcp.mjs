// MCP stdio mínimo: herramientas `start` y `secret` que devuelven sus argumentos (para ver qué llega al servidor).
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
// PROBE_MCP_MANY=<n>: n herramientas extra con descripción y esquema realistas (~900 caracteres de JSON cada una, como las de Gmail o Jira),
// para medir cuánto pesa la lista de herramientas (`medir-herramientas.mjs`) y probar la búsqueda diferida. Determinista.
const VERBS = ['create', 'update', 'delete', 'list', 'get', 'search', 'archive', 'assign']
const NOUNS = ['ticket', 'comment', 'project', 'label', 'milestone', 'sprint', 'attachment', 'user', 'board', 'webhook', 'release', 'filter']
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
const schema = { type: 'object', properties: { command: { type: 'string' } } }
rl.on('line', (line) => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.method === 'initialize')
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '1.0.0' }
      }
    })
  else if (m.method === 'tools/list')
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
          ...many
        ]
      }
    })
  else if (m.method === 'tools/call' && m.params.name === 'slow')
    setTimeout(
      () => send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'LENTO-LISTO' }] } }),
      Number(m.params.arguments?.ms ?? 100)
    )
  else if (m.method === 'tools/call')
    send({
      jsonrpc: '2.0',
      id: m.id,
      result: { content: [{ type: 'text', text: 'ECHO:' + m.params.name + ':' + JSON.stringify(m.params.arguments ?? {}) }] }
    })
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} })
})
