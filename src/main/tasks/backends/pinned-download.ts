/**
 * Descarga fijada con huella para `WslBackend.setup()` (imagen base y opencode `linux-x64`).
 *
 * Reutiliza sin modificar el patrón de `remote/tunnel`: `DOWNLOAD_HOSTS` (lista cerrada), `FetchLike` (en producción
 * `createManualFetch(net)`, que devuelve cada redirección como 3xx sin seguirla) y `sha256File`. Cada salto se valida: solo https,
 * host de la lista, sin puerto ni credenciales. Tope de bytes EXACTO (ni uno más ni uno menos) y SHA-256 calculado en flujo.
 * Se escribe a `<dest>.part` y solo se renombra a `dest` si tamaño y huella coinciden; en cualquier fallo el `.part` se borra.
 * Si `dest` ya existe con el tamaño y el SHA-256 fijados, no se descarga nada.
 */
import { createHash } from 'node:crypto'
import { lstat, open, rename, rm } from 'node:fs/promises'
import { DOWNLOAD_HOSTS, sha256File, type FetchLike } from '../../remote/tunnel/binary'
import { fsFailureKind } from '../../util/fs-error'

export type PinnedDownloadErrorCode =
  | 'bad-url'
  | 'bad-host'
  | 'offline'
  | 'http'
  | 'too-many-redirects'
  | 'too-big'
  | 'bad-size'
  | 'bad-hash'
  | 'aborted'
  /** Se acabó el espacio al guardar (F8-B198). */
  | 'disk'
  /** No hay permiso para escribir en la carpeta de destino (F8-B198). */
  | 'permission'
  | 'io'

export class PinnedDownloadError extends Error {
  constructor(readonly code: PinnedDownloadErrorCode) {
    super(code)
  }
}

export interface PinnedDownloadOptions {
  /** `createManualFetch(net)` en producción. */
  fetch: FetchLike
  /** Bytes exactos esperados. */
  size: number
  /** SHA-256 esperado (hex, minúsculas). */
  sha256: string
  /** Lista cerrada de hosts; por defecto `DOWNLOAD_HOSTS`. */
  hosts?: readonly string[]
  signal?: AbortSignal
  /** Progreso por bytes (acumulado, total). */
  onBytes?: (done: number, total: number) => void
  maxRedirects?: number
}

export interface PinnedDownloadResult {
  /** `true` si ya estaba en caché con la huella correcta (no hubo red). */
  cached: boolean
}

const HEX64 = /^[0-9a-f]{64}$/
const DEFAULT_MAX_REDIRECTS = 5

function checkUrl(raw: string, hosts: readonly string[]): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new PinnedDownloadError('bad-url')
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') throw new PinnedDownloadError('bad-url')
  if (!hosts.includes(u.hostname)) throw new PinnedDownloadError('bad-host')
  return u
}

async function cachedOk(dest: string, o: PinnedDownloadOptions): Promise<boolean> {
  try {
    const st = await lstat(dest)
    if (!st.isFile() || st.isSymbolicLink() || st.size !== o.size) return false
    return (await sha256File(dest)) === o.sha256
  } catch {
    return false
  }
}

export async function pinnedDownload(url: string, dest: string, o: PinnedDownloadOptions): Promise<PinnedDownloadResult> {
  const hosts = o.hosts ?? DOWNLOAD_HOSTS
  if (!Number.isSafeInteger(o.size) || o.size <= 0 || !HEX64.test(o.sha256)) throw new PinnedDownloadError('bad-url')
  checkUrl(url, hosts)
  if (o.signal?.aborted) throw new PinnedDownloadError('aborted')
  if (await cachedOk(dest, o)) return { cached: true }

  const part = `${dest}.part`
  try {
    await fetchToPart(url, part, hosts, o)
    await rename(part, dest)
    return { cached: false }
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    if (err instanceof PinnedDownloadError) throw err
    throw new PinnedDownloadError(o.signal?.aborted ? 'aborted' : (fsFailureKind(err) ?? 'io'))
  }
}

async function fetchToPart(url: string, part: string, hosts: readonly string[], o: PinnedDownloadOptions): Promise<void> {
  const max = o.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  let cur = url
  let res: Response | null = null
  for (let hop = 0; hop <= max; hop++) {
    checkUrl(cur, hosts)
    try {
      res = await o.fetch(cur, { signal: o.signal, redirect: 'manual' })
    } catch {
      throw new PinnedDownloadError(o.signal?.aborted ? 'aborted' : 'offline')
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      void res.body?.cancel().catch(() => undefined)
      if (!loc) throw new PinnedDownloadError('http')
      if (hop === max) throw new PinnedDownloadError('too-many-redirects')
      try {
        cur = new URL(loc, cur).toString()
      } catch {
        throw new PinnedDownloadError('bad-url')
      }
      res = null
      continue
    }
    break
  }
  if (!res || res.status !== 200 || !res.body) {
    void res?.body?.cancel().catch(() => undefined)
    throw new PinnedDownloadError('http')
  }
  const declared = res.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > o.size) {
    void res.body.cancel().catch(() => undefined)
    throw new PinnedDownloadError('too-big')
  }

  const hash = createHash('sha256')
  const fh = await open(part, 'w', 0o600)
  let total = 0
  const reader = res.body.getReader()
  // `createManualFetch` ya no escucha el abort una vez entregada la respuesta: se cancela el cuerpo aquí (desbloquea `read()`).
  const onAbort = (): void => void reader.cancel().catch(() => undefined)
  o.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (o.signal?.aborted) throw new PinnedDownloadError('aborted')
      const { done, value } = await reader.read()
      if (done) {
        if (o.signal?.aborted) throw new PinnedDownloadError('aborted')
        break
      }
      total += value.byteLength
      if (total > o.size) throw new PinnedDownloadError('too-big')
      hash.update(value)
      await fh.write(value)
      o.onBytes?.(total, o.size)
    }
  } catch (err) {
    void reader.cancel().catch(() => undefined)
    if (err instanceof PinnedDownloadError) throw err
    // Un fallo al ESCRIBIR (disco lleno, sin permiso) no es una caída de la red.
    const fsKind = fsFailureKind(err)
    throw new PinnedDownloadError(o.signal?.aborted ? 'aborted' : (fsKind ?? 'offline'))
  } finally {
    o.signal?.removeEventListener('abort', onAbort)
    await fh.close().catch(() => undefined)
  }
  if (total !== o.size) throw new PinnedDownloadError('bad-size')
  if (hash.digest('hex') !== o.sha256) throw new PinnedDownloadError('bad-hash')
}
