/** Lógica PURA del flujo de rama y pull request (sin React ni IPC): resúmenes, elecciones por defecto y armado de la revisión. */
import type { PrCheck, PrPushPlan, PrRemote, PrRepoStatus, PrReviewComment } from '@shared/ipc-pr'
import type { ProposedComment } from '@shared/pr-prompts'
import { maskSecretPatterns } from '@shared/redact-patterns'

export interface ChecksSummary {
  ok: number
  bad: number
  wait: number
}

/** Cuenta las comprobaciones: «neutral» y «omitida» no cuentan como fallo ni como espera. */
export function checksSummary(checks: readonly PrCheck[]): ChecksSummary {
  const s: ChecksSummary = { ok: 0, bad: 0, wait: 0 }
  for (const c of checks) {
    if (c.state === 'success') s.ok++
    else if (c.state === 'failure') s.bad++
    else if (c.state === 'pending') s.wait++
  }
  return s
}

/** Remoto por defecto: `origin` si existe; si no, el primero. */
export function pickRemote(remotes: readonly PrRemote[]): string | null {
  return remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? null
}

/** Rama de destino sugerida para el pull request. */
export function defaultBase(status: Pick<PrRepoStatus, 'defaultBranch' | 'branch'>): string {
  if (status.defaultBranch && status.defaultBranch !== status.branch) return status.defaultBranch
  return 'main'
}

/** ¿La rama actual ya está subida con todos sus commits? (tiene upstream y nada pendiente de subir). */
export function isPushed(status: Pick<PrRepoStatus, 'upstream' | 'ahead' | 'branch'>): boolean {
  return !!status.branch && !!status.upstream && status.ahead === 0
}

/** Motivos por los que NO se ofrece subir (la persona ve cada uno en lenguaje llano). */
export function hasBlocks(plan: Pick<PrPushPlan, 'blocked'>): boolean {
  return plan.blocked.length > 0
}

/** Un comentario propuesto por la IA, editable y con casilla. */
export interface ReviewItem extends ProposedComment {
  id: number
  include: boolean
}

export function toReviewItems(comments: readonly ProposedComment[]): ReviewItem[] {
  return comments.map((c, i) => ({ ...c, id: i, include: true }))
}

/** Lo que se publicará: solo los marcados y con texto, ya tapado de secretos (main lo vuelve a hacer). */
export function selectedComments(items: readonly ReviewItem[]): PrReviewComment[] {
  return items
    .filter((i) => i.include && i.body.trim())
    .map((i) => ({ path: i.path, line: i.line, body: maskSecretPatterns(i.body.trim()) }))
}

/** Texto que ve la persona en la confirmación para un comentario. */
export function commentLabel(c: Pick<PrReviewComment, 'path' | 'line'>): string {
  return c.line > 0 ? `${c.path}:${c.line}` : c.path
}
