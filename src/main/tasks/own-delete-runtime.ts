/** Borrado en el momento de ejecutar rm: billetes efímeros por llamada, nunca credenciales del motor en el shell. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, posix, relative, sep } from 'node:path'
import { wildcardMatch } from '@shared/permission-rules'
import { createGuardInfoHandler, GUARD_SESSION_ID_RE, type GuardServerRef } from './guard-info'
import { deleteEngineMessages } from './own-delete-engine'
import { mapOwnDeletePaths } from './own-delete-paths'
import { deleteOwnPaths, type DeleteBaseline } from './own-delete'
import { ensureRealDir } from './no-follow'

type Rule = { permission: string; pattern: string; action: string }
type Session = { id: string; parentID?: string; agent?: string; permission: Rule[]; created?: number }
type LiveCall = { command: string; workdir?: string }
type Ticket = { sessionId: string; callId: string; ref: GuardServerRef; expires: number }
type Options = { recursive: boolean; directory: boolean; force: boolean; verbose: boolean }
export const OWN_DELETE_TICKET_TTL_MS = 60 * 60 * 1000
const MAX_TICKETS = 5000
// Sin analizar shell no podemos reconstruir comillas, agrupación u orden de opciones. Solo estas
// reglas base negativas son disjuntas de rm/rmdir/unlink. Toda otra regla no permisiva conserva
// el camino nativo (y su tarjeta); ni siquiera una variante -v/-rf puede saltársela.
const DISJOINT_BASE_PATTERNS = new Set(['git push*', 'sudo *', 'shutdown*', 'find * -delete*', 'trash *'])
const sameServer = (a: GuardServerRef | null, b: GuardServerRef): boolean =>
  !!a && a.baseUrl === b.baseUrl && a.authorization === b.authorization && a.directory === b.directory
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).every((k) => keys.includes(k))
const equalToken = (a: string, b: string): boolean => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

/** No se acepta command/cwd suministrado por el cliente para identificar la llamada: procede del motor de este servidor. */
function liveCall(messages: unknown[], sessionId: string, callId: string): LiveCall | null {
  for (const value of messages) {
    if (!object(value) || !object(value.info) || !Array.isArray(value.parts)) continue
    const info = value.info
    if (info.sessionID !== sessionId || info.role !== 'assistant' || info.error || (object(info.time) && info.time.completed)) continue
    for (const part of value.parts) {
      if (!object(part) || part.type !== 'tool' || part.tool !== 'bash' || part.sessionID !== sessionId || part.callID !== callId) continue
      if (!object(part.state) || part.state.status !== 'running' || !object(part.state.input)) continue
      const input = part.state.input
      if (typeof input.command !== 'string' || (input.workdir !== undefined && typeof input.workdir !== 'string')) continue
      return { command: input.command, ...(typeof input.workdir === 'string' ? { workdir: input.workdir } : {}) }
    }
  }
  return null
}

export interface OwnDeleteRuntimeOptions {
  folder: string
  platform: NodeJS.Platform
  excluded: string[]
  server: () => GuardServerRef | null
  enabled: () => boolean
  baseline: (folder: string, sessionId: string, created: number) => DeleteBaseline | null
  fetchImpl?: typeof fetch
}

