import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOwnDeleteHandler } from './own-delete-handler'
import { hasLiveDeleteCall } from './own-delete-engine'
import { ownDeletePluginSource } from './own-delete-plugin'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { posixOnly } from '../../test/platform'
import { RestorePoints } from './restore-points'
import { DocumentsMcpServer } from '../documents/mcp-server'

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
  const cases = [
    ['rm borrador.txt && ls -la; echo listo', 'borrador.txt'],
    ['test -e borrador.txt && rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"', 'borrador.txt'],
    ['rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"', 'borrador.txt'],
    ['cd .lazunox/trabajo && true; rm -rf x', '.lazunox/trabajo/x'],
    ['rm -rf .lazunox/trabajo/convenio_x; test -e .lazunox/trabajo/convenio_x || echo borrado', '.lazunox/trabajo/convenio_x'],
    ['rm -f informe-v2.pptx; ls', 'informe-v2.pptx']
  ]
  it.each(cases)('orden real propia sin tarjeta: %s', async (command, target) => {
    mkdirSync(join(folder, target, '..'), { recursive: true })
    if (command.includes('-rf')) mkdirSync(join(folder, target))
    else writeFileSync(join(folder, target), 'propio')
    body.command = command
    messages = partMessages()
    const result = await makeHandler()(body)
    expect(result.deleted).toBe(true)
    expect(result.command).toContain(':')
    expect(existsSync(join(folder, target))).toBe(false)
    // main termina el borrado antes de que el motor ejecute las comprobaciones.
    if (posixOnly) {
      const output = execFileSync('/bin/sh', ['-c', result.command!], { cwd: folder, encoding: 'utf8', timeout: 5000 })
      if (command.includes('echo listo')) expect(output.trim().split('\n').at(-1)).toBe('listo')
      else if (command.includes('echo')) expect(output.trim()).toBe('borrado')
    }
  })
  it.each(cases.filter(([, target]) => !target.startsWith('.lazunox/')))(
    'orden real intacta sobre archivo previo: %s',
    async (command, target) => {
      writeFileSync(join(folder, target), 'previo')
      getBaseline.mockReturnValue({ version: 1, notBefore: 0, paths: [target], unknown: [] })
      body.command = command
      messages = partMessages()
      expect(await makeHandler()(body)).toEqual({ deleted: false })
      expect(existsSync(join(folder, target))).toBe(true)
    }
  )
  it.each(cases)('mezcla con previo: no borra NINGÚN destino: %s', async (command, target) => {
    mkdirSync(join(folder, target, '..'), { recursive: true })
    writeFileSync(join(folder, target), 'propio')
    writeFileSync(join(folder, 'previo'), 'previo')
    getBaseline.mockReturnValue({ version: 1, notBefore: 0, paths: ['previo'], unknown: [] })
    // Incluso si el propio está en scratch, un destino previo cancela el lote entero.
    body.command = command.replace(/\brm(?: -[rf]+)? [^;&\n]+/, '$& ' + folder + '/previo')
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, target))).toBe(true)
    expect(existsSync(join(folder, 'previo'))).toBe(true)
  })
  const guards = ['test -e', 'test -f', 'test -d', '[ -e', '[ -f', '[ -d']
  const guarded = (prefix: string, target = 'nuevo', deletion = 'rm -rf nuevo') =>
    `${prefix} ${target}${prefix.startsWith('[') ? ' ]' : ''} && ${deletion}; test -e nuevo || echo borrado`
  it.each(guards)('main comprueba existencia y tipo, y reemplaza también %s', async (prefix) => {
    if (prefix.endsWith('-d')) {
      rmSync(join(folder, 'nuevo'))
      mkdirSync(join(folder, 'nuevo'))
    }
    body.command = guarded(prefix, './nuevo')
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: true, command: ':&& :; test -e nuevo|| echo borrado' })
    expect(existsSync(join(folder, 'nuevo'))).toBe(false)
  })
  it.each(guards)('guardia falsa (%s): ni rm -f ni otro borrado del lote mutan nada', async (prefix) => {
    body.command = `rm nuevo; ${guarded(prefix, 'ausente', 'rm -f ausente')}`
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it.each(['test -f', '[ -f', 'test -d', '[ -d'])('tipo incorrecto (%s): conserva el lote y el comando', async (prefix) => {
    if (prefix.endsWith('-f')) mkdirSync(join(folder, 'otro'))
    else writeFileSync(join(folder, 'otro'), 'archivo')
    body.command = `rm nuevo; ${guarded(prefix, 'otro', 'rm -rf otro')}`
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
    expect(existsSync(join(folder, 'otro'))).toBe(true)
  })
  it('guardia sobre otra ruta existente: conserva la tarjeta y ambos archivos', async () => {
    writeFileSync(join(folder, 'otro'), 'x')
    body.command = guarded('test -e', 'otro')
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
    expect(existsSync(join(folder, 'otro'))).toBe(true)
  })
  it('recomprueba la guardia después de consultar la llamada viva', async () => {
    body.command = 'test -e nuevo && rm -f nuevo; echo fin'
    messages = partMessages()
    const originalFetch = fetchImpl.getMockImplementation()!
    fetchImpl.mockImplementation(async (...args) => {
      const result = await originalFetch(...args)
      if (new URL(String(args[0])).pathname.endsWith('/message')) rmSync(join(folder, 'nuevo'))
      return result
    })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
  })
  it.each(['test -e', '[ -f'])('no elude ask/deny sobre la guardia %s', async (prefix) => {
    body.command = guarded(prefix)
    messages = partMessages()
    for (const action of ['ask', 'deny']) {
      rule.push({ permission: 'bash', pattern: prefix + ' *', action })
      expect(await makeHandler()(body)).toEqual({ deleted: false })
      rule.pop()
    }
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('guardia sobre enlace final o padre enlace: no borra el destino', async () => {
    symlinkSync(join(folder, 'nuevo'), join(folder, 'enlace'))
    symlinkSync(folder, join(folder, 'padre'), 'junction')
    for (const target of ['enlace', 'padre/nuevo']) {
      body.command = guarded('test -e', target, 'rm -f ' + target)
      messages = partMessages()
      expect(await makeHandler()(body)).toEqual({ deleted: false })
    }
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it.each([false, true])('documentos_crear + inventario real: informe.docx previo=%s', async (previous) => {
    // Se entra por la herramienta real, sin abrir sockets ni ejecutar el motor de diseño.
    class TestDocuments extends DocumentsMcpServer {
      crear() {
        return this.callTool({ folder }, 'crear', {
          tipo: 'docx',
          nombre: 'informe',
          spec: { blocks: [{ type: 'paragraph', text: 'Informe de prueba' }] }
        })
      }
    }
    const bytes = readFileSync(new URL('../documents/fixtures-review/bueno.docx', import.meta.url))
    const docs = new TestDocuments({ render: async () => bytes, audit: () => {} })
    const restore = new RestorePoints({ root: join(dir, 'points'), trash: async () => {}, freeBytes: () => 1e12 })
    created = Date.now() + 1
    if (previous) expect((await docs.crear()).isError).toBeUndefined()
    expect((await restore.create(folder, sid, 'inicio', async () => true)).status).toBe('ok')
    if (!previous) expect((await docs.crear()).isError).toBeUndefined()
    expect(readFileSync(join(folder, 'informe.docx'))).toEqual(bytes)
    getBaseline.mockImplementation((f, s, c) => restore.deleteBaseline(f, s, c))
    const baseline = restore.deleteBaseline(folder, sid, created)!
    expect(baseline.paths.includes('informe.docx')).toBe(previous)
    body.command = 'rm informe.docx'
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: !previous })
    expect(existsSync(join(folder, 'informe.docx'))).toBe(previous)
  })
  it.each([
    'rm nuevo | cat',
    '(rm nuevo)',
    'rm nuevo; echo $(true)',
    'cd /tmp && rm nuevo',
    'touch nuevo; rm nuevo',
    'cat nuevo; rm nuevo',
    'test -e otro && rm nuevo',
    'false || rm nuevo',
    'rm nuevo; test -e nuevo || rm otro',
    'rm nuevo; curl example.invalid',
    'rm nuevo; printf x > otro',
    'rm nuevo; ls *'
  ])('conserva tarjeta y archivo: %s', async (command) => {
    body.command = command
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('no elude deny ni ask de un tramo de una orden compuesta', async () => {
    body.command = 'rm nuevo; cat otro'
    messages = partMessages()
    rule.push({ permission: 'bash', pattern: 'cat *', action: 'ask' })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    rule.pop()
    rule.push({ permission: 'bash', pattern: 'rm *', action: 'deny' })
    body.command = 'true; rm nuevo; echo fin'
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('lote con dos órdenes: un previo en la segunda impide borrar la primera', async () => {
    writeFileSync(join(folder, 'previo'), 'previo')
    getBaseline.mockReturnValue({ version: 1, notBefore: 0, paths: ['previo'], unknown: [] })
    body.command = 'rm nuevo; rm previo; echo fin'
    messages = partMessages()
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
    expect(existsSync(join(folder, 'previo'))).toBe(true)
  })
  it('cd a enlace o carpeta inexistente no adelanta el borrado', async () => {
    symlinkSync(folder, join(folder, 'enlace'), 'junction')
    for (const cwd of ['enlace', 'inexistente']) {
      body.command = 'cd ' + cwd + '; rm ' + folder + '/nuevo'
      messages = partMessages()
      expect(await makeHandler()(body)).toEqual({ deleted: false })
    }
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('un permiso sobre el cd reescrito se comprueba antes de borrar', async () => {
    body.command = 'cd .; rm nuevo'
    messages = partMessages()
    rule.push({ permission: 'bash', pattern: 'cd -- *', action: 'ask' })
    expect(await makeHandler()(body)).toEqual({ deleted: false })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('solo acepta el JSON exacto; no interpreta mv, parches ni programas arbitrarios', async () => {
    for (const b of [
      { ...body, extra: true },
      { ...body, command: 'mv nuevo otro' },
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
      const hooks = await mod.default.server()
      const before = hooks['tool.execute.before']
      const output = { args: { command: 'rm nuevo' } }
      await before({ tool: 'bash', sessionID: sid, callID: callId }, output)
      expect(output.args.command).toBe(':')
      expect(JSON.parse(fake.mock.calls[0][1].body)).toEqual({ sessionId: sid, callId, command: 'rm nuevo' })
      const old = { args: { command: 'rm previo' } }
      await before({ tool: 'bash', sessionID: sid, callID: 'other' }, old)
      expect(old.args.command).toBe('rm previo')
      fake.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, command: 'cd -- /tarea; :; ls' })))
      const compound = { args: { command: 'cd /tarea; rm nuevo; ls' } }
      await before({ tool: 'bash', sessionID: sid, callID: 'compound' }, compound)
      expect(compound.args.command).toBe('cd -- /tarea; :; ls')
      const after = hooks['tool.execute.after']
      const metadata = { metadata: { exit: 1 } }
      await after({ tool: 'bash', sessionID: sid, callID: 'compound' }, metadata)
      expect(metadata.metadata).toEqual({ exit: 1, lazunoxOwnDelete: true })
      const notOwn = { metadata: { exit: 1 } }
      await after({ tool: 'bash', sessionID: sid, callID: 'other' }, notOwn)
      expect(notOwn.metadata).toEqual({ exit: 1 })
      fake.mockRejectedValueOnce(new Error('lost response'))
      await expect(before({ tool: 'bash', sessionID: sid, callID: 'lost' }, { args: { command: 'rm nuevo' } })).rejects.toThrow('confirmar')
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
  it.each([
    ['rm nuevo; test -e nuevo && echo existe || echo borrado', false],
    ['rm borrador.txt && ls -la; echo listo', false],
    ['test -e borrador.txt && rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"', false],
    ['rm borrador.txt && ls -la; echo listo', true],
    ['test -e borrador.txt && rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"', true]
  ] as const)('gancho → main → shell: %s (previo=%s)', async (command, previous) => {
    body.command = command
    const target = command.includes('borrador.txt') ? 'borrador.txt' : 'nuevo'
    writeFileSync(join(folder, target), previous ? 'previo' : 'propio')
    if (previous) getBaseline.mockReturnValue({ version: 1, notBefore: 0, paths: [target], unknown: [] })
    messages = partMessages()
    const h = makeHandler()
    const path = join(dir, 'integrated.mjs')
    writeFileSync(path, ownDeletePluginSource())
    vi.stubEnv('LAZUNOX_OWN_DELETE_URL', 'http://127.0.0.1:1/cleanup')
    vi.stubEnv('LAZUNOX_OWN_DELETE_TOKEN', 'test-token')
    vi.stubGlobal(
      'fetch',
      async (_url: string, init: RequestInit) => new Response(JSON.stringify(await h(JSON.parse(init.body as string))))
    )
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(path).href)
      const hooks = await mod.default.server()
      const input = { tool: 'bash', sessionID: sid, callID: callId }
      const output = { args: { command: body.command } }
      await hooks['tool.execute.before'](input, output)
      expect(existsSync(join(folder, target))).toBe(previous)
      if (previous) expect(output.args.command).toBe(command)
      else expect(output.args.command).not.toMatch(/\brm\s/)
      // Solo POSIX dispone del shell usado por esta comprobación; main y el gancho se prueban en ambos.
      if (posixOnly && !previous) {
        const stdout = execFileSync('/bin/sh', ['-c', output.args.command as string], { cwd: folder, encoding: 'utf8', timeout: 5000 })
        expect(stdout.trim().split('\n').at(-1)).toBe(command.includes('echo listo') ? 'listo' : 'borrado')
        expect(stdout).not.toContain('todavía existe')
      }
      const result = { metadata: { exit: 1 } }
      await hooks['tool.execute.after'](input, result)
      expect(result.metadata).toEqual(previous ? { exit: 1 } : { exit: 1, lazunoxOwnDelete: true })
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
