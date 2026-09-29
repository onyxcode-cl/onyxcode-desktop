/**
 * Utilidades PURAS sobre la transcripción de una tarea (sin React, sin stores): último mensaje del
 * asistente, primer encargo, exportación a Markdown, prompts de "Continuar en una tarea nueva" y de
 * la Consulta lateral, y el prompt de "Crear skill de esta tarea".
 */
import type { MessageEntry } from '../../../stores/sessions'

/** Marca que `sendToTask` añade al mensaje cuando hay archivos adjuntos. */
export const ATTACHMENTS_MARKER = '\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n'

type TextPart = Extract<MessageEntry['parts'][number], { type: 'text' }>

/** Partes de texto visibles (sin sintéticas ni ignoradas) de un mensaje. */
export function visibleTextParts(entry: MessageEntry): TextPart[] {
  return entry.parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic && !p.ignored)
}

/** Separa el texto del usuario de su bloque de adjuntos (rutas relativas, sin el guion inicial). */
export function splitAttachments(raw: string): { text: string; files: string[] } {
  const idx = raw.indexOf(ATTACHMENTS_MARKER)
  if (idx < 0) return { text: raw.trim(), files: [] }
  const files = raw
    .slice(idx + ATTACHMENTS_MARKER.length)
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return { text: raw.slice(0, idx).trim(), files }
}

/** Texto (sin adjuntos) de un mensaje del usuario. */
function userText(entry: MessageEntry): string {
  return splitAttachments(
    visibleTextParts(entry)
      .map((p) => p.text)
      .join('\n')
  ).text
}

/** Texto del último mensaje del asistente (une sus partes de texto). '' si no hay. */
export function lastAssistantText(entries: MessageEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].info.role !== 'assistant') continue
    return visibleTextParts(entries[i])
      .map((p) => p.text)
      .join('\n')
      .trim()
  }
  return ''
}

/** Primer mensaje del usuario, sin el bloque de adjuntos que añade `sendToTask`. '' si no hay. */
export function firstUserPrompt(entries: MessageEntry[]): string {
  const first = entries.find((e) => e.info.role === 'user')
  return first ? userText(first) : ''
}

// ───────────────────────────── Markdown ─────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** "2026-09-28 14:05" en hora local. */
function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Resumen de una llamada a herramienta en una sola línea (solo para el Markdown con herramientas). */
function toolLine(part: Extract<MessageEntry['parts'][number], { type: 'tool' }>): string {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k]
      if (typeof v === 'string' && v) return v
    }
    return ''
  }
  const detail = pick('description', 'command', 'filePath', 'path', 'url', 'query', 'pattern').replace(/\s+/g, ' ').trim()
  const short = detail.length > 120 ? `${detail.slice(0, 119)}…` : detail
  return `> Herramienta \`${part.tool}\`${short ? `: ${short}` : ''}`
}

/**
 * Exporta la conversación a Markdown: título, datos de la tarea y un encabezado por turno
 * («Tú» / «Agente»; varios mensajes seguidos del agente forman un solo turno). Con
 * `includeTools` añade una línea por herramienta usada. Sin partes de razonamiento.
 */
