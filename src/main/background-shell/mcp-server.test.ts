/**
 * Protocolo MCP (JSON-RPC por líneas) y herramientas shell_bg_*, primero en proceso y luego con el paquete esbuild real
 * ejecutado como proceso aparte (como lo lanzará la app con su Node incluido). macOS y Linux.
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { BackgroundShellManager } from './manager'
import { TOOLS, ShellBgMcpServer, validateArgs } from './mcp-server'
import { createNodeProcessPort, parsePsTable, parsePsTime, treeOf } from './process-port'
import { pidAlive, tmpBase, waitFor } from './test-kit'

type Msg = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('esquemas y validador', () => {
  it('cinco herramientas con esquemas estrictos y descripciones útiles para el modelo', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['shell_bg_start', 'shell_bg_status', 'shell_bg_read', 'shell_bg_stop', 'shell_bg_list'])
    for (const t of TOOLS) {
      expect(t.inputSchema.additionalProperties).toBe(false)
      expect(t.description.length).toBeGreaterThan(60)
    }
    const start = TOOLS[0].description
    expect(start).toMatch(/do not wait with sleep/i)
    expect(start).toMatch(/notified automatically/i)
    expect(TOOLS[2].description).toMatch(/a little at a time/i)
  })

  it('rechaza claves extra, tipos y rangos', () => {
    const start = TOOLS[0].inputSchema
    expect(validateArgs(start, { command: 'ls' })).toBeNull()
    expect(validateArgs(start, {})).toMatch(/missing/)
    expect(validateArgs(start, { command: 'ls', extra: 1 })).toMatch(/unexpected/)
    expect(validateArgs(start, { command: 5 })).toMatch(/string/)
    expect(validateArgs(start, { command: 'ls', quietMinutes: 0 })).toMatch(/>= 1/)
    expect(validateArgs(start, { command: 'ls', quietMinutes: 1.5 })).toMatch(/integer/)
    expect(validateArgs(start, { command: 'ls', env: { A: 1 } })).toMatch(/string/)
    expect(validateArgs(start, { command: 'ls', watchPaths: [1] })).toMatch(/strings/)
    expect(validateArgs(TOOLS[4].inputSchema, { a: 1 })).toMatch(/unexpected/)
    expect(validateArgs(start, [])).toMatch(/object/)
  })
})

describe('muestreo de procesos (puro)', () => {
  it('parsea los formatos de tiempo de ps y arma el árbol', () => {
    expect(parsePsTime('9:58.60')).toBeCloseTo(598.6)
    expect(parsePsTime('00:01:02')).toBe(62)
    expect(parsePsTime('1-02:03:04')).toBe(86400 + 7384)
    expect(parsePsTime('basura')).toBeNull()
    const rows = parsePsTable('  10 1 10 0:01.00\n  11 10 10 0:02.00\n  12 11 12 0:03.00\n  20 1 20 9:00.00\nmal\n')
    expect(treeOf(rows, 10).map((r) => r.pid)).toEqual([10, 11, 12])
  })
})

describe.skipIf(!posixOnly)('muestreo real con ps', () => {
  it('ve el árbol del propio proceso y la identidad de un PID', async () => {
    const port = createNodeProcessPort()
    const s = await port.sampleCpu(process.pid)
    expect(s?.pids).toContain(process.pid)
    expect(s?.cpuSeconds).toBeGreaterThanOrEqual(0) // ps da segundos enteros: en Linux un proceso recién creado marca 0
    expect(await port.identity(process.pid)).toMatch(/\d{4}/)
    expect(await port.identity(2147483000)).toBeNull()
  })
})

describe.skipIf(!posixOnly)('servidor MCP en proceso', () => {
  let base: string
  let out: Msg[]
  let mgr: BackgroundShellManager
  let server: ShellBgMcpServer
  let id = 0

  const call = async (name: string, args: unknown): Promise<Msg> => {
    const before = out.length
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }))
    return out.slice(before).find((m) => m.id === id) as Msg
  }

  beforeEach(() => {
    base = tmpBase()
    out = []
    mgr = new BackgroundShellManager({
      baseDir: join(base, 'work'),
      tickMs: 0,
      graceMs: 300,
      onEvent: (e) => server.notifyEvent(e),
      deps: { baseEnv: { PATH: process.env.PATH } }
    })
    server = new ShellBgMcpServer({ manager: mgr, defaultCwd: base, write: (l) => out.push(JSON.parse(l)) })
  })
  afterEach(async () => {
    await mgr.shutdown()
    rmSync(base, { recursive: true, force: true })
  })

  it('initialize, ping, tools/list y errores JSON-RPC', async () => {
    await server.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
      })
    )
    expect(out[0].result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'shell_bg' }, capabilities: { tools: {} } })
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(out).toHaveLength(1) // una notificación no recibe respuesta
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    expect(out[1].result.tools).toHaveLength(5)
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'nope' }))
    expect(out[2].error.code).toBe(-32601)
    await server.handleLine('{roto')
    expect(out[3].error.code).toBe(-32700)
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'otra' } }))
    expect(out[4].error.code).toBe(-32602)
  })

  it('flujo start -> read -> aviso de fin -> list', async () => {
    const r = await call('shell_bg_start', { command: 'echo mcp-ok' })
    expect(r.result.isError).toBe(false)
    const started = JSON.parse(r.result.content[0].text)
    expect(started.id).toMatch(/^bg_/)
    expect(started.note).toMatch(/Do not poll/)
    await waitFor(() => out.some((m) => m.method === 'notifications/message' && m.params.data.type === 'exit'))
    const note = out.find((m) => m.method === 'notifications/message')!
    expect(note.params.data.message).toMatch(/exited with code 0/)
    expect(note.params.data.message).toMatch(/mcp-ok/)
    const read = JSON.parse((await call('shell_bg_read', { id: started.id })).result.content[0].text)
    expect(read).toMatchObject({ text: 'mcp-ok\n', nextByte: 7, state: 'exited' })
    const list = JSON.parse((await call('shell_bg_list', {})).result.content[0].text)
    expect(list.jobs).toHaveLength(1)
    const st = JSON.parse((await call('shell_bg_status', { id: started.id })).result.content[0].text)
    expect(st).toMatchObject({ state: 'exited', exitCode: 0 })
  })

  it('errores de herramienta salen como isError con texto claro', async () => {
    expect((await call('shell_bg_start', { command: 'x', foo: 1 })).result).toMatchObject({ isError: true })
    const bad = await call('shell_bg_start', { command: 'echo', cwd: 'rel' })
    expect(bad.result.isError).toBe(true)
    expect(bad.result.content[0].text).toMatch(/INVALID_INPUT.*absolute/)
    expect((await call('shell_bg_status', { id: 'bg_zz' })).result.content[0].text).toMatch(/NOT_FOUND/)
    const secret = await call('shell_bg_start', { command: 'env', env: { AWS_SECRET_ACCESS_KEY: 'x' } })
    expect(secret.result.content[0].text).toMatch(/not allowed/)
  })

  it('stop devuelve el estado final', async () => {
    const started = JSON.parse((await call('shell_bg_start', { command: 'sleep 300' })).result.content[0].text)
    const stopped = JSON.parse((await call('shell_bg_stop', { id: started.id })).result.content[0].text)
    expect(stopped.state).toBe('stopped')
  })
})

describe.skipIf(!posixOnly)('paquete esbuild real como proceso aparte', () => {
  let base: string
  beforeEach(() => {
    base = tmpBase()
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('habla MCP por stdio, avisa del fin y al cerrar stdin termina todo el árbol', async () => {
    const bundle = join(base, 'shell-bg-mcp.cjs')
    await build({
      entryPoints: [join(__dirname, 'main.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      logLevel: 'silent'
    })
    const child = spawn(process.execPath, [bundle], {
      cwd: base,
      env: { PATH: process.env.PATH, LAZUNOX_SHELL_BG_DIR: join(base, 'work'), LAZUNOX_SHELL_BG_EVENTS: join(base, 'events.jsonl') },
      stdio: ['pipe', 'pipe', 'ignore']
    })
    const lines: Msg[] = []
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)))
        buf = buf.slice(i + 1)
      }
    })
    const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)))
    const send = (m: Msg): void => void child.stdin.write(JSON.stringify(m) + '\n')
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      await waitFor(() => lines.some((l) => l.id === 1))
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'shell_bg_start', arguments: { command: 'echo bundle-ok' } } })
      await waitFor(() => lines.some((l) => l.method === 'notifications/message' && l.params.data.type === 'exit'))
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'shell_bg_start', arguments: { command: 'sleep 300 & echo $!; wait' } }
      })
      await waitFor(() => lines.some((l) => l.id === 3))
      const jobId = JSON.parse(lines.find((l) => l.id === 3)!.result.content[0].text).id
      let grandchild = 0
      await waitFor(async () => {
        send({ jsonrpc: '2.0', id: 100 + lines.length, method: 'tools/call', params: { name: 'shell_bg_read', arguments: { id: jobId } } })
        await new Promise((r) => setTimeout(r, 60))
        const r = [...lines].reverse().find((l) => l.result?.content?.[0]?.text?.includes('"text"'))
        const t = r ? JSON.parse(r.result.content[0].text).text.trim() : ''
        grandchild = Number(t)
        return grandchild > 0
      })
      expect(pidAlive(grandchild)).toBe(true)
      child.stdin.end() // el cliente se fue: debe cerrar todo
      expect(await exited).toBe(0)
      await waitFor(() => !pidAlive(grandchild))
    } finally {
      child.kill('SIGKILL')
    }
    const events = readFileSync(join(base, 'events.jsonl'), 'utf8')
    expect(events).toContain('bundle-ok')
  })
})
