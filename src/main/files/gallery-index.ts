/**
 * Índice local de la galería «Lo que has creado»: una lista liviana (JSON en `userData`) de los archivos que la IA creó en Chat y en
 * Overdrive. Solo guarda ruta, tipo, fecha, origen y sesión; el contenido nunca se copia. Módulo sin Electron (la ruta del archivo la
 * entrega quien lo llama; la plataforma se puede inyectar para probar rutas de Windows).
 *  - Tope: 500 entradas (al pasarse se descartan las más antiguas).
 *  - Lo que se lee del disco se trata como no confiable: cada campo se revisa y lo que no encaja se descarta.
 *  - La escritura es atómica (archivo temporal + renombrar) y nunca lanza: un fallo de disco no rompe la app.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GalleryOrigin, GalleryType } from '@shared/ipc-extras'

export const MAX_GALLERY_ITEMS = 500
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_PATH = 4096

export interface GalleryEntry {
  /** Ruta real del archivo. */
  path: string
  type: GalleryType
  origin: GalleryOrigin
  createdAt: number
  /** Sesión de Chat (o carpeta de la tarea en Overdrive) de la que salió. */
  session?: string
  /** Carpeta autorizada que contiene el archivo (solo Overdrive): de ahí sale el permiso para verlo. */
  root?: string
  /** Nombre para mostrar cuando el archivo tiene un nombre interno (documentos temporales del Chat). */
  title?: string
}

const BY_EXT: Record<string, GalleryType> = {
  '.docx': 'document',
  '.doc': 'document',
  '.odt': 'document',
  '.rtf': 'document',
  '.pages': 'document',
  '.xlsx': 'sheet',
  '.xlsm': 'sheet',
  '.xls': 'sheet',
  '.ods': 'sheet',
  '.numbers': 'sheet',
  '.pptx': 'slides',
  '.ppt': 'slides',
  '.odp': 'slides',
  '.key': 'slides',
  '.html': 'web',
  '.htm': 'web',
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.avif': 'image',
  '.md': 'text',
  '.markdown': 'text',
  '.txt': 'text'
}

/** Extensión en minúsculas, también para rutas con `\` (la plataforma de `node:path` puede no ser Windows). */
function extOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

/** Tipo de creación según la extensión; `null` = no es algo que la galería muestre (código, ejecutables, datos…). */
export function galleryTypeOf(path: string): GalleryType | null {
  return BY_EXT[extOf(path)] ?? null
}

/** Clave de comparación: en Windows no distingue mayúsculas ni el tipo de barra. */
export function galleryKey(path: string, win: boolean): string {
  return win ? path.replace(/\//g, '\\').toLowerCase() : path
}

const TYPES = new Set<string>(['document', 'sheet', 'slides', 'web', 'pdf', 'image', 'text'])

function cleanEntry(raw: unknown): GalleryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const { path, type, origin, createdAt, session, root, title } = raw as Record<string, unknown>
  if (typeof path !== 'string' || !path || path.length > MAX_PATH || path.includes('\0')) return null
  if (typeof type !== 'string' || !TYPES.has(type)) return null
  if (origin !== 'chat' && origin !== 'overdrive') return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) return null
  const e: GalleryEntry = { path, type: type as GalleryType, origin, createdAt }
  if (typeof session === 'string' && session.length <= 500) e.session = session
  if (typeof root === 'string' && root && root.length <= MAX_PATH && !root.includes('\0')) e.root = root
  if (typeof title === 'string' && title.trim()) e.title = title.trim().slice(0, 200)
  return e
}

export class GalleryIndex {
  private map: Map<string, GalleryEntry> | null = null
  /** Rutas que la persona quitó de la lista: el recorrido de carpetas no las vuelve a agregar. */
  private dismissedKeys: string[] = []

  constructor(
    private readonly file: string,
    private readonly win: boolean = process.platform === 'win32'
  ) {}

  private load(): Map<string, GalleryEntry> {
    if (this.map) return this.map
    const map = new Map<string, GalleryEntry>()
    try {
      if (existsSync(this.file)) {
        const text = readFileSync(this.file, 'utf8')
        if (text.length <= MAX_FILE_BYTES) {
          const data = JSON.parse(text) as { items?: unknown; dismissed?: unknown }
          if (Array.isArray(data.dismissed)) {
            this.dismissedKeys = data.dismissed
              .filter((k): k is string => typeof k === 'string' && k.length <= MAX_PATH)
              .slice(-MAX_GALLERY_ITEMS)
          }
          if (Array.isArray(data.items)) {
            for (const raw of data.items.slice(0, MAX_GALLERY_ITEMS * 2)) {
              const e = cleanEntry(raw)
              if (e) map.set(galleryKey(e.path, this.win), e)
            }
          }
        }
      }
    } catch {
      // archivo ilegible o roto: se parte de una lista vacía
    }
    this.map = map
    this.trim()
    return this.map
  }

  private trim(): void {
    const map = this.map
    if (!map || map.size <= MAX_GALLERY_ITEMS) return
    const sorted = [...map.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt)
    this.map = new Map(sorted.slice(0, MAX_GALLERY_ITEMS))
  }

  private save(): void {
    if (!this.map) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, items: [...this.map.values()], dismissed: this.dismissedKeys }), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch {
      // sin disco o sin permiso: la lista sigue en memoria
    }
  }

  has(path: string): boolean {
    return this.load().has(galleryKey(path, this.win))
  }

  /** Agrega una entrada. Si la ruta ya estaba, solo completa el título que faltaba. `true` si cambió algo. */
  add(entry: GalleryEntry): boolean {
    const clean = cleanEntry(entry)
    if (!clean) return false
    const key = galleryKey(clean.path, this.win)
    const prev = this.load().get(key)
    if (prev) {
      if (!prev.title && clean.title) {
        prev.title = clean.title
        this.save()
        return true
      }
      return false
    }
    this.load().set(key, clean)
    this.dismissedKeys = this.dismissedKeys.filter((k) => k !== key)
    this.trim()
    this.save()
    return true
  }

  /** «Quitar de la lista»: la entrada sale y el recorrido automático no la vuelve a traer. */
  remove(path: string): boolean {
    const key = galleryKey(path, this.win)
    const ok = this.load().delete(key)
    if (!this.dismissedKeys.includes(key)) this.dismissedKeys = [...this.dismissedKeys, key].slice(-MAX_GALLERY_ITEMS)
    this.save()
    return ok
  }

  /** Borra la entrada sin recordar que se quitó (reemplazos internos). */
  delete(path: string): boolean {
    const ok = this.load().delete(galleryKey(path, this.win))
    if (ok) this.save()
    return ok
  }

  isDismissed(path: string): boolean {
    this.load()
    return this.dismissedKeys.includes(galleryKey(path, this.win))
  }

  get(path: string): GalleryEntry | undefined {
    return this.load().get(galleryKey(path, this.win))
  }

  /** Las más recientes primero. */
  entries(): GalleryEntry[] {
    return [...this.load().values()].sort((a, b) => b.createdAt - a.createdAt)
  }
}
