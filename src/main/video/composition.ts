/** Copia acotada de contenido no confiable. Nunca se ejecuta ni se carga configuración del proyecto. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { relativeInputPath } from '../documents/input-path'
import { isInside } from '../documents/output-path'

export const MAX_COMPOSITION_FILES = 256
export const MAX_COMPOSITION_BYTES = 128 * 1024 * 1024
export const MAX_ASSET_BYTES = 32 * 1024 * 1024
const noFollow = process.platform === 'darwin' ? 0x20000000 : (constants.O_NOFOLLOW ?? 0)
const allowed = /\.(html|js|mjs|css|json|png|jpe?g|webp|gif|svg|woff2?|ttf|otf|mp3|wav|aac|ogg|m4a|mp4|webm)$/i
const invalid = (): Error => new Error('La composición debe estar dentro de su carpeta, sin enlaces y con archivos normales.')

export async function copyComposition(root: string, input: unknown, dest: string, signal: AbortSignal): Promise<string> {
  const parts = relativeInputPath(input)
  if (parts.at(-1) !== 'index.html') throw new Error('La composición debe ser un index.html relativo a su carpeta.')
  const anchor = await realpath(root)
  let source = anchor
  for (const segment of parts.slice(0, -1)) {
    source = join(source, segment)
    const st = await lstat(source)
    if (!st.isDirectory() || st.isSymbolicLink() || (await realpath(source)) !== source) throw invalid()
  }
  const base = source
  let entries = 0
  let total = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    signal.throwIfAborted()
    if (depth > 8) throw new Error('La composición tiene demasiados niveles.')
    if ((await realpath(dir)) !== dir || !isInside(base, dir)) throw invalid()
    const before = await lstat(dir)
    if (!before.isDirectory() || before.isSymbolicLink()) throw invalid()
    // opendir no lee archivos; la identidad de cada archivo se comprueba DESPUÉS de abrirlo.
    for await (const entry of await opendir(dir)) {
      const name = entry.name
      if (++entries > MAX_COMPOSITION_FILES) throw new Error('La composición supera el límite de 256 entradas.')
      const file = join(dir, name)
      const out = join(dest, relative(base, file))
      const st = await lstat(file)
      if (st.isSymbolicLink()) throw invalid()
      if (st.isDirectory()) {
        await mkdir(out, { mode: 0o700 })
        await walk(file, depth + 1)
        continue
      }
      if (!st.isFile() || st.nlink !== 1 || !allowed.test(name)) throw invalid()
      if (st.size > MAX_ASSET_BYTES || total + st.size > MAX_COMPOSITION_BYTES)
        throw new Error('La composición supera el límite de tamaño.')
      const fh = await open(file, constants.O_RDONLY | noFollow | (constants.O_NONBLOCK ?? 0))
      try {
        const opened = await fh.stat()
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== st.dev || opened.ino !== st.ino || opened.size !== st.size)
          throw invalid()
        // Lectura acotada incluso si el archivo crece después del stat.
        const bytes = Buffer.alloc(st.size + 1)
        let count = 0
        while (count < bytes.length) {
          signal.throwIfAborted()
          const chunk = await fh.read(bytes, count, bytes.length - count, count)
          if (!chunk.bytesRead) break
          count += chunk.bytesRead
        }
        const after = await fh.stat()
        if (
          count !== st.size ||
          after.size !== st.size ||
          after.mtimeMs !== opened.mtimeMs ||
          after.ctimeMs !== opened.ctimeMs ||
          (await realpath(dirname(file))) !== dirname(file)
        )
          throw invalid()
        total += count
        await writeFile(out, bytes.subarray(0, count), { flag: 'wx', mode: 0o400 })
      } finally {
        await fh.close()
      }
    }
    const after = await lstat(dir)
    if (after.dev !== before.dev || after.ino !== before.ino || (await realpath(dir)) !== dir) throw invalid()
  }
  await walk(base, 0)
  const entry = join(dest, 'index.html')
  if (!(await lstat(entry)).isFile()) throw invalid()
  return entry
}
