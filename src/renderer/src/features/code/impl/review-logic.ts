/**
 * Lógica pura del espacio de trabajo de Code: estado de cada sesión en la lista lateral y «revisado» del panel Cambios.
 * Sin React ni store: se prueba aislada (`review-logic.test.ts`).
 *
 * «Aceptar» NO toca el disco ni git: solo recuerda, por sesión, que el usuario ya revisó un archivo (o todos) con un
 * contenido concreto. Si el archivo cambia después (el agente lo vuelve a editar), la huella ya no coincide y vuelve a
 * aparecer como pendiente.
 */
import { diffStats } from '../../../components/DiffView'
import type { SessionState } from '../../../components/SidebarTree'

// ───────────────────────────── Estado de la sesión en la lista ─────────────────────────────

export interface SessionStateInput {
  /** Hay un permiso o una pregunta pendiente (de la sesión o de uno de sus subagentes). */
  waiting: boolean
  /** El agente está trabajando (ocupado o reintentando). */
  busy: boolean
  /** Terminó o pidió algo mientras no mirabas. */
  unread: boolean
  /** Terminó de trabajar y quedan cambios sin revisar. */
  needsReview: boolean
}

/**
 * Prioridad: lo que te bloquea (esperando) > lo que está pasando (trabajando) > lo que debes hacer (revisar cambios) >
 * lo que no has visto (sin leer) > nada (reposo, sin punto).
 */
export function deriveSessionState(i: SessionStateInput): SessionState | null {
  if (i.waiting) return 'waiting'
  if (i.busy) return 'working'
  if (i.needsReview) return 'review'
  if (i.unread) return 'done'
  return null
}

export interface SessionSummaryLike {
  additions: number
  deletions: number
  files: number
}

/** Huella del resumen de cambios de la sesión (cambia cuando el agente edita más). `null` si no hay cambios. */
export function summarySignature(summary: SessionSummaryLike | undefined): string | null {
  if (!summary || summary.files <= 0) return null
  return `${summary.files}:${summary.additions}:${summary.deletions}`
}

/** ¿Quedan cambios de la sesión sin revisar? (hay resumen y su huella no es la que el usuario aceptó). */
export function sessionNeedsReview(summary: SessionSummaryLike | undefined, record: ReviewRecord | undefined): boolean {
  const sig = summarySignature(summary)
  return sig !== null && record?.sig !== sig
}

// ───────────────────────────── Registro de revisión ─────────────────────────────

/** Lo que el usuario ya aceptó de UNA sesión. */
export interface ReviewRecord {
  /** Huella del resumen de la sesión cuando pulsó «Aceptar todo». */
  sig?: string
  /** Huella del contenido de cada archivo aceptado, por ruta. */
  files: Record<string, string>
}

/** Cuántas sesiones conserva el registro persistido (las más recientes por orden de inserción). */
export const MAX_REVIEW_SESSIONS = 200

export function acceptFilesIn(record: ReviewRecord | undefined, entries: Record<string, string>): ReviewRecord {
  return { ...(record ?? { files: {} }), files: { ...(record?.files ?? {}), ...entries } }
}

export function acceptSessionIn(record: ReviewRecord | undefined, sig: string | null): ReviewRecord {
  const base = record ?? { files: {} }
  return sig === null ? base : { ...base, sig }
}

/** Quita las sesiones más antiguas cuando el registro supera el tope. */
export function trimReviewed(all: Record<string, ReviewRecord>, max = MAX_REVIEW_SESSIONS): Record<string, ReviewRecord> {
  const keys = Object.keys(all)
  if (keys.length <= max) return all
  const keep = new Set(keys.slice(keys.length - max))
  return Object.fromEntries(Object.entries(all).filter(([k]) => keep.has(k)))
}

/** Valida lo leído de `localStorage`: ignora cualquier forma inesperada. */
export function parseReviewed(raw: unknown): Record<string, ReviewRecord> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, ReviewRecord> = {}
  for (const [sid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const rec = v as { sig?: unknown; files?: unknown }
    const files: Record<string, string> = {}
    if (rec.files && typeof rec.files === 'object') {
      for (const [p, fp] of Object.entries(rec.files as Record<string, unknown>)) if (typeof fp === 'string') files[p] = fp
    }
    out[sid] = { ...(typeof rec.sig === 'string' ? { sig: rec.sig } : {}), files }
  }
  return out
}

// ───────────────────────────── Diff por archivo ─────────────────────────────

export interface FileDiffInfo {
  patch: string
  additions: number
  deletions: number
  /** Huella del contenido del diff (cambia si el archivo cambia). */
  fingerprint: string
}

