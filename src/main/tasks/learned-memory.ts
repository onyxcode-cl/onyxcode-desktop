/**
 * Memoria APRENDIDA (decisión del dueño, 2026-10-07): hechos que el agente de Tareas PROPONE al final de un
 * turno (bloque ```lazunox-memoria```, ver `@shared/memory-proposal`) y que el usuario aprueba desde una
 * tarjeta. Nunca la escribe el agente: solo este módulo, desde `main`, tras la aprobación.
 *
 * Vive en `userData/memoria/` (NO dentro de la carpeta del proyecto, a diferencia de la memoria vieja de
 * `.lazunox/memoria.md`): así el sandbox de Tareas (que ya deniega leer/escribir `userData`) hace físicamente
 * imposible que el agente la toque sin pasar por esta puerta, y nunca viaja por accidente con un `git push`,
 * iCloud o Dropbox de la carpeta del proyecto.
 *
 * Revalida TODO lo que llega por IPC (nunca confía en el renderer): tipo, largo, y que no contenga un
 * secreto (si enmascararlo cambia el texto, la propuesta se descarta en silencio, sin guardar nada de ella).
 * Las heurísticas de dato personal o de inyección (`@shared/memory-proposal`) son solo para avisar en la
 * tarjeta: aquí NO bloquean, porque la aprobación humana ya pasó.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { maskSecretPatterns } from '@shared/redact-patterns'
import {
  addEntry,
  clampEntryText,
  formatForPrompt,
  newEntryId,
  parseLearnedMemory,
  removeEntry,
  serializeLearnedMemory,
  type LearnedMemoryEntry,
  type LearnedMemoryScope,
  type LearnedMemoryType
} from '@shared/memory-format'

const VALID_TYPES = new Set<LearnedMemoryType>(['preferencia', 'convencion', 'decision', 'solucion'])

export interface LearnedMemoryBundle {
  usuario: LearnedMemoryEntry[]
  proyecto: LearnedMemoryEntry[]
}

/** Lo que llega por IPC desde la tarjeta (ya elegido/editado por el usuario). Se revalida igual que si viniera de cualquier parte. */
export interface AcceptedProposal {
  alcance: LearnedMemoryScope
  tipo: string
  texto: string
  porque?: string
}

function memoriaDir(): string {
  return join(app.getPath('userData'), 'memoria')
}
function userMemoryPath(): string {
  return join(memoriaDir(), 'usuario.md')
}
/** `<basename-slug>-<sha256(realpath)·8>.md`: estable para la misma carpeta, sin colisiones entre proyectos de igual nombre. */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'proyecto'
}
function projectMemoryPath(folder: string): string {
  let real = folder
  try {
    real = realpathSync(folder)
  } catch {
    // La carpeta ya la validó el llamador (`assertInsideApproved`); si por lo que sea no se puede resolver,
    // se sigue con la ruta tal cual en vez de fallar: es solo la base del hash, no un control de acceso.
  }
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 8)
  return join(memoriaDir(), 'proyectos', `${slugify(basename(real))}-${hash}.md`)
}

function readFile(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}
function titleFor(scope: LearnedMemoryScope, folder: string | null): string {
  return scope === 'usuario' ? 'Memoria aprendida (global)' : `Memoria aprendida de «${folder ? basename(folder) : ''}»`
}

/** Lee ambos alcances (el de proyecto solo si se pasa `folder`; sin él, vacío). */
export function getLearnedMemory(folder?: string | null): LearnedMemoryBundle {
  return {
    usuario: parseLearnedMemory(readFile(userMemoryPath())),
    proyecto: folder ? parseLearnedMemory(readFile(projectMemoryPath(folder))) : []
  }
}

/** Texto corto listo para inyectar en el prompt (sin metadatos), por alcance. */
export function learnedMemoryForPrompt(folder?: string | null): { usuario: string; proyecto: string } {
  const { usuario, proyecto } = getLearnedMemory(folder)
  return { usuario: formatForPrompt(usuario), proyecto: formatForPrompt(proyecto) }
}

