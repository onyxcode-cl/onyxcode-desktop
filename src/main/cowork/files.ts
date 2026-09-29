/**
 * Utilidades de archivos de Cowork: importar adjuntos a la carpeta de la tarea y
 * previsualizar entregables. Las rutas deben venir YA validadas (dentro de una carpeta
 * autorizada) por `CoworkManager.assertInsideApproved`.
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { CoworkDeliverable, CoworkFilePreview } from '@shared/ipc-cowork'

const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml', '.log',
  '.py', '.js', '.ts', '.sh', '.css', '.ini', '.toml', '.svg'
])
/** Documentos de texto enriquecido: se previsualizan convertidos a texto con `textutil`. */
const TEXTUTIL_EXT = new Set(['.docx', '.doc', '.rtf', '.odt'])
const TEXTUTIL_TIMEOUT_MS = 10_000
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

/**
 * Ruta libre `<dir>/<stem><ext>`; si existe, `<stem>-1<ext>`, `<stem>-2<ext>`… (nunca sobrescribe).
 */
export function freePathWithSuffix(dir: string, stem: string, ext: string): string {
  let candidate = join(dir, `${stem}${ext}`)
  for (let i = 1; existsSync(candidate) && i < 10_000; i++) candidate = join(dir, `${stem}-${i}${ext}`)
  return candidate
}

/**
 * Guarda `data` como `<stem><ext>` junto a `dir` sin sobrescribir nada (flag `wx`: si otro proceso
 * crea el mismo nombre entre la comprobación y la escritura, reintenta con el siguiente sufijo).
 */
export function writeNewFile(dir: string, stem: string, ext: string, data: Buffer): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const target = freePathWithSuffix(dir, stem, ext)
    try {
      writeFileSync(target, data, { flag: 'wx' })
      return target
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('No se pudo elegir un nombre libre para el archivo.')
}

/** Describe un archivo como entregable relativo a `root` (la carpeta que lo contiene por defecto). */
export function describeDeliverable(path: string, root: string): CoworkDeliverable {
  const st = statSync(path)
  return { path, relPath: relative(root, path) || basename(path), size: st.size, mtime: st.mtimeMs }
}

/** Convierte un documento (docx, doc, rtf, odt) a texto plano con `/usr/bin/textutil` (sin shell, 10 s). */
function textutilToText(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/textutil',
      ['-convert', 'txt', '-stdout', path],
      { timeout: TEXTUTIL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (err, stdout) => {
        if (err) {
          const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed
          reject(new Error(killed ? 'La conversión del documento tardó demasiado.' : 'No se pudo leer el documento.'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

async function previewDocument(path: string, size: number, maxBytes: number): Promise<CoworkFilePreview> {
  const limit = Math.max(1024, Math.min(maxBytes, 2 * 1024 * 1024))
  // `textutil` es indulgente (trata cualquier basura como texto): se comprueba la firma del formato.
  const ext = extname(path).toLowerCase()
  const head = Buffer.alloc(5)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, 5, 0)
  } finally {
    closeSync(fd)
  }
  if ((ext === '.docx' || ext === '.odt') && head.subarray(0, 2).toString('latin1') !== 'PK') return { path, size, kind: 'unsupported' }
  if (ext === '.rtf' && head.subarray(0, 5).toString('latin1') !== '{\\rtf') return { path, size, kind: 'unsupported' }
  let text: string
  try {
    text = await textutilToText(path)
  } catch {
    // Documento dañado o formato no reconocible: sin vista previa (se puede abrir con su app).
    return { path, size, kind: 'unsupported' }
  }
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= limit) return { path, size, kind: 'text', content: text, truncated: false }
  return { path, size, kind: 'text', content: buf.subarray(0, limit).toString('utf8'), truncated: true }
}

/** Vista previa segura: texto recortado o imagen como data URL (docx/doc/rtf/odt vía `textutil`, asíncrono). */
export function previewFile(path: string, maxBytes = DEFAULT_TEXT_BYTES): CoworkFilePreview | Promise<CoworkFilePreview> {
  const st = statSync(path)
  if (!st.isFile()) throw new Error('No es un archivo.')
  const ext = extname(path).toLowerCase()
  if (TEXTUTIL_EXT.has(ext)) return previewDocument(path, st.size, maxBytes)
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
