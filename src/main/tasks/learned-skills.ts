/**
 * Escribe una SKILL ya aprobada por el usuario (propuesta por el agente con un bloque
 * ```lazunox-skill```, ver `@shared/skill-proposal`) en `<folder>/.opencode/skills/<name>/SKILL.md`.
 * El agente NUNCA la escribe él mismo. Formato compatible con agentskills.io (frontmatter YAML con
 * `name` y `description`). Revalida todo (nunca confía en el renderer): `name` tiene que pasar la
 * MISMA regex que `@shared/skill-proposal` (así la ruta final queda siempre dentro de la carpeta de
 * skills, nunca fuera); si la skill ya existe, se rechaza (nunca se sobrescribe: el usuario elige
 * otro nombre).
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { SKILL_NAME_RE, MAX_SKILL_NAME, MAX_SKILL_DESCRIPTION, MAX_SKILL_BODY_CHARS, MAX_SKILL_BODY_LINES } from '@shared/skill-proposal'

export interface SkillToWrite {
  name: string
  description: string
  body: string
}

export type WriteSkillResult =
  { ok: true; path: string } | { ok: false; reason: 'nombre-invalido' | 'campo-faltante' | 'demasiado-largo' | 'secreto' | 'ya-existe' }

function validName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_SKILL_NAME &&
    SKILL_NAME_RE.test(name) &&
    !name.includes('--') &&
    !name.includes('/') &&
    !name.includes('\\')
  )
}

function skillDir(folder: string, name: string): string {
  return join(folder, '.opencode', 'skills', name)
}

/** Ruta del `SKILL.md` que escribiría `writeApprovedSkill` para `folder`+`name` (para comprobar si ya existe, antes de aprobar). */
export function skillPathFor(folder: string, name: string): string | null {
  return validName(name) ? join(skillDir(folder, name), 'SKILL.md') : null
}

/** `true` si ya hay una skill con ese nombre en esa carpeta (el llamador debe rechazar la propuesta, no sobrescribir). */
export function skillAlreadyExists(folder: string, name: string): boolean {
  const path = skillPathFor(folder, name)
  return path !== null && existsSync(path)
}

function frontmatter(name: string, description: string): string {
  // YAML simple: escapa comillas dobles en description, la envuelve en comillas.
  const safeDesc = description.replace(/"/g, '\\"')
  return `---\nname: ${name}\ndescription: "${safeDesc}"\n---\n\n`
}

/**
 * Revalida y escribe `<folder>/.opencode/skills/<name>/SKILL.md`. `folder` debe venir ya validado por el
 * llamador (carpeta aprobada de Tareas, p. ej. `tasks.assertInsideApproved`). Nunca sobrescribe: si el
 * archivo ya existe, `{ok: false, reason: 'ya-existe'}`.
 */
export function writeApprovedSkill(folder: string, skill: SkillToWrite): WriteSkillResult {
  if (!validName(skill.name)) return { ok: false, reason: 'nombre-invalido' }
  const description = typeof skill.description === 'string' ? skill.description.trim() : ''
  const body = typeof skill.body === 'string' ? skill.body.trim() : ''
  if (!description || !body) return { ok: false, reason: 'campo-faltante' }
  if (description.length > MAX_SKILL_DESCRIPTION) return { ok: false, reason: 'demasiado-largo' }
  if (body.length > MAX_SKILL_BODY_CHARS || body.split('\n').length > MAX_SKILL_BODY_LINES) return { ok: false, reason: 'demasiado-largo' }
  if (maskSecretPatterns(description) !== description || maskSecretPatterns(body) !== body) return { ok: false, reason: 'secreto' }
  const dir = skillDir(folder, skill.name)
  const path = join(dir, 'SKILL.md')
  if (existsSync(path)) return { ok: false, reason: 'ya-existe' }
  mkdirSync(dir, { recursive: true })
  const content = frontmatter(skill.name, description) + body + '\n'
  const tmp = `${path}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
  return { ok: true, path }
}
