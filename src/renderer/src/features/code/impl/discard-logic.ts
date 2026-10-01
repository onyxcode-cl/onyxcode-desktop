/**
 * Lógica pura del diálogo «Descartar cambios» (panel Cambios de Code): qué se le dice al usuario que
 * va a perder, según el tipo de archivo. La operación real vive en main (`git:discard`).
 */
import { t as tg } from '@shared/i18n'
import type { GitChangeKind } from '@shared/ipc-code'

export interface DiscardCandidate {
  path: string
  origPath?: string
  kind: GitChangeKind
  staged: boolean
}

/** Los archivos nuevos (sin seguimiento o añadidos/renombrados al índice) van a la Papelera. */
export function goesToTrash(f: Pick<DiscardCandidate, 'kind'>): boolean {
  return f.kind === 'untracked' || f.kind === 'added' || f.kind === 'renamed' || f.kind === 'copied'
}

/** Solo se pueden descartar archivos con cambios reales: no conflictos ni ignorados. */
export function canDiscard(f: Pick<DiscardCandidate, 'kind'>): boolean {
  return f.kind !== 'conflicted' && f.kind !== 'ignored'
}

/** Texto del diálogo: qué pasa con el archivo y la lista de rutas afectadas (una por línea). */
export function discardMessage(f: DiscardCandidate): string {
  const lines: string[] = []
  if (f.kind === 'untracked' || f.kind === 'added' || f.kind === 'copied') lines.push(tg('code.changes.discardNew'))
  else if (f.kind === 'renamed' && f.origPath) lines.push(tg('code.changes.discardRenamed', { orig: f.origPath }))
  else if (f.kind === 'renamed') lines.push(tg('code.changes.discardNew'))
  else if (f.kind === 'deleted') lines.push(tg('code.changes.discardDeleted'))
  else lines.push(tg('code.changes.discardLost'))
  if (f.staged && !goesToTrash(f)) lines.push(tg('code.changes.discardLostStaged'))
  if (!goesToTrash(f)) lines.push(tg('code.changes.discardUndoable'))
  const affected = f.kind === 'renamed' && f.origPath ? [f.origPath, f.path] : [f.path]
  return `${lines.join(' ')}\n\n${tg('code.changes.discardAffects')}\n${affected.map((p) => `• ${p}`).join('\n')}`
}