export function createOwnDeleteRuntimeHandler(opts: OwnDeleteRuntimeOptions): {
  handle: (body: unknown, signal?: AbortSignal, bearer?: string) => Promise<unknown>
  acceptsTicket: (token: string) => boolean
} {
  const tickets = new Map<string, Ticket>()
  const info = createGuardInfoHandler({ server: opts.server, fetchImpl: opts.fetchImpl, includeCreated: true })
  const valid = (ticket: Ticket, signal?: AbortSignal): boolean =>
    !signal?.aborted && opts.enabled() && ticket.expires > Date.now() && sameServer(opts.server(), ticket.ref)
  const acceptsTicket = (token: string): boolean => {
    const t = tickets.get(token)
    return !!t && valid(t)
  }
  const context = async (
    ticket: Ticket,
    signal?: AbortSignal
  ): Promise<{ baseline: DeleteBaseline; rules: Rule[][]; call: LiveCall } | null> => {
    if (!valid(ticket, signal)) return null
    const agentsReply = await info('/agents', new URLSearchParams())
    if (agentsReply.status !== 200 || !Array.isArray(agentsReply.body)) return null
    const agents = agentsReply.body as Array<{ name: string; permission: Rule[] }>
    const ancestors = new Set<string>()
    const rules: Rule[][] = []
    let root: Session | null = null
    let id = ticket.sessionId
    for (let depth = 0; depth <= 6; depth++) {
      if (ancestors.has(id) || !valid(ticket, signal)) return null
      ancestors.add(id)
      const reply = await info('/session', new URLSearchParams({ id }))
      if (reply.status !== 200) return null
      const s = reply.body as Session
      const agent = agents.find((a) => a.name === s.agent)
      if (!agent) return null
      rules.push([...agent.permission, ...s.permission])
      if (!s.parentID) {
        root = s
        break
      }
      if (!GUARD_SESSION_ID_RE.test(s.parentID)) return null
      id = s.parentID
    }
    if (!root || typeof root.created !== 'number') return null
    const baseline = opts.baseline(opts.folder, root.id, root.created)
    if (!baseline || !valid(ticket, signal)) return null
    const messages = await deleteEngineMessages(ticket.ref, ticket.sessionId, opts.fetchImpl)
    const call = messages && liveCall(messages, ticket.sessionId, ticket.callId)
    if (!call || !valid(ticket, signal)) return null
    // La regla de la carpeta permite rm, pero ni una denegación ni una pregunta general se eluden.
    for (const r of rules) {
      const matches = (command: string): Rule[] => r.filter((v) => wildcardMatch('bash', v.permission) && wildcardMatch(command, v.pattern))
      if (matches(':').at(-1)?.action !== 'allow' || matches(call.command).at(-1)?.action !== 'allow') return null
      if (matches(call.command).some((v) => v.action === 'deny')) return null
    }
    return { baseline, rules, call }
  }
  const handle = async (body: unknown, signal?: AbortSignal, bearer?: string): Promise<unknown> => {
    if (!object(body) || signal?.aborted || !opts.enabled()) return { deleted: [] }
    if (body.action === 'ticket') {
      if (
        bearer !== undefined ||
        !exact(body, ['action', 'sessionId', 'callId']) ||
        typeof body.sessionId !== 'string' ||
        !GUARD_SESSION_ID_RE.test(body.sessionId) ||
        typeof body.callId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(body.callId)
      )
        return {}
      for (const [key, ticket] of tickets) if (!valid(ticket)) tickets.delete(key)
      if (tickets.size >= MAX_TICKETS) return {}
      const ref = opts.server()
      if (!ref) return {}
      const ticket: Ticket = { sessionId: body.sessionId, callId: body.callId, ref, expires: Date.now() + OWN_DELETE_TICKET_TTL_MS }
      if (!(await context(ticket, signal))) return {}
      if (!valid(ticket, signal) || tickets.size >= MAX_TICKETS) return {}
      const token = randomBytes(32).toString('base64url')
      tickets.set(token, ticket)
      return { ticket: token }
    }
    if (
      body.action !== 'delete' ||
      !exact(body, ['action', 'ticket', 'cwd', 'paths', 'options', 'verb']) ||
      typeof body.ticket !== 'string' ||
      typeof bearer !== 'string' ||
      !equalToken(body.ticket, bearer) ||
      typeof body.cwd !== 'string' ||
      !body.cwd.startsWith('/') ||
      body.cwd.includes('\0') ||
      !Array.isArray(body.paths) ||
      !body.paths.length ||
      body.paths.length > 100 ||
      !body.paths.every(
        (p) =>
          typeof p === 'string' &&
          p.startsWith('/') &&
          p.length <= 16000 &&
          !/[\x00-\x1f\x7f]/.test(p) &&
          !p.endsWith('/') &&
          !p.endsWith('/.') &&
          !p.split('/').includes('..')
      ) ||
      !object(body.options) ||
      !exact(body.options, ['recursive', 'directory', 'force', 'verbose']) ||
      !['recursive', 'directory', 'force', 'verbose'].every((k) => typeof (body.options as Record<string, unknown>)[k] === 'boolean') ||
      !['rm', 'rmdir', 'unlink'].includes(String(body.verb))
    )
      return { deleted: [] }
    const ticket = tickets.get(body.ticket)
    if (!ticket || !valid(ticket, signal)) return { deleted: [] }
    const options = body.options as Options
    const paths = body.paths as string[]
    if (
      (body.verb === 'unlink' && (paths.length !== 1 || Object.values(options).some(Boolean))) ||
      (body.verb === 'rmdir' && (!options.directory || options.recursive || options.force || options.verbose))
    )
      return { deleted: [] }
    const ctx = await context(ticket, signal)
    if (!ctx) return { deleted: [] }
    const mapped = mapOwnDeletePaths(opts.folder, opts.platform, body.cwd, paths)
    const originalCwd = mapOwnDeletePaths(opts.folder, opts.platform, ctx.call.workdir ?? ticket.ref.directory, [])?.cwd
    if (!mapped || !originalCwd) return { deleted: [] }
    const inside = (path: string, base: string): boolean => {
      const rel = relative(base, path)
      return !rel || (!isAbsolute(rel) && !rel.split(sep).includes('..'))
    }
    try {
      for (const cwd of [mapped.cwd, originalCwd]) {
        if (!inside(cwd, opts.folder) || opts.excluded.some((e) => inside(cwd, e))) return { deleted: [] }
        if (cwd === opts.folder) {
          if (realpathSync(cwd) !== opts.folder) return { deleted: [] }
        } else ensureRealDir(opts.folder, cwd)
      }
    } catch {
      return { deleted: [] }
    }
    const deleted: boolean[] = []
    const removed: Array<{ path: string; isDirectory: boolean }> = []
    // Ningún await a partir de aquí: se revalidó el servidor y la llamada justo antes de validar rutas y mutar.
    for (const [i, path] of mapped.paths.entries()) {
      if (!valid(ticket, signal)) {
        deleted.push(false)
        continue
      }
      const rel = relative(opts.folder, path).split(sep).join('/').normalize('NFD').toLowerCase()
      if (rel === '.lazunox/trabajo' || rel.startsWith('.lazunox/trabajo/') || inside(mapped.cwd, path) || inside(originalCwd, path)) {
        deleted.push(false)
        continue
      }
      const candidates = [paths[i], posix.relative(body.cwd, paths[i])]
      const suffix =
        (options.recursive ? ' -r' : '') + (options.force ? ' -f' : '') + (options.directory && body.verb === 'rm' ? ' -d' : '')
      const commands = candidates.flatMap((p) => [
        `${body.verb}${suffix} ${p}`,
        `${body.verb} ${p}`,
        `${body.verb}${suffix} -- '${p.replace(/'/g, "'\\''")}'`
      ])
      const permitted = ctx.rules.every(
        (rules) =>
          rules.every((r) => !wildcardMatch('bash', r.permission) || r.action === 'allow' || DISJOINT_BASE_PATTERNS.has(r.pattern)) &&
          commands.every((command) => {
            const matches = rules.filter((r) => wildcardMatch('bash', r.permission) && wildcardMatch(command, r.pattern))
            return matches.at(-1)?.action === 'allow' && !matches.some((r) => r.action === 'deny')
          })
      )
      if (!permitted) {
        deleted.push(false)
        continue
      }
      try {
        // rm -d admite archivos y carpetas vacías; deleteOwnPaths usa directory como «solo carpeta».
        if (dirname(path) !== opts.folder) ensureRealDir(opts.folder, dirname(path))
        let directory = body.verb === 'rmdir'
        if (body.verb === 'rm' && options.directory && !options.recursive) directory = lstatSync(path).isDirectory()
        deleted.push(
          deleteOwnPaths(
            opts.folder,
            { paths: [path], recursive: options.recursive, directory, force: options.force },
            ctx.baseline,
            opts.excluded,
            options.verbose
              ? (removedPath, isDirectory) => {
                  // El shell de WSL solo conoce sus rutas POSIX, nunca las del anfitrión Windows.
                  const child = relative(path, removedPath).split(sep).join('/')
                  removed.push({ path: child ? posix.join(paths[i], child) : paths[i], isDirectory })
                }
              : undefined
          )
        )
      } catch {
        deleted.push(false)
      }
    }
    return { deleted, ...(options.verbose ? { removed } : {}) }
  }
  return {
    handle: async (...args) => {
      try {
        return await handle(...args)
      } catch {
        return { deleted: [] }
      }
    },
    acceptsTicket
  }
}
