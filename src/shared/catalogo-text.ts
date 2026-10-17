/** Textos visibles de las fichas de habilidades en el idioma activo (con respaldo al español guardado en el catálogo). */
import type { CatalogSkill } from './catalogo'
import { tx } from './mcp-catalog'

export interface SkillText {
  title: string
  description: string
  permissions: string[]
  examples: string[]
}

export function skillText(s: CatalogSkill): SkillText {
  const p = `pers.cat.skill.${s.id}`
  return {
    title: tx(`${p}.title`, s.title),
    description: tx(`${p}.description`, s.description),
    permissions: s.permissions.map((x, i) => tx(`${p}.perm${i + 1}`, x)),
    examples: s.examples.map((x, i) => tx(`${p}.ex${i + 1}`, x))
  }
}
