/**
 * Proyectos con archivos de conocimiento (F8-B185): núcleo PURO (sin Electron ni disco) que comparten main y las pruebas.
 *
 *  - Límites visibles para la persona (`PROJECT_LIMITS`).
 *  - Troceo del texto de un archivo en pasajes de ~1000 caracteres con solapamiento.
 *  - Recuperación léxica local: BM25 sobre los pasajes, con tildes y mayúsculas normalizadas. Nada de embeddings ni de servicios
 *    externos: es matemática simple sobre texto que ya está en el equipo.
 *
 * Lo que sale de aquí hacia el modelo se enmarca en `personal-context.ts` como DATO (nunca como instrucción).
 */

export const PROJECT_LIMITS = {
  /** Proyectos en total. */
  maxProjects: 50,
  /** Archivos por proyecto. */
  maxFilesPerProject: 20,
  /** Tamaño de cada archivo original. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Espacio total de los archivos originales de un proyecto. */
  maxProjectBytes: 50 * 1024 * 1024,
  /** Texto que se indexa de un archivo (lo que pase se recorta y se avisa). */
  maxCharsPerFile: 400_000,
  /** Texto que se indexa en todo el proyecto. */
  maxCharsPerProject: 1_500_000,
  maxNameChars: 80,
  maxInstructionsChars: 4000,
  /** Conversaciones que recuerdan su proyecto. */
  maxAssignments: 2000,
  /** Pasajes que viajan al modelo por mensaje, y su tope de caracteres (cada uno y todos juntos). */
  maxPassages: 5,
  maxPassageChars: 1200,
  maxInjectedChars: 5000
} as const

export const CHUNK_TARGET_CHARS = 1000
export const CHUNK_MAX_CHARS = 1200
export const CHUNK_OVERLAP_CHARS = 150

