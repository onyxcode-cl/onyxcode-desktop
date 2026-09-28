/**
 * Utilidades de archivos de Cowork: importar adjuntos a la carpeta de la tarea y
 * previsualizar entregables. Las rutas deben venir YA validadas (dentro de una carpeta
 * autorizada) por `CoworkManager.assertInsideApproved`.
 */
import { copyFileSync, existsSync, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { CoworkDeliverable, CoworkFilePreview } from '@shared/ipc-cowork'

const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log',
  '.py', '.js', '.ts', '.sh', '.css', '.ini', '.toml', '.rtf', '.svg'
])
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const DEFAULT_TEXT_BYTES = 256 * 1024

/** Nombre libre en `dir` para `name` ("informe.pdf" → "informe (2).pdf"). */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

/** Copia `sources` (archivos) a `folder` sin sobrescribir. */
export function importFilesInto(folder: string, sources: string[]): CoworkDeliverable[] {
  const out: CoworkDeliverable[] = []
  for (const src of sources) {
    let st
    try {
      st = statSync(src)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const dest = join(folder, freeName(folder, basename(src)))
    // Si el archivo ya está dentro de la carpeta, no duplicarlo.
    if (src === join(folder, basename(src)) || src.startsWith(folder + '/')) {
      out.push({ path: src, relPath: relative(folder, src), size: st.size, mtime: st.mtimeMs })
      continue
    }
    copyFileSync(src, dest)
    const dst = statSync(dest)
    out.push({ path: dest, relPath: relative(folder, dest), size: dst.size, mtime: dst.mtimeMs })
  }
  return out
}

/** Vista previa segura: texto recortado o imagen como data URL. */
export function previewFile(path: string, maxBytes = DEFAULT_TEXT_BYTES): CoworkFilePreview {
  const st = statSync(path)
  if (!st.isFile()) throw new Error('No es un archivo.')
  const ext = extname(path).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (mime) {
    if (st.size > MAX_IMAGE_BYTES) return { path, size: st.size, kind: 'unsupported' }
    return { path, size: st.size, kind: 'image', dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` }
  }
  if (!TEXT_EXT.has(ext)) return { path, size: st.size, kind: 'unsupported' }
  const limit = Math.max(1024, Math.min(maxBytes, 2 * 1024 * 1024))
  const len = Math.min(st.size, limit)
  const buf = Buffer.alloc(len)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, len, 0)
  } finally {
    closeSync(fd)
  }
  return { path, size: st.size, kind: 'text', content: buf.toString('utf8'), truncated: st.size > len }
}