export function transcriptToMarkdown(
  s: { title: string; directory: string; time: { created: number } },
  entries: MessageEntry[],
  opts: { includeTools?: boolean } = {}
): string {
  const title = s.title.trim() || 'Tarea de Cowork'
  const out: string[] = [
    `# ${title}`,
    '',
    `- Carpeta: ${s.directory}`,
    `- Creada: ${stamp(s.time.created)}`,
    `- Exportada: ${stamp(Date.now())}`,
    '',
    '---',
    ''
  ]
  let lastRole: 'user' | 'assistant' | null = null
  for (const e of entries) {
    const role = e.info.role
    const blocks: string[] = []
    if (role === 'user') {
      const { text, files } = splitAttachments(
        visibleTextParts(e)
          .map((p) => p.text)
          .join('\n')
      )
      if (text) blocks.push(text)
      if (files.length > 0) blocks.push(`_Adjuntos: ${files.join(', ')}_`)
    } else {
      for (const p of e.parts) {
        if (p.type === 'text' && !p.synthetic && !p.ignored && p.text.trim()) blocks.push(p.text.trim())
        else if (p.type === 'tool' && opts.includeTools) blocks.push(toolLine(p))
      }
    }
    if (blocks.length === 0) continue
    if (role !== lastRole) {
      out.push(`## ${role === 'user' ? 'Tú' : 'Agente'} · ${stamp(e.info.time.created)}`, '')
      lastRole = role === 'user' ? 'user' : 'assistant'
    }
    out.push(blocks.join('\n\n'), '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** Nombre de archivo sugerido (con `.md`) para exportar la tarea: sin caracteres prohibidos, ≤ 80 letras. */
export function suggestedExportName(title: string): string {
  const base = title
    .replace(/[/\\:\0-\x1f*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
  return `${base || 'tarea-de-cowork'}.md`
}

// ───────────────────────────── Continuar en una tarea nueva ─────────────────────────────

const CONT_ORIGINAL_MAX = 2000
const CONT_SUMMARY_MAX = 3000
const CONT_FOLLOWUP_MAX = 300
const CONT_FOLLOWUPS = 5
/** Tope del prompt completo (título + partes + texto fijo). */
export const CONTINUATION_PROMPT_MAX = 8000

function clipStart(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Conserva el final: ahí están las conclusiones. */
function clipEnd(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-(max - 1))}` : text
}

/**
 * Prompt para "Continuar en una tarea nueva": el encargo original, lo último que dijo el agente y los
 * últimos mensajes del usuario. Siempre ≤ `CONTINUATION_PROMPT_MAX` caracteres.
 */
export function buildContinuationPrompt(title: string, entries: MessageEntry[]): string {
  const original = clipStart(firstUserPrompt(entries), CONT_ORIGINAL_MAX)
  const summary = clipEnd(lastAssistantText(entries), CONT_SUMMARY_MAX)
  const users = entries.filter((e) => e.info.role === 'user')
  const followUps = users
    .slice(1)
    .slice(-CONT_FOLLOWUPS)
    .map((e) => clipStart(userText(e).replace(/\s+/g, ' '), CONT_FOLLOWUP_MAX))
    .filter(Boolean)
  const parts = [
    `Continúa una tarea anterior de Cowork: «${clipStart(title.trim() || 'sin título', 120)}». La conversación anterior no está disponible; este es el contexto que necesitas.`,
    `Encargo original:\n${original || '(sin texto)'}`
  ]
  if (followUps.length > 0) parts.push(`Mensajes posteriores del usuario:\n${followUps.map((f) => `- ${f}`).join('\n')}`)
  if (summary) parts.push(`Lo último que dijiste o concluiste:\n${summary}`)
  parts.push('Revisa el estado actual de la carpeta y continúa donde se quedó; si algo no está claro, pregúntame antes de actuar.')
  return clipStart(parts.join('\n\n'), CONTINUATION_PROMPT_MAX)
}

// ───────────────────────────── Consulta lateral ─────────────────────────────

const SIDE_HEADER_MAX = 600

/**
 * `system` de la Consulta lateral: instrucciones (solo responder, sin tocar la tarea) y la conversación
 * de la tarea condensada (solo texto, lo más reciente primero en prioridad). Nunca supera `maxChars`.
 */
export function buildSideChatSystem(title: string, entries: MessageEntry[], maxChars = 12_000): string {
  const header = clipStart(
    'Eres un asistente de consulta lateral dentro de una tarea de Cowork. Responde en español, breve y claro, ' +
      'usando solo el contexto de la tarea que aparece abajo. No modifiques archivos ni ejecutes acciones: ' +
      'esta conversación no cambia la tarea. Si te piden algo que requiere actuar, sugiere hacerlo en la tarea principal.\n\n' +
      `Tarea: «${clipStart(title.trim() || 'sin título', 120)}».`,
    SIDE_HEADER_MAX
  )
  const turns: string[] = []
  for (const e of entries) {
    const text =
      e.info.role === 'user'
        ? userText(e)
        : visibleTextParts(e)
            .map((p) => p.text)
            .join('\n')
            .trim()
    if (text) turns.push(`${e.info.role === 'user' ? 'Usuario' : 'Agente'}: ${text}`)
  }
  const intro = '\n\nConversación de la tarea (lo más antiguo puede estar recortado):\n'
  const budget = Math.max(0, maxChars - header.length - intro.length)
  if (budget < 50 || turns.length === 0) return header.slice(0, maxChars)
  // Se llenan los turnos desde el más reciente; cada turno se recorta para que quepan varios.
  const perTurn = Math.max(200, Math.floor(budget / Math.min(turns.length, 8)))
  const picked: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = clipStart(turns[i], perTurn)
    const cost = t.length + 2
    if (used + cost > budget) break
    picked.unshift(t)
    used += cost
  }
  if (picked.length === 0) return header.slice(0, maxChars)
  const body = picked.join('\n\n')
  return `${header}${intro}${body}`.slice(0, maxChars)
}

// ───────────────────────────── Crear skill ─────────────────────────────

/** Mensaje que se envía a la tarea para convertirla en una skill reutilizable. */
export const CREATE_SKILL_PROMPT =
  'Convierte lo que hicimos en esta tarea en una skill reutilizable.\n\n' +
  '1. Elige un nombre corto en minúsculas con guiones (por ejemplo `informe-mensual`).\n' +
  '2. Crea el archivo `.opencode/skills/<nombre>/SKILL.md` dentro de la carpeta de la tarea. Empieza con un bloque de ' +
  'metadatos (frontmatter) con `name` (igual que el nombre de la carpeta) y `description` (una frase que diga cuándo usarla).\n' +
  '3. Escribe debajo, en español, los pasos generales que seguiste, las herramientas o comandos que funcionaron y los errores ' +
  'que conviene evitar. Generaliza: sin datos personales, nombres de archivos concretos ni contenido confidencial.\n' +
  '4. Si esa carpeta ya existe, no la sobrescribas: elige otro nombre.\n' +
  '5. Al terminar, dime el nombre y la ruta de la skill.'
