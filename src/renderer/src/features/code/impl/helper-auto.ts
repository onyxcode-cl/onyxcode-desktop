/** Automático de una conversación: solo hereda de una raíz conocida y dentro del mismo proyecto. */
import type { Session } from '@opencode-ai/sdk/v2/client'
import { approvalKindOf, isExecOrGitConfigPath, wildcardMatch, type PermissionRuleLike } from '@shared/permission-rules'
import type { PendingPermission } from './types'
import { sameDir } from './open-projects'

export function approvalSession(
  sessions: Record<string, Session | undefined>,
  projects: Record<string, string>,
  sessionID: string
): Session | undefined {
  const start = sessions[sessionID]
  if (!start?.parentID) return start
  const project = projects[sessionID]
  if (!project) return undefined
  const seen = new Set<string>()
  let current = start
  for (let depth = 0; depth < 6; depth++) {
    if (seen.has(current.id) || !sameDir(projects[current.id] ?? '', project)) return undefined
    seen.add(current.id)
    if (!current.parentID) return approvalKindOf(current.permission) === 'auto' ? current : undefined
    const parent = sessions[current.parentID]
    if (!parent) return undefined
    current = parent
  }
  return undefined
}

function action(rules: readonly PermissionRuleLike[], permission: string, path: string): string | undefined {
  return [...rules].reverse().find((r) => wildcardMatch(permission, r.permission) && wildcardMatch(path, r.pattern))?.action
}

/** El motor conserva la puerta external_directory y la marca de rutas protegidas. Nunca guarda «siempre». */
export function autoHelperEdit(p: PendingPermission, root: Session, child: Session, project: string): boolean {
  if (root.id === child.id || approvalKindOf(root.permission) !== 'auto' || !['edit', 'write'].includes(p.permission)) return false
  if (!p.patterns.length || !project || !/^(\/|[a-z]:[\\/])/i.test(project)) return false
  const windows = /^[a-z]:/i.test(project)
  const clean = (v: string): string => {
    const path = v.replaceAll('\\', '/').replace(/\/$/, '')
    return windows ? path.toLowerCase() : path
  }
  const base = clean(project)
  return p.patterns.every((raw) => {
    const path = clean(raw)
    if (!path || /[*?\[\]{}\u0000-\u001f]/.test(path) || path.split('/').some((s) => s === '..' || s === '.')) return false
    const absolute = /^(\/|[a-z]:)/i.test(path)
    if (absolute && !path.startsWith(`${base}/`)) return false
    if (windows && /[: ]|\.$/.test(path.slice(absolute ? 2 : 0))) return false
    const relative = absolute ? path.slice(base.length + 1) : path
    if (isExecOrGitConfigPath(relative)) return false
    const own = action(child.permission ?? [], p.permission, raw)
    if (own === 'deny') return false
    return [raw, relative].every((candidate) => action(root.permission ?? [], p.permission, candidate) === 'allow')
  })
}
