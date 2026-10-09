/**
 * Descarga genérica con integridad pinneada (tamaño y SHA-256 EXACTOS, nunca "lo que diga el
 * servidor"): escribe a `<dest>.part` y recién renombra si todo coincide; cualquier falla borra el
 * `.part` y deja `dest` como estaba (o ausente). Mismo criterio de integridad que ya usa
 * `tasks/backends/pinned-download.ts`, pero sin su lista cerrada de hosts/saltos de redirección — para
 * cuando el origen puede redirigir a una CDN con hosts que varían (p.ej. Hugging Face), el candado
 * real es el hash final, no qué dominio sirvió los bytes. `fetch` sigue redirects normal (no
 * `redirect:'manual'`), así que cualquier cadena de redirección del servidor funciona sola.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

export type FetchFn = (url: string) => Promise<Response>

function safeUnlink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // ya no estaba, o nunca se llegó a crear — no hay nada que limpiar.
  }
}

function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function fileMatches(dest: string, sha256: string): Promise<boolean> {
  if (!existsSync(dest)) return false
  return (await sha256OfFile(dest)) === sha256
}

export interface DownloadPinnedOptions {
  /** Margen de bytes por arriba de `size` antes de abortar (nunca confiar ciegamente en el `Content-Length` del servidor). */
  slackBytes?: number
  onBytes?: (received: number, total: number) => void
  fetch?: FetchFn
}

/** Si `dest` ya existe con el SHA-256 pedido, no descarga nada. */
export async function downloadPinnedFile(
  url: string,
  dest: string,
  size: number,
  sha256: string,
  opts: DownloadPinnedOptions = {}
): Promise<void> {
  if (await fileMatches(dest, sha256)) return
  mkdirSync(dirname(dest), { recursive: true })

  const fetchImpl = opts.fetch ?? fetch
  const res = await fetchImpl(url)
  if (!res.ok || !res.body) throw new Error(`Descarga falló (${res.status})`)

  const part = `${dest}.part`
  const hash = createHash('sha256')
  const max = size + (opts.slackBytes ?? 10_000_000)
  let received = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(part)
      const source = Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>)
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > max) {
          source.destroy(new Error('La descarga es más grande de lo esperado'))
          return
        }
        hash.update(chunk)
        opts.onBytes?.(received, size)
      })
      source.on('error', reject)
      out.on('error', reject)
      out.on('finish', resolve)
      source.pipe(out)
    })
  } catch (err) {
    safeUnlink(part)
    throw err
  }

  if (received !== size || hash.digest('hex') !== sha256) {
    safeUnlink(part)
    throw new Error('La descarga no coincide con lo esperado (corrupta)')
  }
  renameSync(part, dest)
}