/** Hash corto (djb2) del texto: basta para detectar «cambió desde que lo acepté». */
export function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${text.length.toString(36)}.${(h >>> 0).toString(36)}`
}

/**
 * Decodifica una ruta entre comillas al estilo C de git (`"caf\303\251.txt"`, `"q\"uote.txt"`): escapes octales
 * (bytes UTF-8), `\t`, `\n`, `\"`, barra invertida… Devuelve la ruta y dónde termina la comilla de cierre; `null` si está mal formada.
 */
export function unquoteGitPath(s: string, from = 0): { path: string; end: number } | null {
  if (s[from] !== '"') return null
  const bytes: number[] = []
  const enc = new TextEncoder()
  const SIMPLE: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i]
    if (c === '"') return { path: new TextDecoder().decode(new Uint8Array(bytes)), end: i + 1 }
    if (c !== '\\') {
      bytes.push(...enc.encode(c))
      continue
    }
    const n = s[++i]
    if (n === undefined) return null
    if (n in SIMPLE) bytes.push(SIMPLE[n])
    else if (/[0-7]/.test(n)) {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i))![0]
      bytes.push(parseInt(oct, 8) & 0xff)
      i += oct.length - 1
    } else return null
  }
  return null
}

/** Quita el prefijo `a/`/`b/` de una ruta del diff, entre comillas o no. */
function stripSide(raw: string, side: 'a/' | 'b/'): string | null {
  const unq = raw.startsWith('"') ? unquoteGitPath(raw)?.path : raw
  return unq && unq.startsWith(side) ? unq.slice(2) : null
}

/** Ruta (del lado nuevo) de una cabecera `diff --git a/X b/Y` (con o sin comillas); `null` si no se puede leer con seguridad. */
export function pathOfDiffHeader(line: string): string | null {
  const rest = line.startsWith('diff --git ') ? line.slice('diff --git '.length) : null
  if (!rest) return null
  if (rest.startsWith('"')) {
    // Lado «a» entre comillas: el lado «b» empieza justo después.
    const a = unquoteGitPath(rest)
    if (!a || rest[a.end] !== ' ') return null
    return stripSide(rest.slice(a.end + 1), 'b/')
  }
  if (!rest.startsWith('a/')) return null
  // Lado «b» entre comillas (y «a» sin ellas): `a/X "b/Y"`.
  if (rest.endsWith('"')) {
    const q = rest.lastIndexOf(' "b/')
    return q > 0 ? stripSide(rest.slice(q + 1), 'b/') : null
  }
  // Mismo nombre en ambos lados (lo normal): «a/P b/P».
  const half = (rest.length - 5) / 2
  if (Number.isInteger(half) && rest.slice(2, 2 + half) === rest.slice(2 + half + 3)) return rest.slice(2 + half + 3)
  // Nombres distintos (renombre) con « b/» ambiguo: no se adivina; lo resuelven `rename to` o `+++ b/` del cuerpo.
  const i = rest.indexOf(' b/')
  return i > 0 && rest.indexOf(' b/', i + 1) < 0 ? rest.slice(i + 3) : null
}

/** Líneas de cabecera extendida que git escribe entre `diff --git` y el primer `@@`. */
const EXT_HEADER =
  /^(index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |--- |\+\+\+ )/

/** Ruta tras `rename to `, `copy to `, `+++ b/` o `--- a/` (sin la tabulación final que git añade a nombres con espacios). */
function pathOfBodyLine(line: string): { path: string; strong: boolean } | null {
  const m = /^(rename to |copy to )(.*)$/.exec(line)
  if (m) {
    const raw = m[2]
    const p = raw.startsWith('"') ? unquoteGitPath(raw)?.path : raw
    return p ? { path: p, strong: true } : null
  }
  for (const [prefix, side] of [
    ['+++ ', 'b/'],
    ['--- ', 'a/']
  ] as const) {
    if (!line.startsWith(prefix)) continue
    const raw = line.slice(prefix.length).replace(/\t$/, '')
    const p = stripSide(raw, side)
    return p ? { path: p, strong: false } : null
  }
  return null
}

/**
 * Trocea un diff de varios archivos en uno por ruta. Un archivo con cambios preparados y sin preparar aparece dos
 * veces en la salida de git: aquí se juntan. Cuenta las líneas de cada bloque `@@`: lo que va detrás de un archivo y no
 * es diff (p. ej. el aviso de archivos nuevos omitidos) no se pega a su huella.
 */