/** Extensiones que se aceptan como archivos de conocimiento (minúsculas, sin punto). */
export const KNOWLEDGE_TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'text', 'json', 'yaml', 'yml'] as const
export const KNOWLEDGE_OFFICE_EXTS = ['docx', 'xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'xls'] as const
export const KNOWLEDGE_EXTS: readonly string[] = ['pdf', ...KNOWLEDGE_OFFICE_EXTS, ...KNOWLEDGE_TEXT_EXTS]

export function knowledgeExt(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

export type KnowledgeKind = 'pdf' | 'office' | 'text'
export function knowledgeKind(name: string): KnowledgeKind | null {
  const ext = knowledgeExt(name)
  if (ext === 'pdf') return 'pdf'
  if ((KNOWLEDGE_OFFICE_EXTS as readonly string[]).includes(ext)) return 'office'
  if ((KNOWLEDGE_TEXT_EXTS as readonly string[]).includes(ext)) return 'text'
  return null
}

/* ───────────────────────────── Normalización y troceo ───────────────────────────── */

/** Minúsculas y sin tildes (`ñ` → `n`): la misma normalización para el texto y para la pregunta. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const STOPWORDS = new Set(
  // español
  (
    'a al algo algun alguna algunas alguno algunos ante como con contra cual cuales cuando cuanto cuantos cuanta cuantas de del desde donde dos ' +
    'el ella ellas ellos en entre era eran es esa esas ese eso esos esta estan estas este esto estos fue fueron ha han hay la las le les lo los ' +
    'mas me mi mis muy no nos o otra otro para pero por porque que quien quienes se sea ser si sin sobre son su sus tambien te tengo tiene tienen ' +
    'tu tus un una unas uno unos y ya yo dime dame quiero puedes puede favor hola gracias segun cada todo toda todos todas tras hasta ' +
    // inglés
    'the an and or of to in on at for from with by is are was were be been it its this that these those what which who whom how when where why ' +
    'do does did can could would should will tell me my you your please about as if not no but so than then there their they them we our'
  ).split(' ')
)

/**
 * Raíz simple para que «archivos» encuentre «archivo» y «llaves» a «llave»: quita el plural («es»/«s») y después la vocal final
 * (a, e, o) de las palabras largas. No es lingüística fina: junta variantes de género y número, y a veces dos palabras distintas
 * («casa» y «caso»); para recuperar pasajes eso es aceptable, y el puntaje BM25 pone primero los que coinciden más.
 */
function stem(w: string): string {
  if (/^\d+$/.test(w)) return w
  let s = w
  if (s.length >= 5 && s.endsWith('es')) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1)
  if (s.length >= 5 && /[aeo]$/.test(s)) s = s.slice(0, -1)
  // Raíz de 6 letras como máximo: «cosecha» y «cosecharon», «arriendo» y «arrienda» comparten raíz.
  return s.length > 6 ? s.slice(0, 6) : s
}

/** Términos de búsqueda de un texto: normalizados, sin palabras vacías y sin duplicar el orden. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of foldText(text).split(/[^a-z0-9]+/)) {
    if (!raw) continue
    if (raw.length < 2 && !/^\d$/.test(raw)) continue
    if (STOPWORDS.has(raw)) continue
    const w = stem(raw)
    if (w.length < 2 && !/^\d$/.test(w)) continue
    out.push(w)
  }
  return out
}

function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s
  const slice = s.slice(0, max)
  const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'))
  return sp > max * 0.6 ? slice.slice(0, sp) : slice
}

/** Parte un bloque más largo que `max` por líneas, después por frases y por último a la fuerza (en una palabra). */
function splitLong(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit]
  const pieces: string[] = []
  const lines = unit.split('\n')
  for (const line of lines) {
    if (line.length <= max) {
      pieces.push(line)
      continue
    }
    const sentences = line.split(/(?<=[.!?…;])\s+/)
    for (const s of sentences) {
      let rest = s
      while (rest.length > max) {
        const head = cutAtWord(rest, max)
        pieces.push(head)
        rest = rest.slice(head.length).trimStart()
      }
      if (rest) pieces.push(rest)
    }
  }
  // Une de nuevo las piezas pequeñas consecutivas que caben juntas (filas de tabla, líneas cortas…).
  const joined: string[] = []
  for (const p of pieces) {
    const last = joined[joined.length - 1]
    if (last !== undefined && last.length + 1 + p.length <= max) joined[joined.length - 1] = `${last}\n${p}`
    else joined.push(p)
  }
  return joined
}

/** Cola del pasaje anterior (solapamiento), cortada en límite de palabra. */
function overlapTail(prev: string, overlap: number): string {
  if (overlap <= 0 || prev.length <= overlap) return ''
  const tail = prev.slice(prev.length - overlap)
  const sp = tail.search(/\s/)
  return sp >= 0 ? tail.slice(sp + 1).trim() : ''
}

export interface ChunkOptions {
  target?: number
  max?: number
  overlap?: number
}

/**
 * Trocea un texto en pasajes de ~`target` caracteres (nunca más de `max`) respetando párrafos y, si hace falta, líneas y frases;
 * cada pasaje repite el final del anterior (`overlap`) para que una frase partida no se pierda. Los pasajes salen en orden.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const target = opts.target ?? CHUNK_TARGET_CHARS
  const max = opts.max ?? CHUNK_MAX_CHARS
  const overlap = Math.min(opts.overlap ?? CHUNK_OVERLAP_CHARS, Math.floor(max / 4))
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    // Primero se juntan las rachas de espacios (lineal): una expresión con `[ \t]+\n` sería cuadrática con un archivo lleno de espacios.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!clean) return []
  // Deja sitio para el solapamiento dentro del máximo.
  const room = Math.max(200, max - overlap - 2)
  const units: string[] = []
  for (const para of clean.split(/\n\s*\n/)) {
    const p = para.trim()
    if (p) units.push(...splitLong(p, room))
  }
  const chunks: string[] = []
  let cur = ''
  let carry = ''
  const flush = (): void => {
    const body = cur.trim()
    if (!body) return
    chunks.push(carry ? `${carry}\n${body}` : body)
    carry = overlapTail(body, overlap)
    cur = ''
  }
  for (const u of units) {
    if (cur && cur.length + 2 + u.length > target) flush()
    cur = cur ? `${cur}\n\n${u}` : u
  }
  flush()
  return chunks
}

/* ───────────────────────────── Índice y BM25 ───────────────────────────── */

