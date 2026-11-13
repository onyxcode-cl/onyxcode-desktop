import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOwnDeleteHandler } from './own-delete-handler'
import { hasLiveDeleteCall } from './own-delete-engine'
import { ownDeletePluginSource } from './own-delete-plugin'
import { pathToFileURL } from 'node:url'

let dir: string
let folder: string
const sid = 'ses_abcdefgh'
const child = 'ses_child123'
const callId = 'call_123'
let body: Record<string, unknown>
let messages: unknown[]
let enabled: boolean
let created: number
let rule: { permission: string; pattern: string; action: string }[]
let getBaseline: ReturnType<typeof vi.fn>
let fetchImpl: ReturnType<typeof vi.fn>
const partMessages = (command = body.command, workdir = body.workdir) => [
  {
    info: { sessionID: body.sessionId, role: 'assistant', time: {} },
    parts: [
      { type: 'tool', tool: 'bash', sessionID: body.sessionId, callID: callId, state: { status: 'running', input: { command, workdir } } }
    ]
  }
]
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-own-handler-')))
  folder = join(dir, 'task')
  mkdirSync(folder)
  writeFileSync(join(folder, 'nuevo'), 'x')
  body = { sessionId: sid, callId, command: 'rm nuevo' }
  messages = partMessages()
  enabled = true
  created = Date.now()
  rule = [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: 'rm *', action: 'ask' }
  ]
  getBaseline = vi.fn(() => ({ version: 1 as const, notBefore: 0, paths: [], unknown: [] }))
  fetchImpl = vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    const data =
      path === '/agent'
        ? [{ name: 'tasks', permission: rule }]
        : path.endsWith('/message')
          ? messages
          : {
              id: path.split('/').at(-1),
              agent: 'tasks',
              permission: [],
              time: { created },
              ...(path.endsWith(child) ? { parentID: sid } : {})
            }
    return new Response(JSON.stringify(data), { status: 200 })
  })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const makeHandler = () =>
  createOwnDeleteHandler({
    folder,
    platform: 'darwin',
    excluded: [],
    server: () => ({ baseUrl: 'http://127.0.0.1:1234', authorization: 'Basic test', directory: folder }),
    enabled: () => enabled,
    baseline: getBaseline,
    fetchImpl: fetchImpl as typeof fetch
  })

describe('frontera real de main', () => {
  it('propio: devuelve hecho una sola vez y no vuelve a borrar un nombre reutilizado', async () => {
    const h = makeHandler()
    expect(await h(body)).toEqual({ deleted: true })
    expect(existsSync(join(folder, 'nuevo'))).toBe(false)
    writeFileSync(join(folder, 'nuevo'), 'reutilizado')
    expect(await h(body)).toEqual({ deleted: true })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('un archivo previo y sin registro fiable dejan el flujo de tarjeta', async () => {
    getBaseline.mockReturnValueOnce({ version: 1, notBefore: 0, paths: ['nuevo'], unknown: [] })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    getBaseline.mockReturnValueOnce(null)
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('resuelve la raíz verificada para un ayudante', async () => {
    body.sessionId = child
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: true })
    expect(getBaseline).toHaveBeenCalledWith(folder, sid, created)
  })
  it.each(['sin llamada', 'otra orden', 'otro cwd', 'cancelada', 'completada'])('rechaza suplantación/replay: %s', async (kind) => {
    if (kind === 'sin llamada') messages = []
    if (kind === 'otra orden') messages = partMessages('rm previo')
    if (kind === 'otro cwd') messages = partMessages(body.command, '/otro')
    if (kind === 'cancelada')
      messages = [{ ...partMessages()[0], info: { sessionID: sid, role: 'assistant', error: { name: 'MessageAbortedError' } } }]
    if (kind === 'completada') messages = [{ ...partMessages()[0], info: { sessionID: sid, role: 'assistant', time: { completed: 123 } } }]
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('Detener mientras se consultaba el motor no borra', async () => {
    fetchImpl.mockImplementationOnce(async () => {
      enabled = false
      return new Response(JSON.stringify([{ name: 'tasks', permission: rule }]))
    })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('si se cierra la petición antes de mutar, no borra', async () => {
    const controller = new AbortController()
    const originalFetch = fetchImpl.getMockImplementation()!
    fetchImpl.mockImplementation(async (...args) => {
      const result = await originalFetch(...args)
      controller.abort()
      return result
    })
    expect(await makeHandler()(body, controller.signal)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('no elude deny ni un permiso general de bash', async () => {
    rule.push({ permission: 'bash', pattern: '*', action: 'deny' })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    rule[rule.length - 1].action = 'ask'
    expect(await makeHandler()(body)).toEqual({ deleted: false })
  })
  it.each(['afuera', 'enlace', 'relativo', 'punto-punto'])('valida también cwd: %s', async (kind) => {
    if (kind === 'afuera') body.workdir = dir
    if (kind === 'enlace') {
      symlinkSync(dir, join(folder, 'link'), 'junction')
      body.workdir = join(folder, 'link')
    }
    if (kind === 'relativo') body.workdir = '.'
    if (kind === 'punto-punto') body.workdir = folder + '/../task'
    body.command = `rm ${folder}/nuevo`
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
  })
  it('solo acepta el JSON exacto; no interpreta mv, parches ni programas arbitrarios', async () => {
    for (const b of [
      { ...body, extra: true },
      { ...body, command: 'mv nuevo otro' },
      { ...body, command: 'rm nuevo && echo ok' },
      { ...body, callId: 'execute/1' }
    ])
      expect(await makeHandler()(b)).toEqual({ deleted: false })
  })
})

describe('gancho generado que ejecutará el motor', () => {
  it('propio pasa a éxito sin ejecutar rm; ajeno conserva el comando y sus permisos', async () => {
    const path = join(dir, 'plugin.mjs')
    writeFileSync(path, ownDeletePluginSource())
    vi.stubEnv('LAZUNOX_OWN_DELETE_URL', 'http://127.0.0.1:1/cleanup')
    vi.stubEnv('LAZUNOX_OWN_DELETE_TOKEN', 'test-token')
    const fake = vi.fn().mockResolvedValueOnce(new Response('{"deleted":true}')).mockResolvedValueOnce(new Response('{"deleted":false}'))
    vi.stubGlobal('fetch', fake)
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(path).href)
      const before = (await mod.default.server())['tool.execute.before']
      const output = { args: { command: 'rm nuevo' } }
      await before({ tool: 'bash', sessionID: sid, callID: callId }, output)
      expect(output.args.command).toBe(':')
      expect(JSON.parse(fake.mock.calls[0][1].body)).toEqual({ sessionId: sid, callId, command: 'rm nuevo' })
      const old = { args: { command: 'rm previo' } }
      await before({ tool: 'bash', sessionID: sid, callID: 'other' }, old)
      expect(old.args.command).toBe('rm previo')
      fake.mockRejectedValueOnce(new Error('lost response'))
      await expect(before({ tool: 'bash', sessionID: sid, callID: 'lost' }, { args: { command: 'rm nuevo' } })).rejects.toThrow('confirmar')
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
  it('no acepta una parte completada como llamada viva', () => {
    expect(hasLiveDeleteCall(messages, sid, callId, 'rm nuevo', undefined)).toBe(true)
    expect(hasLiveDeleteCall(messages, sid, 'otra', 'rm nuevo', undefined)).toBe(false)
  })
})
