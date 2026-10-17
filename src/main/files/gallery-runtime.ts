/**
 * Cableado de la galería con Electron: el índice vive en `userData/gallery-index.json`, las miniaturas en `userData/gallery-thumbs`.
 * Lo configuran `extras-handlers.ts` (carpetas del Chat) y `tasks-handlers.ts` (qué carpetas autoriza Overdrive); quien registra un
 * archivo nuevo (Chat, Overdrive, «Descargar») usa `galleryRecord*` y nunca lanza.
 */
import { app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { ChatFileInfo, GalleryThumbResult } from '@shared/ipc-extras'
import { Gallery, type RecordOptions } from './gallery'
import { GalleryIndex } from './gallery-index'
import { galleryThumb, type ImageShrinker } from './gallery-thumbs'

interface ChatSide {
  chatRoots: () => string[]
  scanDirs: () => string[]
}

let chatSide: ChatSide = { chatRoots: () => [], scanDirs: () => [] }
let overdriveCheck: (root: string) => boolean = () => false
let instance: Gallery | null = null
let indexRef: GalleryIndex | null = null

export function configureGalleryChat(side: ChatSide): void {
  chatSide = side
}

/** Overdrive dice si una carpeta sigue autorizada (`tasks.assertInsideApproved`). */
export function configureGalleryOverdrive(check: (root: string) => boolean): void {
  overdriveCheck = check
}

export function getGallery(): Gallery {
  if (!instance) {
    indexRef = new GalleryIndex(join(app.getPath('userData'), 'gallery-index.json'))
    instance = new Gallery({
      index: indexRef,
      chatRoots: () => chatSide.chatRoots(),
      scanDirs: () => chatSide.scanDirs(),
      overdriveApproved: (root) => {
        try {
          return overdriveCheck(root)
        } catch {
          return false
        }
      }
    })
  }
  return instance
}

const shrink: ImageShrinker = (source, width) => {
  const img = nativeImage.createFromBuffer(source)
  if (img.isEmpty()) return null
  const { width: w } = img.getSize()
  return (w > width ? img.resize({ width, quality: 'good' }) : img).toPNG()
}

export function galleryThumbFor(info: ChatFileInfo, type: Parameters<typeof galleryThumb>[1]): GalleryThumbResult {
  return galleryThumb(info, type, { cacheDir: join(app.getPath('userData'), 'gallery-thumbs'), shrink })
}

/** Registra un archivo de Chat (documento generado o guardado). No lanza. */
export function galleryRecordChat(path: string, opts: RecordOptions = {}): void {
  try {
    getGallery().record('chat', path, opts)
  } catch {
    // la galería es una comodidad: nunca debe romper el flujo que la llama
  }
}

/** Registra entregables de Overdrive de una carpeta autorizada. No lanza. */
export function galleryRecordOverdrive(folder: string, files: readonly { path: string; mtime: number; root?: string }[]): void {
  try {
    const g = getGallery()
    for (const f of files) g.record('overdrive', f.path, { root: f.root ?? folder, createdAt: f.mtime, session: folder })
  } catch {
    // ídem
  }
}
