/**
 * Galería «Lo que has creado»: junta lo que la app YA conoce con seguridad y lo valida con las mismas reglas que las tarjetas del Chat
 * (`chat-files.ts`: ruta absoluta, `realpath` dentro de carpetas permitidas, nombres de secretos fuera, ejecutables sin abrir).
 * Fuentes: (1) documentos generados en Chat (se registran al crearlos); (2) archivos de la carpeta de trabajo del Chat y los que se abrieron
 * aparte (se recorren al abrir la galería); (3) entregables de Overdrive de carpetas autorizadas (se registran al detectarlos);
 * (4) archivos guardados con «Descargar/Guardar» (se autoriza solo ese archivo exacto, no su carpeta).
 * Módulo sin Electron: carpetas y comprobaciones se inyectan.
 */
import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatFileInfo, GalleryItem, GalleryListResult, GalleryOrigin } from '@shared/ipc-extras'
import { resolveChatFile } from './chat-files'
import { galleryTypeOf, MAX_GALLERY_ITEMS, type GalleryEntry, type GalleryIndex } from './gallery-index'

const SCAN_MAX_DEPTH = 3
const SCAN_MAX_VISITED = 600
const SKIP_DIRS = new Set(['node_modules', '.git', '.opencode', '.cache', 'Library'])

export interface GalleryDeps {
  index: GalleryIndex
  /** Carpetas permitidas del Chat (su carpeta de trabajo, la de documentos generados y los proyectos recientes). */
  chatRoots: () => string[]
  /** Carpetas que se recorren al abrir la galería (subconjunto de `chatRoots`). */
  scanDirs: () => string[]
  /** ¿Overdrive sigue autorizando esa carpeta? */
  overdriveApproved: (root: string) => boolean
  now?: () => number
}

export interface RecordOptions {
  session?: string
  /** Overdrive: carpeta autorizada que contiene el archivo. */
  root?: string
  title?: string
  createdAt?: number
  /** Archivo guardado por la persona (diálogo nativo): se autoriza ese archivo exacto. */
  exact?: boolean
}

export class Gallery {
  constructor(private readonly deps: GalleryDeps) {}

  /** Carpetas contra las que se valida una entrada (vacío = ya no está autorizada). */
  private rootsFor(e: GalleryEntry): string[] {
    if (e.origin === 'overdrive') return e.root && this.deps.overdriveApproved(e.root) ? [e.root] : []
    if (e.root) return e.root === e.path ? [e.root] : []
    return this.deps.chatRoots()
  }

  /** Carpetas y archivos que las acciones de la galería pueden tocar (se suman a las del Chat). */
  extraRoots(): string[] {
    const out = new Set<string>()
    for (const e of this.deps.index.entries()) {
      if (e.origin === 'overdrive') {
        if (e.root && this.deps.overdriveApproved(e.root)) out.add(e.root)
      } else if (e.root && e.root === e.path) out.add(e.root)
    }
    return [...out]
  }

  /** Registra un archivo recién creado. Valida igual que las acciones; un archivo no permitido no entra. `true` si quedó en la lista. */
  record(origin: GalleryOrigin, path: string, opts: RecordOptions = {}): boolean {
    try {
      const type = galleryTypeOf(path)
      if (!type) return false
      if (this.deps.index.has(path)) {
        // Ya estaba: solo se completa el título; la ruta no se vuelve a validar (ruta caliente de Overdrive).
        const prev = this.deps.index.get(path)
        if (prev && !prev.title && opts.title) this.deps.index.add({ ...prev, title: opts.title })
        return true
      }
      const roots = origin === 'overdrive' ? (opts.root ? [opts.root] : []) : opts.exact ? [path] : this.deps.chatRoots()
      if (origin === 'overdrive' && !(opts.root && this.deps.overdriveApproved(opts.root))) return false
      const info = resolveChatFile(roots, path)
      if (info.kind === 'blocked') return false
      const now = this.deps.now?.() ?? Date.now()
      // Volver a abrir el mismo documento del Chat genera otro archivo temporal: se reemplaza al anterior (misma sesión, título y tipo).
      if (origin === 'chat' && opts.session && opts.title) {
        for (const e of this.deps.index.entries()) {
          if (e.origin === 'chat' && e.session === opts.session && e.title === opts.title && e.type === type) this.deps.index.delete(e.path)
        }
      }
      const entry: GalleryEntry = { path: info.path, type, origin, createdAt: opts.createdAt ?? now }
      if (opts.session) entry.session = opts.session
      if (origin === 'overdrive') entry.root = opts.root
      else if (opts.exact) entry.root = info.path
      if (opts.title) entry.title = opts.title
      return this.deps.index.add(entry)
    } catch {
      return false
    }
  }

  /** Recorre las carpetas del Chat y registra lo que encuentra (acotado). */
  private scan(): void {
    let visited = 0
    const walk = (dir: string, depth: number): void => {
      if (depth > SCAN_MAX_DEPTH || visited > SCAN_MAX_VISITED) return
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (visited++ > SCAN_MAX_VISITED) return
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
        const full = join(dir, name)
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (st.isDirectory()) walk(full, depth + 1)
        else if (st.isFile() && galleryTypeOf(full) && !this.deps.index.has(full) && !this.deps.index.isDismissed(full)) {
          this.record('chat', full, { createdAt: st.mtimeMs })
        }
      }
    }
    for (const d of this.deps.scanDirs()) walk(d, 0)
  }

  /** Reconstruye la lista: recorre carpetas, comprueba que cada archivo siga existiendo y marca los que no. Nunca lanza. */
  list(): GalleryListResult {
    try {
      this.scan()
    } catch {
      // un recorrido fallido no impide mostrar lo ya conocido
    }
    const entries = this.deps.index.entries()
    const items: GalleryItem[] = entries.slice(0, MAX_GALLERY_ITEMS).map((e) => {
      const name = e.title || basename(e.path.replace(/\\/g, '/'))
      let info: ChatFileInfo | null = null
      try {
        info = resolveChatFile(this.rootsFor(e), e.path)
      } catch {
        info = null
      }
      return {
        path: e.path,
        name,
        type: e.type,
        origin: e.origin,
        createdAt: e.createdAt,
        bytes: info?.bytes ?? 0,
        kind: info?.kind ?? 'other',
        canView: info?.canView ?? false,
        canOpen: info?.canOpen ?? false,
        missing: info === null
      }
    })
    return { items, truncated: entries.length >= MAX_GALLERY_ITEMS }
  }

  /** Valida una ruta que viene de la galería para una acción (miniatura, etc.). Lanza si no es válida. */
  resolve(path: string): ChatFileInfo {
    return resolveChatFile([...this.deps.chatRoots(), ...this.extraRoots()], path)
  }

  remove(path: string): void {
    this.deps.index.remove(path)
  }
}
