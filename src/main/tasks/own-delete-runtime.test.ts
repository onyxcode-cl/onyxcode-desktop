import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOwnDeleteRuntimeHandler, OWN_DELETE_TICKET_TTL_MS, type OwnDeleteRuntimeOptions } from './own-delete-runtime'

const sid = 'ses_abcdefgh'
const child = 'ses_child123'
const callId = 'call_123'
let dir: string
let folder: string
let enabled: boolean
let created: number
let command: string
let workdir: string | undefined
let currentSession: string
let completed: boolean
let cancelled: boolean
let running: boolean
let noMessages: boolean
let rule: Array<{ permission: string; pattern: string; action: string }>
let childRules: typeof rule
let ref: { baseUrl: string; authorization: string; directory: string } | null
let baseline: ReturnType<typeof vi.fn>
let fetchImpl: ReturnType<typeof vi.fn>
let opts: OwnDeleteRuntimeOptions
const partMessages = () =>
  noMessages
    ? []
    : [
        {
          info: {
            sessionID: currentSession,
            role: 'assistant',
            ...(cancelled ? { error: { name: 'MessageAbortedError' } } : {}),
            time: completed ? { completed: 123 } : {}
          },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              sessionID: currentSession,
              callID: callId,
              state: { status: running ? 'running' : 'completed', input: { command, workdir } }
            }
          ]
        }
      ]
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-own-runtime-')))
  folder = join(dir, 'task')
  mkdirSync(folder)
  writeFileSync(join(folder, 'nuevo'), 'propio')
  writeFileSync(join(folder, 'viejo'), 'previo')
  enabled = true
  created = Date.now()
  command = 'cat nuevo; rm nuevo; ls *'
  workdir = undefined
  currentSession = sid
  completed = cancelled = noMessages = false
  running = true
  rule = [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: 'rm *', action: 'allow' },
    { permission: 'bash', pattern: 'git push*', action: 'deny' },
    { permission: 'bash', pattern: 'sudo *', action: 'deny' }
  ]
  childRules = []
  baseline = vi.fn(() => ({ version: 1 as const, notBefore: 0, paths: ['viejo'], unknown: [] }))
  ref = { baseUrl: 'http://127.0.0.1:1234', authorization: 'Basic test', directory: folder }
  fetchImpl = vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    const data =
      path === '/agent'
        ? [{ name: 'tasks', permission: rule }]
        : path.endsWith('/message')
          ? partMessages()
          : {
              id: path.split('/').at(-1),
              agent: 'tasks',
              permission: path.endsWith(child) ? childRules : [],
              time: { created },
              ...(path.endsWith(child) ? { parentID: sid } : {})
            }
    return new Response(JSON.stringify(data), { status: 200 })
  })
  opts = {
    folder,
    platform: 'darwin',
    excluded: [],
    server: () => ref,
    enabled: () => enabled,
    baseline,
    fetchImpl: fetchImpl as typeof fetch
  }
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})
const issue = async (h: ReturnType<typeof createOwnDeleteRuntimeHandler>) => {
  const r = (await h.handle({ action: 'ticket', sessionId: currentSession, callId })) as { ticket?: string }
  return r.ticket
}
const deleteBody = (ticket: string, paths = [join(folder, 'nuevo')], changes: Record<string, unknown> = {}) => ({
  action: 'delete',
  ticket,
  cwd: folder,
  paths,
  options: { recursive: false, directory: false, force: false, verbose: false },
  verb: 'rm',
  ...changes
})
const remove = (h: ReturnType<typeof createOwnDeleteRuntimeHandler>, ticket: string, paths?: string[], changes?: Record<string, unknown>) =>
  h.handle(deleteBody(ticket, paths, changes), undefined, ticket)