export function splitPatchByFile(patch: string): Map<string, FileDiffInfo> {
  const chunks = new Map<string, string>()
  let header: string | null = null
  let strong: string | null = null
  let weakNew: string | null = null
  let weakOld: string | null = null
  let inFile = false
  let remOld = 0
  let remNew = 0
  let cur: string[] = []
  const flush = (): void => {
    const path = strong ?? header ?? weakNew ?? weakOld
    if (inFile && path !== null && cur.length) chunks.set(path, (chunks.get(path) ?? '') + cur.join('\n') + '\n')
    cur = []
    inFile = false
    header = strong = weakNew = weakOld = null
    remOld = remNew = 0
  }
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      inFile = true
      header = pathOfDiffHeader(line)
      cur.push(line)
      continue
    }
    if (!inFile) continue
    if (remOld > 0 || remNew > 0) {
      const c = line[0]
      if (c === ' ' || line === '') {
        remOld--
        remNew--
      } else if (c === '-') remOld--
      else if (c === '+') remNew--
      else if (c !== '\\') {
        flush()
        continue
      }
      cur.push(line)
      continue
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      remOld = hunk[1] === undefined ? 1 : Number(hunk[1])
      remNew = hunk[2] === undefined ? 1 : Number(hunk[2])
      cur.push(line)
    } else if (line.startsWith('\\') || EXT_HEADER.test(line)) {
      const body = pathOfBodyLine(line)
      if (body?.strong) strong = body.path
      else if (body && line.startsWith('+++ ')) weakNew = body.path
      else if (body) weakOld = body.path
      cur.push(line)
    } else flush() // Texto que no es diff: el archivo terminó.
  }
  flush()
  const out = new Map<string, FileDiffInfo>()
  for (const [p, text] of chunks) {
    const st = diffStats(text)
    out.set(p, { patch: text, additions: st.additions, deletions: st.deletions, fingerprint: fingerprint(text) })
  }
  return out
}

/** ¿Este archivo está aceptado con su contenido actual? Sin huella conocida (sin diff) no se considera aceptado. */
export function isAccepted(record: ReviewRecord | undefined, path: string, fp: string | undefined): boolean {
  return fp !== undefined && record?.files[path] === fp
}

/** Rutas aún pendientes de revisar. */
export function pendingPaths(paths: string[], record: ReviewRecord | undefined, infos: Map<string, FileDiffInfo>): string[] {
  return paths.filter((p) => !isAccepted(record, p, infos.get(p)?.fingerprint))
}

/** Huellas a guardar al aceptar estas rutas (las que no tienen diff conocido no se pueden aceptar y se omiten). */
export function acceptEntries(paths: string[], infos: Map<string, FileDiffInfo>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of paths) {
    const fp = infos.get(p)?.fingerprint
    if (fp) out[p] = fp
  }
  return out
}

// ───────────────────────────── Dónde se pinta el panel ─────────────────────────────

/** El centro (conversación + caja de entrada) conserva al menos esto: 36 rem a 16 px. */
export const CENTER_MIN_PX = 576
/** Por debajo de este ancho el panel no es útil (lista + diff). */
export const DOCK_PANEL_MIN_PX = 300
/** Tope del panel en modo «partido» (ventana mediana/angosta): 26 rem. */
export const SPLIT_MAX_PX = 416

export interface PanelLayout {
  /**
   * `docked`: fijo a la derecha y el centro conserva ≥ 36 rem. `split`: no cabe eso, pero sí conversación y panel lado a lado
   * (panel ≤ 26 rem y ≤ 50 % del área): ambos siguen enteros y usables. `full`: ni siquiera caben dos mitades útiles; el panel
   * cubre TODA el área (con su botón de cerrar) y no deja nada a medias detrás.
   */
  mode: 'docked' | 'split' | 'full'
  /** Ancho en px que ocupa el panel (en `full`, el del área). */
  width: number
}

/**
 * `container` es el ancho del área de trabajo (sin la barra lateral global); `wanted` el ancho elegido por el usuario.
 * Sin medida (0) se asume fijo, como siempre. Nunca hay superposición parcial: o van lado a lado, o el panel lo cubre todo.
 */
export function panelLayout(container: number, wanted: number): PanelLayout {
  if (container <= 0) return { mode: 'docked', width: wanted }
  const room = container - CENTER_MIN_PX
  if (room >= DOCK_PANEL_MIN_PX) return { mode: 'docked', width: Math.min(wanted, room) }
  const half = Math.floor(container / 2)
  if (half >= DOCK_PANEL_MIN_PX) return { mode: 'split', width: Math.min(wanted, SPLIT_MAX_PX, half) }
  return { mode: 'full', width: container }
}
