// MCP stdio mínimo: herramientas `start` y `secret` que devuelven sus argumentos (para ver qué llega al servidor).
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
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
          { name: 'slow', description: 'responde tras ms milisegundos', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } }
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