/**
 * Revalida y agrega las propuestas ya elegidas por el usuario. `folder` debe venir validado por el llamador
 * (`tasks.assertInsideApproved`) cuando haya alguna de alcance `proyecto`; sin `folder` esas se ignoran.
 * Una propuesta con un secreto se descarta por completo, sin guardar ni el resto de sus campos.
 */
export function acceptLearnedMemory(
  folder: string | null,
  proposals: readonly AcceptedProposal[]
): { bundle: LearnedMemoryBundle; savedCount: number } {
  let usuario = parseLearnedMemory(readFile(userMemoryPath()))
  let proyecto = folder ? parseLearnedMemory(readFile(projectMemoryPath(folder))) : []
  let savedUser = 0
  let savedProject = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const p of (proposals ?? []).slice(0, 20)) {
    if (!p || (p.alcance !== 'usuario' && p.alcance !== 'proyecto')) continue
    if (!VALID_TYPES.has(p.tipo as LearnedMemoryType)) continue
    const texto = clampEntryText(String(p.texto ?? ''))
    if (!texto) continue
    const porque = typeof p.porque === 'string' && p.porque.trim() ? clampEntryText(p.porque) : undefined
    if (maskSecretPatterns(texto) !== texto) continue
    if (porque && maskSecretPatterns(porque) !== porque) continue
    const entry: LearnedMemoryEntry = {
      id: newEntryId(),
      tipo: p.tipo as LearnedMemoryType,
      texto,
      fecha: today,
      ...(porque ? { porque } : {})
    }
    if (p.alcance === 'usuario') {
      const r = addEntry(usuario, entry, 'usuario')
      usuario = r.entries
      if (r.added) savedUser++
    } else if (folder) {
      const r = addEntry(proyecto, entry, 'proyecto')
      proyecto = r.entries
      if (r.added) savedProject++
    }
  }
  if (savedUser > 0)
    atomicWrite(userMemoryPath(), serializeLearnedMemory(usuario, { alcance: 'usuario', titulo: titleFor('usuario', null) }))
  if (savedProject > 0 && folder) {
    atomicWrite(
      projectMemoryPath(folder),
      serializeLearnedMemory(proyecto, { alcance: 'proyecto', carpeta: folder, titulo: titleFor('proyecto', folder) })
    )
  }
  return { bundle: { usuario, proyecto }, savedCount: savedUser + savedProject }
}

export function removeLearnedMemoryEntry(scope: LearnedMemoryScope, folder: string | null, id: string): LearnedMemoryBundle {
  if (scope === 'usuario') {
    const { entries, removed } = removeEntry(parseLearnedMemory(readFile(userMemoryPath())), id)
    if (removed) atomicWrite(userMemoryPath(), serializeLearnedMemory(entries, { alcance: 'usuario', titulo: titleFor('usuario', null) }))
    return { usuario: entries, proyecto: folder ? parseLearnedMemory(readFile(projectMemoryPath(folder))) : [] }
  }
  if (!folder) return getLearnedMemory(null)
  const { entries, removed } = removeEntry(parseLearnedMemory(readFile(projectMemoryPath(folder))), id)
  if (removed) {
    atomicWrite(
      projectMemoryPath(folder),
      serializeLearnedMemory(entries, { alcance: 'proyecto', carpeta: folder, titulo: titleFor('proyecto', folder) })
    )
  }
  return { usuario: parseLearnedMemory(readFile(userMemoryPath())), proyecto: entries }
}

export function clearLearnedMemory(scope: LearnedMemoryScope, folder: string | null): LearnedMemoryBundle {
  try {
    if (scope === 'usuario') unlinkSync(userMemoryPath())
    else if (folder) unlinkSync(projectMemoryPath(folder))
  } catch {
    // Ya no existía: nada que borrar.
  }
  return getLearnedMemory(folder)
}