describe('billete efímero por llamada bash', () => {
  it('verbose registra cada archivo y directorio que se eliminó realmente, en orden de borrado', async () => {
    mkdirSync(join(folder, 'arbol', 'vacio'), { recursive: true })
    writeFileSync(join(folder, 'arbol', 'hijo.txt'), 'propio')
    const h = createOwnDeleteRuntimeHandler(opts)
    const ticket = (await issue(h))!
    const result = await remove(h, ticket, [join(folder, 'arbol'), join(folder, 'viejo')], {
      options: { recursive: true, directory: false, force: false, verbose: true }
    })
    expect(result).toEqual({
      deleted: [true, false],
      removed: [
        { path: join(folder, 'arbol', 'hijo.txt'), isDirectory: false },
        { path: join(folder, 'arbol', 'vacio'), isDirectory: true },
        { path: join(folder, 'arbol'), isDirectory: true }
      ]
    })
    expect(readFileSync(join(folder, 'viejo'), 'utf8')).toBe('previo')
  })
  it('acepta formas compuestas sin adelantar el borrado y resuelve cada ruta individualmente', async () => {
    const h = createOwnDeleteRuntimeHandler(opts)
    const ticket = (await issue(h))!
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(h.acceptsTicket(ticket)).toBe(true)
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
    expect(await remove(h, ticket, [join(folder, 'nuevo'), join(folder, 'viejo')])).toEqual({ deleted: [true, false] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(false)
    expect(readFileSync(join(folder, 'viejo'), 'utf8')).toBe('previo')
    writeFileSync(join(folder, 'segundo'), 'otro propio')
    expect(await remove(h, ticket, [join(folder, 'segundo')])).toEqual({ deleted: [true] })
  })
  it('no exige coincidencia textual con la orden original; permite crear y borrar durante la misma llamada', async () => {
    command = 'printf hola > borrador.txt && cat borrador.txt && rm borrador.txt && (test ! -e borrador.txt)'
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    writeFileSync(join(folder, 'borrador.txt'), 'hola')
    expect(await remove(h, ticket, [join(folder, 'borrador.txt')])).toEqual({ deleted: [true] })
  })
  it('una hija usa el inventario de la sesión raíz verificada', async () => {
    currentSession = child
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(await remove(h, ticket)).toEqual({ deleted: [true] })
    expect(baseline).toHaveBeenCalledWith(folder, sid, created)
  })
  it.each(['sin mensajes', 'terminada', 'cancelada', 'parte terminada', 'otra sesión'])('rechaza al emitir: %s', async (kind) => {
    if (kind === 'sin mensajes') noMessages = true
    if (kind === 'terminada') completed = true
    if (kind === 'cancelada') cancelled = true
    if (kind === 'parte terminada') running = false
    const h = createOwnDeleteRuntimeHandler(opts)
    const body = { action: 'ticket', sessionId: kind === 'otra sesión' ? child : sid, callId }
    expect(await h.handle(body)).toEqual({})
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it.each([
    'sin mensajes',
    'terminada',
    'cancelada',
    'parte terminada',
    'servidor nuevo',
    'permiso de borrar',
    'caducado',
    'sin inventario'
  ])('revalida al borrar: %s', async (kind) => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    if (kind === 'sin mensajes') noMessages = true
    if (kind === 'terminada') completed = true
    if (kind === 'cancelada') cancelled = true
    if (kind === 'parte terminada') running = false
    if (kind === 'servidor nuevo') ref = { ...ref!, authorization: 'Basic replacement' }
    if (kind === 'permiso de borrar') enabled = false
    if (kind === 'sin inventario') baseline.mockReturnValue(null)
    if (kind === 'caducado') {
      vi.useFakeTimers()
      vi.setSystemTime(Date.now() + OWN_DELETE_TICKET_TTL_MS + 1)
    }
    expect(await remove(h, ticket)).toEqual({ deleted: [] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('un ticket no puede emitir otros ni sustituir la autenticación de su cuerpo', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(await h.handle({ action: 'ticket', sessionId: sid, callId }, undefined, ticket)).toEqual({})
    expect(await h.handle(deleteBody(ticket))).toEqual({ deleted: [] })
    expect(await h.handle(deleteBody(ticket), undefined, ticket + 'x')).toEqual({ deleted: [] })
    expect(h.acceptsTicket('otro')).toBe(false)
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('Detener y cambio de servidor durante consulta no mutan', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    const original = fetchImpl.getMockImplementation()!
    fetchImpl.mockImplementation(async (...args) => {
      const r = await original(...args)
      ref = null
      return r
    })
    expect(await remove(h, ticket)).toEqual({ deleted: [] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('abort de petición durante consulta no muta', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    const controller = new AbortController(),
      original = fetchImpl.getMockImplementation()!
    fetchImpl.mockImplementation(async (...args) => {
      const r = await original(...args)
      controller.abort()
      return r
    })
    expect(await h.handle(deleteBody(ticket), controller.signal, ticket)).toEqual({ deleted: [] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('fallo de app/motor devuelve negativa', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    fetchImpl.mockRejectedValue(new Error('down'))
    expect(await remove(h, ticket)).toEqual({ deleted: [] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
})

describe('permisos en cada ancestro y destino', () => {
  it.each(['ask', 'deny'])('no elude bash general %s', async (action) => {
    rule.push({ permission: 'bash', pattern: '*', action })
    expect(await issue(createOwnDeleteRuntimeHandler(opts))).toBeUndefined()
  })
  it.each(['ask', 'deny'])('revalida permiso rm %s incluso si la llamada empieza con cat', async (action) => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    rule.push({ permission: 'bash', pattern: 'rm *', action })
    expect(await remove(h, ticket)).toEqual({ deleted: [false] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it.each(['ask', 'deny'])('no elude permiso por archivo %s', async (action) => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    rule.push({ permission: 'bash', pattern: 'rm nuevo', action })
    expect(await remove(h, ticket)).toEqual({ deleted: [false] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('no elude deny aunque una regla posterior permita el mismo patrón', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    rule.push({ permission: 'bash', pattern: 'rm nuevo', action: 'deny' }, { permission: 'bash', pattern: 'rm *', action: 'allow' })
    expect(await remove(h, ticket)).toEqual({ deleted: [false] })
  })
  it.each(['rm -v *', 'rm -rf *', 'rm -i *', '*nuevo*'])(
    'una regla personalizada %s no se elude al reconstruir opciones',
    async (pattern) => {
      command = 'echo inicio; rm -vrf nuevo'
      const h = createOwnDeleteRuntimeHandler(opts),
        ticket = (await issue(h))!
      rule.push({ permission: 'bash', pattern, action: 'deny' })
      const result = (await remove(h, ticket)) as { deleted: boolean[] }
      expect(result.deleted.every((value) => value === false)).toBe(true)
      expect(existsSync(join(folder, 'nuevo'))).toBe(true)
    }
  )
  it('la hija no puede eludir los permisos de su raíz', async () => {
    currentSession = child
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    rule.push({ permission: 'bash', pattern: 'rm nuevo', action: 'deny' })
    expect(await remove(h, ticket)).toEqual({ deleted: [false] })
  })
})

describe('rutas y opciones sin ampliar el aislamiento', () => {
  it('temporales se devuelven al sistema incluso dentro de la carpeta', async () => {
    mkdirSync(join(folder, '.lazunox', 'trabajo'), { recursive: true })
    const p = join(folder, '.lazunox', 'trabajo', 'tmp')
    writeFileSync(p, 'tmp')
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(await remove(h, ticket, [p])).toEqual({ deleted: [false] })
    expect(existsSync(p)).toBe(true)
  })
  it.each(['outside', 'cwd-link', 'parent-link', 'file-link', 'hardlink-excluded', 'cwd-ancestor'])('rechaza %s', async (kind) => {
    let target = join(folder, 'nuevo'),
      cwd = folder
    if (kind === 'outside') {
      target = join(dir, 'externo')
      writeFileSync(target, 'x')
    }
    if (kind === 'cwd-link') {
      symlinkSync(folder, join(folder, 'enlace'), 'junction')
      cwd = join(folder, 'enlace')
    }
    if (kind === 'parent-link') {
      symlinkSync(folder, join(folder, 'enlace'), 'junction')
      target = join(folder, 'enlace', 'nuevo')
    }
    if (kind === 'file-link') {
      symlinkSync(target, join(folder, 'enlace'))
      target = join(folder, 'enlace')
    }
    if (kind === 'hardlink-excluded') opts.excluded = [target]
    if (kind === 'cwd-ancestor') {
      mkdirSync(join(folder, 'sub'))
      mkdirSync(join(folder, 'sub', 'actual'))
      cwd = join(folder, 'sub', 'actual')
      target = join(folder, 'sub')
    }
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    const r = await remove(h, ticket, [target], { cwd, options: { recursive: true, directory: false, force: false, verbose: false } })
    expect(r).not.toEqual({ deleted: [true] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it('rm -d borra archivo y directorio vacío, deja directorio con contenido', async () => {
    mkdirSync(join(folder, 'vacio'))
    mkdirSync(join(folder, 'lleno'))
    writeFileSync(join(folder, 'lleno', 'x'), 'x')
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(
      await remove(
        h,
        ticket,
        ['nuevo', 'vacio', 'lleno'].map((p) => join(folder, p)),
        { options: { recursive: false, directory: true, force: false, verbose: false } }
      )
    ).toEqual({ deleted: [true, true, false] })
  })
  it('rmdir requiere directorio vacío y unlink solo archivo', async () => {
    mkdirSync(join(folder, 'vacio'))
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(
      await remove(h, ticket, [join(folder, 'vacio')], {
        verb: 'rmdir',
        options: { recursive: false, directory: true, force: false, verbose: false }
      })
    ).toEqual({ deleted: [true] })
    expect(await remove(h, ticket, [join(folder, 'nuevo')], { verb: 'unlink' })).toEqual({ deleted: [true] })
  })
  it('JSON estricto, opciones inválidas, traversal y slash final caen al sistema', async () => {
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    for (const changes of [
      { extra: true },
      { options: { recursive: false } },
      { options: { recursive: false, directory: false, force: false, verbose: false, danger: true } },
      { paths: [folder + '/sub/../nuevo'] },
      { paths: [folder + '/nuevo/'] },
      { paths: [folder + '/nuevo/.'] },
      { verb: 'mv' },
      { verb: 'unlink', options: { recursive: true, directory: false, force: false, verbose: false } }
    ])
      expect(await remove(h, ticket, undefined, changes)).toEqual({ deleted: [] })
    expect(existsSync(join(folder, 'nuevo'))).toBe(true)
  })
  it.each(['C', 'D'])('WSL nunca traduce otra unidad (%s)', async (drive) => {
    // La traducción se rechaza antes de cualquier acceso al sistema del anfitrión; no afirma Landlock real.
    opts.platform = 'win32'
    opts.folder = `${drive}:\\Tarea`
    ref = { ...ref!, directory: `/win/${drive.toLowerCase()}/Tarea` }
    const h = createOwnDeleteRuntimeHandler(opts),
      ticket = (await issue(h))!
    expect(await h.handle(deleteBody(ticket, ['/win/z/otra/nuevo'], { cwd: ref.directory }), undefined, ticket)).toEqual({ deleted: [] })
  })
})
