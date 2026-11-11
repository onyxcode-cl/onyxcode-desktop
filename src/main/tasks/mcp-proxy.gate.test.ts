/**
 * Puerta de main en el proxy MCP (conectores de la persona con «preguntar cada herramienta»): un programa de la tarea con el token de la
 * ruta ya no puede llamar a una herramienta sin que la persona lo apruebe en main. Destino simulado en loopback; nada sale a internet.
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { gatedConnectorRoute } from './connector-approvals'
import { McpProxy, findToolCall, type ToolCall, type ToolCallGate, type ToolCallVerdict } from './mcp-proxy'

let upstream: Server
let seen: string[] = []
const clean: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()))
  seen = []
})

async function setup(gate: ToolCallGate, exactPath = false): Promise<{ url: string; token: string }> {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push(`${req.method} ${Buffer.concat(chunks).toString('utf8')}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hecho' }] } }))
    })
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()))
  const port = (upstream.address() as { port: number }).port
  const p = new McpProxy()
  await p.start()
  clean.push(async () => {
    await p.stop()
    upstream.closeAllConnections()
    await new Promise<void>((r) => upstream.close(() => r()))
  })
  const route = p.addRoute({
    exactPath,
    name: 'crm',
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { Authorization: 'Bearer real' },
    toolCallGate: gate
  })
  return { url: route.url, token: route.token }
}

const call = (tool: string, args: unknown, id = 7): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })
const post = (url: string, token: string, body: string, signal?: AbortSignal): Promise<Response> =>
  fetch(url, { method: 'POST', body, signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })

describe('findToolCall', () => {
  it('encuentra la llamada, deja pasar lo que no es tools/call y rechaza lo que no se entiende', () => {
    expect(findToolCall(Buffer.from(call('x', { a: 1 })))).toMatchObject({ kind: 'call', call: { tool: 'x', args: { a: 1 } }, id: 7 })
    expect(findToolCall(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}'))).toMatchObject({ kind: 'none' })
    expect(findToolCall(Buffer.from(''))).toMatchObject({ kind: 'none' })
    expect(findToolCall(Buffer.from('{no'))).toMatchObject({ kind: 'bad' })
    expect(findToolCall(Buffer.from(`[${call('a', {})},${call('b', {})}]`))).toMatchObject({ kind: 'bad', why: 'batch' })
    expect(findToolCall(Buffer.from('[1]'))).toMatchObject({ kind: 'bad' })
    expect(findToolCall(Buffer.from('{"method":"tools/call","params":{}}'))).toMatchObject({ kind: 'bad', why: 'no-name' })
  })
})

describe('H1: main y el servidor del conector no pueden leer el JSON de forma distinta', () => {
  it.each([
    ['`Method` en mayúscula', '{"jsonrpc":"2.0","id":1,"Method":"tools/call","params":{"name":"delete_repo"}}'],
    ['`Name` además de `name`', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_issues","Name":"delete_repo"}}'],
    [
      '`Arguments` además de `arguments`',
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{},"Arguments":{"a":1}}}'
    ],
    ['`argumentſ` (ſ = s)', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{},"argumentſ":{"a":1}}}'],
    ['`method` repetido', '{"jsonrpc":"2.0","id":1,"method":"tools/call","method":"tools/list","params":{"name":"x"}}'],
    ['`method` repetido (al revés)', '{"jsonrpc":"2.0","id":1,"method":"tools/list","method":"tools/call","params":{"name":"x"}}'],
    ['clave desconocida en el mensaje', '{"jsonrpc":"2.0","id":1,"method":"tools/list","extra":1}'],
    ['clave desconocida en params de tools/call', '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","tool":"y"}}'],
    [
      'claves equivalentes dentro de los argumentos',
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"to":"a","To":"b"}}}'
    ],
    [
      'JSON demasiado anidado',
      `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":${'['.repeat(80)}${']'.repeat(80)}}}`
    ]
  ])('%s ⇒ no se reenvía', (_n, body) => {
    expect(findToolCall(Buffer.from(body)).kind).toBe('bad')
  })

  it('lo que se reenvía es la reescritura de lo revisado, no los bytes originales', () => {
    const body = '{ "jsonrpc" : "2.0", "id" : 1, "method" : "tools/call", "params" : { "name" : "x", "arguments" : { "a" : "\\u0041" } } }'
    const f = findToolCall(Buffer.from(body))
    expect(f.kind).toBe('call')
    expect(f.kind !== 'bad' && f.canonical.toString()).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"a":"A"}}}'
    )
  })

  it('en el proxy: el destino recibe la reescritura (con Content-Length correcto), y un cuerpo comprimido se rechaza', async () => {
    const { url, token } = await setup(async () => ({ ok: true }))
    const r = await post(url, token, '{ "jsonrpc":"2.0", "id":3, "method":"tools/list" }')
    expect(r.status).toBe(200)
    expect(seen).toEqual(['POST {"jsonrpc":"2.0","id":3,"method":"tools/list"}'])
    const gz = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-encoding': 'gzip' }
    })
    expect(gz.status).toBe(415)
    expect(seen).toHaveLength(1)
  })
})

describe('McpProxy con puerta de main', () => {
  it('«No»: el destino no recibe nada y el cliente recibe un error de herramienta con su id', async () => {
    const asked: ToolCall[] = []
    const { url, token } = await setup(async (c) => {
      asked.push(c)
      return { ok: false, message: 'La persona no aprobó.' }
    })
    const r = await post(url, token, call('send_email', { to: 'ana@example.com' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'La persona no aprobó.' }], isError: true }
    })
    expect(asked).toEqual([{ tool: 'send_email', args: { to: 'ana@example.com' } }])
    expect(seen).toEqual([])
  })

  it('«Permitir»: se reenvía EXACTAMENTE el cuerpo revisado, una vez', async () => {
    const { url, token } = await setup(async () => ({ ok: true }))
    const body = call('send_email', { to: 'ana@example.com', texto: 'hola' })
    const r = await post(url, token, body)
    expect(r.status).toBe(200)
    expect(seen).toEqual([`POST ${body}`])
  })

  it('lo que no es tools/call pasa sin preguntar; un cuerpo ilegible o un lote con dos llamadas no se reenvía', async () => {
    let asked = 0
    const { url, token } = await setup(async () => {
      asked++
      return { ok: true }
    })
    const list = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
    expect((await post(url, token, list)).status).toBe(200)
    expect((await post(url, token, '{roto')).status).toBe(400)
    expect((await post(url, token, `[${call('a', {})},${call('b', {})}]`)).status).toBe(400)
    expect(asked).toBe(0)
    expect(seen).toEqual([`POST ${list}`])
  })

  it('si el cliente corta mientras se pregunta: la puerta ve la señal abortada y no se reenvía nada', async () => {
    let gotSignal: AbortSignal | undefined
    let release: ((v: ToolCallVerdict) => void) | undefined
    const { url, token } = await setup(
      (_c, signal) =>
        new Promise<ToolCallVerdict>((resolve) => {
          gotSignal = signal
          release = resolve
        })
    )
    const ac = new AbortController()
    const p = post(url, token, call('x', {}), ac.signal).catch(() => null)
    await new Promise((r) => setTimeout(r, 50))
    ac.abort()
    await p
    await new Promise((r) => setTimeout(r, 50))
    expect(gotSignal?.aborted).toBe(true)
    release?.({ ok: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([])
  })
})

describe('H2: una ruta con puerta solo deja usar la ruta exacta del conector', () => {
  it('la ruta registrada para «preguntar» lleva exactPath y la puerta', () => {
    const r = gatedConnectorRoute({ name: 'gh', url: 'https://api.example.test/mcp', headers: {} }, '/Users/ana/p')
    expect(r.exactPath).toBe(true)
    expect(typeof r.toolCallGate).toBe('function')
  })

  it('POST a otra ruta del servicio: 404 y no llega nada', async () => {
    const { url, token } = await setup(async () => ({ ok: true }), true)
    const other = url.replace(/\/mcp$/, '/api/v1/repos/x')
    expect((await post(other, token, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).status).toBe(404)
    expect(seen).toEqual([])
  })

  it('GET o DELETE con cuerpo: 400; GET sin pedir el flujo de eventos: 406; GET de eventos y DELETE sin cuerpo pasan', async () => {
    const { url, token } = await setup(async () => ({ ok: true }), true)
    const h = { authorization: `Bearer ${token}` }
    const del = await fetch(url, { method: 'DELETE', body: call('delete_repo', {}), headers: h })
    expect(del.status).toBe(400)
    expect((await fetch(url, { method: 'GET', headers: h })).status).toBe(406)
    expect(seen).toEqual([])
    expect((await fetch(url, { method: 'GET', headers: { ...h, accept: 'text/event-stream' } })).status).toBe(200)
    expect((await fetch(url, { method: 'DELETE', headers: h })).status).toBe(200)
    expect(seen).toEqual(['GET ', 'DELETE '])
  })
})
