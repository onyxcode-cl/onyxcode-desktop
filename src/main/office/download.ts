/**
 * Descarga verificada compartida por los componentes opcionales que se instalan bajo demanda (ArtCraft): tope EXACTO de
 * bytes, SHA-256 en flujo, solo https y como mucho 5 redirecciones (dónde esté el espejo da igual porque tamaño y hash se comprueban
 * ANTES de usar nada). Nada se ejecuta sin verificar.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createWriteStream, rmSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export type OfficeErrorCode =
  'unsupported' | 'no-pin' | 'disk' | 'download' | 'size' | 'hash' | 'mount' | 'signature' | 'copy' | 'cancelled'

export class OfficeError extends Error {
  constructor(
    readonly code: OfficeErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OfficeError'
  }
}

export type RunFile = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
export type FetchLike = (url: string, init: { signal?: AbortSignal; redirect: 'manual' }) => Promise<Response>

const MAX_REDIRECTS = 5

export const realRun: RunFile = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : err ? -1 : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

/** Descarga `url` a `dest` con tope EXACTO de bytes y SHA-256 en flujo. Lanza `OfficeError`. */
export async function downloadVerified(
  fetchFn: FetchLike,
  url: string,
  dest: string,
  expect: { size: number; sha256: string },
  onProgress: (done: number) => void,
  signal?: AbortSignal
): Promise<void> {
  let current = url
  let res: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!current.startsWith('https://')) throw new OfficeError('download', 'La descarga debe ser por https')
    res = await fetchFn(current, { signal, redirect: 'manual' }).catch((e: unknown) => {
      if (signal?.aborted) throw new OfficeError('cancelled', 'Descarga cancelada')
      throw new OfficeError('download', `No se pudo descargar: ${e instanceof Error ? e.message : String(e)}`)
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new OfficeError('download', 'Redirección sin destino')
      current = new URL(loc, current).toString()
      continue
    }
    break
  }
  if (!res || res.status !== 200 || !res.body) throw new OfficeError('download', `Respuesta inesperada (${res?.status ?? 'sin respuesta'})`)
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > 0 && declared !== expect.size) {
    throw new OfficeError('size', `Tamaño distinto al esperado (${declared} ≠ ${expect.size})`)
  }
  const hash = createHash('sha256')
  let received = 0
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      if (received > expect.size) return cb(new OfficeError('size', 'La descarga supera el tamaño esperado'))
      hash.update(chunk)
      onProgress(received)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(res.body as never), guard, createWriteStream(dest, { mode: 0o600 }), { signal })
  } catch (e) {
    rmSync(dest, { force: true })
    if (e instanceof OfficeError) throw e
    if (signal?.aborted) throw new OfficeError('cancelled', 'Descarga cancelada')
    throw new OfficeError('download', `Descarga interrumpida: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (received !== expect.size) {
    rmSync(dest, { force: true })
    throw new OfficeError('size', `Descarga incompleta (${received} de ${expect.size} bytes)`)
  }
  if (hash.digest('hex') !== expect.sha256) {
    rmSync(dest, { force: true })
    throw new OfficeError('hash', 'El SHA-256 no coincide con el esperado: se descarta el archivo')
  }
}

/** Equipo (TeamIdentifier) con el que está firmada una app, según `codesign -dvv`. */
export function parseTeamId(codesignOut: string): string | null {
  return /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(codesignOut)?.[1] ?? null
}
