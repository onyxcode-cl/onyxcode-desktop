/**
 * Extrae una propuesta de SKILL del último mensaje del agente (Tareas). El agente nunca escribe
 * `.opencode/skills/<nombre>/SKILL.md` directo: termina su turno con un bloque de código
 * ```lazunox-skill``` con UNA propuesta en JSON; esto se muestra como tarjeta (`SkillProposalCard`)
 * y el usuario aprueba o descarta. Módulo PURO: ni Electron ni node:fs. Formato compatible con el
 * estándar abierto agentskills.io: `name` en minúsculas con guiones, igual al nombre de la carpeta
 * `.opencode/skills/<name>/`.
 */
import { maskSecretPatterns } from './redact-patterns'
import { looksLikeInjection } from './injection-patterns'

const BLOCK_RE = /```lazunox-skill\s*\n([\s\S]*?)\n```/g

/** `name` de agentskills.io: 1-64 caracteres, a-z0-9 y guiones, sin guion al principio/final, sin "--" seguido. */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const MAX_SKILL_NAME = 64
export const MAX_SKILL_DESCRIPTION = 1024
export const MAX_SKILL_BODY_CHARS = 20_000
export const MAX_SKILL_BODY_LINES = 500

/** Correos, teléfonos y RUT chileno (con o sin puntos/guion): heurística, no un límite real. */
const PERSONAL_DATA_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\d{1,2}[.,]?\d{3}[.,]?\d{3}[-.]?[\dkK]\b|\+?\d[\d\s().-]{7,}\d/i

export type SkillProposalFlag = 'personal' | 'inyeccion' | 'secreto'

export interface SkillProposal {
  name: string
  description: string
  body: string
  flag?: SkillProposalFlag
}

export type SkillRejectReason = 'json-invalido' | 'nombre-invalido' | 'campo-faltante' | 'demasiado-largo' | 'secreto'

export type ExtractSkillResult = { proposal: SkillProposal; rejected: null } | { proposal: null; rejected: SkillRejectReason }

function validName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_SKILL_NAME && SKILL_NAME_RE.test(name) && !name.includes('--')
}

/** `true` si enmascarar secretos cambia el texto. */
function containsSecret(text: string): boolean {
  return maskSecretPatterns(text) !== text
}

/** Marca (no descarta) una propuesta según lo que detecten las heurísticas de datos personales/inyección. */
function flagOf(p: SkillProposal): SkillProposalFlag | undefined {
  if (containsSecret(p.description) || containsSecret(p.body)) return 'secreto'
  if (looksLikeInjection(p.description) || looksLikeInjection(p.body)) return 'inyeccion'
  if (PERSONAL_DATA_RE.test(p.description) || PERSONAL_DATA_RE.test(p.body)) return 'personal'
  return undefined
}

/**
 * Busca el ÚLTIMO bloque ```lazunox-skill``` del texto (una sola propuesta por turno: a diferencia de la
 * memoria, una skill es más costosa de revisar). `rejected` dice por qué no hay nada que mostrar; `null,null`
 * (sin bloque) se distingue de un bloque roto con `rejected !== null`.
 */
export function extractSkillProposal(text: string): ExtractSkillResult | null {
  if (!text) return null
  let lastMatch: RegExpExecArray | null = null
  for (const m of text.matchAll(BLOCK_RE)) lastMatch = m
  if (!lastMatch) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(lastMatch[1])
  } catch {
    return { proposal: null, rejected: 'json-invalido' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { proposal: null, rejected: 'json-invalido' }
  const r = parsed as Record<string, unknown>
  if (!validName(r.name)) return { proposal: null, rejected: 'nombre-invalido' }
  if (typeof r.description !== 'string' || !r.description.trim()) return { proposal: null, rejected: 'campo-faltante' }
  if (typeof r.body !== 'string' || !r.body.trim()) return { proposal: null, rejected: 'campo-faltante' }
  const description = r.description.trim()
  const body = r.body.trim()
  if (description.length > MAX_SKILL_DESCRIPTION) return { proposal: null, rejected: 'demasiado-largo' }
  if (body.length > MAX_SKILL_BODY_CHARS || body.split('\n').length > MAX_SKILL_BODY_LINES) {
    return { proposal: null, rejected: 'demasiado-largo' }
  }
  if (containsSecret(description) || containsSecret(body)) return { proposal: null, rejected: 'secreto' }
  const proposal: SkillProposal = { name: r.name, description, body }
  const flag = flagOf(proposal)
  return { proposal: flag ? { ...proposal, flag } : proposal, rejected: null }
}

/** Quita el bloque del texto que se le muestra al usuario (contrato con el agente, no para leer). */
export function stripSkillProposalBlock(text: string): string {
  return text
    .replace(BLOCK_RE, '')
    .replace(/\n{3,}$/, '\n')
    .trimEnd()
}
