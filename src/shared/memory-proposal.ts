/**
 * Extrae propuestas de memoria APRENDIDA del último mensaje del agente (Tareas). El agente nunca escribe
 * memoria: termina su turno con un bloque de código ```lazunox-memoria``` con un JSON de hasta 5 propuestas;
 * esto se muestra como tarjeta (`MemoryProposalCard`) y el usuario elige qué guardar. Módulo PURO: ni
 * Electron ni node:fs. Lo usan el renderer (mostrar la tarjeta) y `main` (revalidar antes de escribir:
 * nunca confía en lo que mande el renderer).
 */
import { maskSecretPatterns } from './redact-patterns'
import { looksLikeInjection } from './injection-patterns'
import { MAX_ENTRY_CHARS, clampEntryText, type LearnedMemoryType } from './memory-format'

export const MAX_PROPOSALS_PER_TURN = 5

/** Marcador: el bloque de código con este «lenguaje» que el agente pone al final de su respuesta. */
const BLOCK_RE = /```lazunox-memoria\s*\n([\s\S]*?)\n```/g

export type MemoryProposalFlag = 'secreto' | 'personal' | 'inyeccion'

export interface MemoryProposal {
  alcance: 'usuario' | 'proyecto'
  tipo: LearnedMemoryType
  texto: string
  porque?: string
  /** Por qué no viene preseleccionada en la tarjeta (nunca se oculta: el usuario decide igual). Ausente = sin aviso. */
  flag?: MemoryProposalFlag
}

const VALID_SCOPES = new Set(['usuario', 'proyecto'])
const VALID_TYPES = new Set<LearnedMemoryType>(['preferencia', 'convencion', 'decision', 'solucion'])

/** Correos, teléfonos y RUT chileno (con o sin puntos/guion): heurística, no un límite real. */
const PERSONAL_DATA_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\d{1,2}[.,]?\d{3}[.,]?\d{3}[-.]?[\dkK]\b|\+?\d[\d\s().-]{7,}\d/i

/** `true` si enmascarar secretos cambia el texto (algún patrón de clave/token/URL con credenciales coincidió). */
function containsSecret(text: string): boolean {
  return maskSecretPatterns(text) !== text
}

function normalizeOne(raw: unknown): MemoryProposal | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const alcance = r.alcance
  const tipo = r.tipo
  const texto = r.texto
  if (typeof alcance !== 'string' || !VALID_SCOPES.has(alcance)) return null
  if (typeof tipo !== 'string' || !VALID_TYPES.has(tipo as LearnedMemoryType)) return null
  if (typeof texto !== 'string' || !texto.trim()) return null
  const porque = typeof r.porque === 'string' ? r.porque.trim().slice(0, MAX_ENTRY_CHARS) : undefined
  return {
    alcance: alcance as 'usuario' | 'proyecto',
    tipo: tipo as LearnedMemoryType,
    texto: clampEntryText(texto),
    ...(porque ? { porque } : {})
  }
}

/** Marca (no descarta) una propuesta según lo que detecten las heurísticas de datos personales/inyección. */
function flagOf(p: MemoryProposal): MemoryProposalFlag | undefined {
  if (looksLikeInjection(p.texto) || (p.porque && looksLikeInjection(p.porque))) return 'inyeccion'
  if (PERSONAL_DATA_RE.test(p.texto)) return 'personal'
  return undefined
}

export interface ExtractResult {
  proposals: MemoryProposal[]
  /** Se detectó un bloque pero con JSON inválido, demasiadas propuestas, o alguna solo con secretos: para el registro, no para la UI. */
  rejectedCount: number
}

/**
 * Busca el ÚLTIMO bloque ```lazunox-memoria``` del texto (si el agente se corrigió a mitad de turno, manda el
 * final). Las propuestas que contienen un secreto se DESCARTAN del todo (nunca llegan a la tarjeta, ni
 * marcadas): no hay forma segura de "guardar a medias" una clave. El resto se devuelve siempre, marcado si
 * corresponde, para que el usuario decida — nunca se oculta por la heurística de datos personales o inyección.
 */
export function extractMemoryProposals(text: string): ExtractResult {
  if (!text) return { proposals: [], rejectedCount: 0 }
  let lastMatch: RegExpExecArray | null = null
  for (const m of text.matchAll(BLOCK_RE)) lastMatch = m
  if (!lastMatch) return { proposals: [], rejectedCount: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(lastMatch[1])
  } catch {
    return { proposals: [], rejectedCount: 1 }
  }
  if (!Array.isArray(parsed)) return { proposals: [], rejectedCount: 1 }
  let rejectedCount = 0
  const proposals: MemoryProposal[] = []
  for (const raw of parsed.slice(0, MAX_PROPOSALS_PER_TURN * 4)) {
    const p = normalizeOne(raw)
    if (!p) {
      rejectedCount++
      continue
    }
    if (containsSecret(p.texto) || (p.porque && containsSecret(p.porque))) {
      rejectedCount++
      continue
    }
    const flag = flagOf(p)
    proposals.push(flag ? { ...p, flag } : p)
    if (proposals.length >= MAX_PROPOSALS_PER_TURN) break
  }
  if (parsed.length > proposals.length + rejectedCount) rejectedCount += parsed.length - proposals.length - rejectedCount
  return { proposals, rejectedCount }
}

/** Quita el bloque del texto que se muestra al usuario (es un contrato con el agente, no algo para leer). */
export function stripMemoryProposalBlock(text: string): string {
  return text
    .replace(BLOCK_RE, '')
    .replace(/\n{3,}$/, '\n')
    .trimEnd()
}
