/**
 * Formato de archivo de memoria APRENDIDA (propuesta por el agente, aprobada por el usuario, escrita solo por
 * `main`). Un archivo de texto Markdown por alcance (memoria global del usuario, o de un proyecto), con una
 * viñeta por hecho y los metadatos (id, fecha, origen) en un comentario HTML al final de la línea: invisible
 * al leerlo como Markdown, legible en crudo. Módulo PURO: ni Electron ni node:fs, para poder probarlo sin la app.
 */

export type LearnedMemoryScope = 'usuario' | 'proyecto'
export type LearnedMemoryType = 'preferencia' | 'convencion' | 'decision' | 'solucion'

export interface LearnedMemoryEntry {
  id: string
  tipo: LearnedMemoryType
  texto: string
  /** Motivo breve opcional (por qué vale la pena recordarlo). */
  porque?: string
  /** Fecha ISO (solo la parte de fecha, AAAA-MM-DD) de cuando se aprobó. */
  fecha: string
}

export const MAX_ENTRY_CHARS = 300
export const MAX_ENTRIES: Record<LearnedMemoryScope, number> = { usuario: 40, proyecto: 60 }

const TYPE_HEADINGS: Record<LearnedMemoryType, string> = {
  preferencia: 'Preferencias',
  convencion: 'Convenciones',
  decision: 'Decisiones',
  solucion: 'Soluciones'
}
const TYPE_ORDER: LearnedMemoryType[] = ['preferencia', 'convencion', 'decision', 'solucion']

/** Id corto nuevo (8 caracteres hexadecimales), sin depender de `crypto` de Node (puro). */
export function newEntryId(random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += Math.floor(random() * 16).toString(16)
  return s
}

/** Recorta a MAX_ENTRY_CHARS con "…" si hace falta. Nunca lanza. */
export function clampEntryText(text: string): string {
  const t = text.trim()
  return t.length > MAX_ENTRY_CHARS ? `${t.slice(0, MAX_ENTRY_CHARS - 1)}…` : t
}

/**
 * Parsea el Markdown. Formato de cada línea de hecho (dentro de su sección de tipo):
 *   - texto del hecho <!-- m-XXXXXXXX · AAAA-MM-DD -->
 * (el id lleva el prefijo "m-"). Las líneas de viñeta SIN ese comentario (el usuario las escribió a mano
 * en el pasado, o algo externo tocó el archivo) se conservan tal cual al serializar, con un id nuevo
 * generado solo en memoria (no se reescribe el archivo por esto). Formato tolerante: lo que no matchea
 * ninguna sección de tipo conocida se ignora al parsear (pero igual se podría estar perdiendo texto
 * suelto del usuario: documentalo en un comentario, no hace falta resolverlo ahora).
 */
export function parseLearnedMemory(raw: string): LearnedMemoryEntry[] {
  const lines = raw.split(/\r?\n/)
  const entries: LearnedMemoryEntry[] = []
  let currentType: LearnedMemoryType | null = null
  const headingToType = new Map<string, LearnedMemoryType>()
  for (const [type, heading] of Object.entries(TYPE_HEADINGS) as [LearnedMemoryType, string][]) {
    headingToType.set(heading, type)
  }
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/)
    if (headingMatch) {
      currentType = headingToType.get(headingMatch[1].trim()) ?? null
      continue
    }
    const bulletMatch = line.match(/^-\s+(.*)$/)
    if (!bulletMatch || !currentType) continue
    let rest = bulletMatch[1]
    const metaMatch = rest.match(/<!--\s*(m-[0-9a-f]{8})\s*·\s*(\d{4}-\d{2}-\d{2})\s*(?:·.*)?-->\s*$/)
    let id: string
    let fecha: string
    if (metaMatch) {
      id = metaMatch[1].slice(2)
      fecha = metaMatch[2]
      rest = rest.slice(0, metaMatch.index).trim()
    } else {
      id = newEntryId()
      fecha = ''
    }
    if (!rest) continue
    entries.push({ id, tipo: currentType, texto: rest, fecha })
  }
  return entries
}

/**
 * Arma el Markdown completo a partir de las entradas + metadatos del encabezado. Agrupa por tipo, en el
 * orden preferencia/convencion/decision/solucion, y dentro de cada tipo por fecha descendente.
 */
export function serializeLearnedMemory(
  entries: readonly LearnedMemoryEntry[],
  meta: { alcance: LearnedMemoryScope; carpeta?: string; titulo: string }
): string {
  const lines: string[] = ['---', `alcance: ${meta.alcance}`]
  if (meta.carpeta) lines.push(`carpeta: ${meta.carpeta}`)
  lines.push(`actualizado: ${new Date().toISOString().slice(0, 10)}`, '---', `# ${meta.titulo}`, '')
  for (const type of TYPE_ORDER) {
    const ofType = entries.filter((e) => e.tipo === type).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    lines.push(`## ${TYPE_HEADINGS[type]}`)
    for (const e of ofType) {
      const fecha = e.fecha || new Date().toISOString().slice(0, 10)
      lines.push(`- ${e.texto} <!-- m-${e.id} · ${fecha} -->`)
    }
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

/** Agrega una entrada nueva (id y fecha de hoy ya puestos por quien llama) si no se llegó al tope. */
/** Minúsculas, sin tildes, espacios colapsados: para no guardar dos veces el mismo hecho con otra mayúscula o espacio de más. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Agrega una entrada nueva si no se llegó al tope Y no hay ya una con el mismo texto (mismo tipo, normalizado). */
export function addEntry(
  entries: readonly LearnedMemoryEntry[],
  entry: LearnedMemoryEntry,
  scope: LearnedMemoryScope
): { entries: LearnedMemoryEntry[]; added: boolean } {
  const texto = clampEntryText(entry.texto)
  if (entries.some((e) => e.tipo === entry.tipo && normalize(e.texto) === normalize(texto))) {
    return { entries: [...entries], added: false }
  }
  if (entries.length >= MAX_ENTRIES[scope]) return { entries: [...entries], added: false }
  return { entries: [...entries, { ...entry, texto }], added: true }
}

/** Quita una entrada por id. Si no existe, no cambia nada (mismo array, `removed: false`). */
export function removeEntry(entries: readonly LearnedMemoryEntry[], id: string): { entries: LearnedMemoryEntry[]; removed: boolean } {
  const next = entries.filter((e) => e.id !== id)
  return { entries: next, removed: next.length !== entries.length }
}

/** Texto corto para inyectar en el prompt de un agente: una viñeta por hecho, agrupado por tipo, SIN los comentarios de metadatos. */
export function formatForPrompt(entries: readonly LearnedMemoryEntry[]): string {
  const lines: string[] = []
  for (const type of TYPE_ORDER) {
    const ofType = entries.filter((e) => e.tipo === type)
    if (ofType.length === 0) continue
    lines.push(`${TYPE_HEADINGS[type]}:`)
    for (const e of ofType) lines.push(`- ${e.texto}`)
  }
  return lines.join('\n')
}
