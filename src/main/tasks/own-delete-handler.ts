/** Frontera de main: carpeta fija por servidor, sesión/ancestría verificadas contra el motor y sin permisos generales. */
import { wildcardMatch } from '@shared/permission-rules'
import { isAbsolute, relative, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { ensureRealDir } from './no-follow'
import { deleteEngineMessages, hasLiveDeleteCall } from './own-delete-engine'
import { mapOwnDeletePaths } from './own-delete-paths'
import { createGuardInfoHandler, GUARD_SESSION_ID_RE, type GuardServerRef } from './guard-info'
import { deleteOwnPaths, parseOwnDelete, type DeleteBaseline } from './own-delete'

type Rule = { permission: string; pattern: string; action: string }
type Session = { id: string; parentID?: string; agent?: string; permission: Rule[]; created?: number }

export function createOwnDeleteHandler(opts: {
  folder: string
  platform: NodeJS.Platform
  excluded: string[]
  server: () => GuardServerRef | null
  /** Se vuelve a comprobar también al ejecutar, por si se retiró el servidor o cambió su permiso. */
  enabled: () => boolean
  baseline: (folder: string, sessionId: string, created: number) => DeleteBaseline | null
  fetchImpl?: typeof fetch
}): (body: unknown, signal?: AbortSignal) => Promise<{ deleted: boolean }> {
  const info = createGuardInfoHandler({ server: opts.server, fetchImpl: opts.fetchImpl, includeCreated: true })
  const no = { deleted: false }
  const attempts = new Map<string, { deleted: boolean }>()
  return async (body, signal) => {
    if (signal?.aborted || !opts.enabled() || !body || typeof body !== 'object' || Array.isArray(body)) return no
    const b = body as Record<string, unknown>
    if (
      Object.keys(b).some((k) => !['sessionId', 'callId', 'command', 'workdir'].includes(k)) ||
      typeof b.sessionId !== 'string' ||
      !GUARD_SESSION_ID_RE.test(b.sessionId) ||
      typeof b.command !== 'string' ||
      typeof b.callId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(b.callId) ||
      (b.workdir !== undefined && typeof b.workdir !== 'string')
    )
      return no
    const key = b.sessionId + ':' + b.callId
    if (attempts.has(key)) return attempts.get(key)!
    if (attempts.size >= 5000) return no
    const command = parseOwnDelete(b.command)
    if (!command) return no
    const ref = opts.server()
    if (!ref) return no
    // El cwd por defecto es el directorio del servidor; las rutas de WSL se traducen solo contra ESA carpeta.
    const cwd = typeof b.workdir === 'string' ? b.workdir : ref.directory
    const mapped = mapOwnDeletePaths(opts.folder, opts.platform, cwd, command.paths)
    if (!mapped) return no
    const hostCwd = mapped.cwd
    try {
      const rel = relative(opts.folder, hostCwd)
      if (isAbsolute(rel) || rel.split(sep).includes('..')) return no
      if (rel) ensureRealDir(opts.folder, hostCwd)
      if (
        opts.excluded.some((e) => {
          const r = relative(e, hostCwd)
          return !r || (!isAbsolute(r) && !r.split(sep).includes('..'))
        })
      )
        return no
      if (realpathSync(hostCwd) !== realpathSync(opts.folder) && !rel) return no
    } catch {
      return no
    }
    const agentsReply = await info('/agents', new URLSearchParams())
    if (agentsReply.status !== 200 || !Array.isArray(agentsReply.body)) return no
    const agents = agentsReply.body as Array<{ name: string; permission: Rule[] }>
    let id = b.sessionId
    const seen = new Set<string>()
    let root: Session | null = null
    for (let depth = 0; depth <= 6; depth++) {
      if (seen.has(id)) return no
      seen.add(id)
      const reply = await info('/session', new URLSearchParams({ id }))
      if (reply.status !== 200) return no
      const s = reply.body as Session
      const agent = agents.find((a) => a.name === s.agent)
      if (!agent) return no
      const rules = [...agent.permission, ...s.permission]
      const action = (cmd: string): string | undefined =>
        rules.filter((r) => wildcardMatch('bash', r.permission) && wildcardMatch(cmd, r.pattern)).at(-1)?.action
      // Ningún deny se elude; tampoco se actúa antes de una pregunta general de bash.
      if (rules.some((r) => r.action === 'deny' && wildcardMatch('bash', r.permission) && wildcardMatch(b.command as string, r.pattern)))
        return no
      if (action(':') !== 'allow' || !['allow', 'ask'].includes(action(b.command) ?? '')) return no
      if (!s.parentID) {
        root = s
        break
      }
      if (!GUARD_SESSION_ID_RE.test(s.parentID)) return no
      id = s.parentID
    }
    if (!root || typeof root.created !== 'number') return no
    const baseline = opts.baseline(opts.folder, root.id, root.created)
    const current = opts.server()
    if (
      !baseline ||
      !current ||
      current.baseUrl !== ref.baseUrl ||
      current.authorization !== ref.authorization ||
      current.directory !== ref.directory ||
      !opts.enabled()
    )
      return no
    const messages = await deleteEngineMessages(ref, b.sessionId, opts.fetchImpl)
    if (!messages || !hasLiveDeleteCall(messages, b.sessionId, b.callId, b.command, b.workdir) || !opts.enabled() || signal?.aborted)
      return no
    const last = opts.server()
    if (!last || last.baseUrl !== ref.baseUrl || last.authorization !== ref.authorization || attempts.has(key))
      return attempts.get(key) ?? no
    // Una llamada solo puede mutar una vez, incluso si se pierde su respuesta o se reproduce su token.
    attempts.set(key, no)
    const result = { deleted: deleteOwnPaths(opts.folder, { ...command, paths: mapped.paths }, baseline, opts.excluded) }
    attempts.set(key, result)
    return result
  }
}