export interface KnowledgeChunk {
  /** Id del archivo del proyecto. */
  file: string
  /** Nombre del archivo, para citarlo. */
  name: string
  /** Número de parte dentro del archivo (desde 1). */
  part: number
  text: string
}

export interface ScoredChunk extends KnowledgeChunk {
  score: number
  matched: number
}

const K1 = 1.4
const B = 0.75
/** Peso de los términos del nombre del archivo: cuentan como una aparición más en cada pasaje. */
const NAME_WEIGHT = 1

interface Doc {
  chunk: KnowledgeChunk
  tf: Map<string, number>
  len: number
}

/** Índice BM25 en memoria sobre una lista de pasajes. Se reconstruye en milisegundos al abrir un proyecto. */
export class Bm25Index {
  private readonly docs: Doc[] = []
  private readonly df = new Map<string, number>()
  private avgLen = 1

  constructor(chunks: readonly KnowledgeChunk[]) {
    let total = 0
    for (const chunk of chunks) {
      const tf = new Map<string, number>()
      const terms = tokenize(chunk.text)
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tokenize(chunk.name.replace(/\.[A-Za-z0-9]+$/, ''))) tf.set(t, (tf.get(t) ?? 0) + NAME_WEIGHT)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.docs.push({ chunk, tf, len: Math.max(1, terms.length) })
      total += Math.max(1, terms.length)
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 1
  }

  get size(): number {
    return this.docs.length
  }

  /**
   * Los pasajes más relevantes para la pregunta, de mayor a menor puntaje. Un pasaje cuenta solo si contiene suficientes términos
   * de la pregunta (1 si la pregunta tiene 1–2 términos; si no, 2): así una pregunta que nada tiene que ver con los archivos
   * devuelve una lista vacía y no un pasaje al azar, y una pregunta de varios temas («el código del portón y las cajas de
   * cerezas») recupera un pasaje de cada archivo.
   */
  search(query: string, limit: number = PROJECT_LIMITS.maxPassages): ScoredChunk[] {
    const terms = [...new Set(tokenize(query))]
    if (terms.length === 0 || this.docs.length === 0) return []
    const n = this.docs.length
    const minMatch = terms.length <= 2 ? 1 : 2
    const scored: ScoredChunk[] = []
    for (const d of this.docs) {
      let score = 0
      let matched = 0
      for (const t of terms) {
        const f = d.tf.get(t)
        if (!f) continue
        matched++
        const df = this.df.get(t) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)))
      }
      if (matched >= minMatch && score > 0) scored.push({ ...d.chunk, score, matched })
    }
    scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.part - b.part)
    return scored.slice(0, Math.max(0, limit))
  }
}

export interface Passage {
  file: string
  part: number
  text: string
}

/** Aplica los topes de lo que viaja al modelo: cantidad, caracteres por pasaje y caracteres en total. */
export function selectPassages(found: readonly ScoredChunk[]): Passage[] {
  const out: Passage[] = []
  let used = 0
  for (const c of found) {
    if (out.length >= PROJECT_LIMITS.maxPassages) break
    const room = PROJECT_LIMITS.maxInjectedChars - used
    if (room < 200) break
    const text = c.text.length > PROJECT_LIMITS.maxPassageChars ? c.text.slice(0, PROJECT_LIMITS.maxPassageChars - 1) + '…' : c.text
    const cut = text.length > room ? text.slice(0, room - 1) + '…' : text
    out.push({ file: c.name, part: c.part, text: cut })
    used += cut.length
  }
  return out
}

/** Trocea un texto ya extraído en pasajes con nombre de archivo y número de parte. */
export function chunksForFile(fileId: string, name: string, text: string): KnowledgeChunk[] {
  return chunkText(text).map((t, i) => ({ file: fileId, name, part: i + 1, text: t }))
}
