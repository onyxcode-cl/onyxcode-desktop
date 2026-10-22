/**
 * Salida de un trabajo con tope de tamaño y recorte cabeza/cola.
 *
 * El flujo lógico (stdout+stderr mezclados) tiene offsets estables [0, total):
 *   [0, head)            -> primeros bytes, en un ARCHIVO (0600) que solo se agranda;
 *   [head, head+omitted) -> hueco descartado;
 *   [.., total)          -> últimos bytes, en memoria (anillo) y volcados a un segundo archivo.
 * Así `read(desdeByte)` es incremental y estable aunque la salida sea enorme.
 */
import type { ShellBgFs } from './fs-port'

export interface OutputStoreOptions {
  fs: ShellBgFs
  headPath: string
  tailPath: string
  headMax: number
  tailMax: number
}

export interface RawRead {
  data: Buffer
  nextByte: number
  gapSkipped: boolean
  omittedBytes: number
}

export class OutputStore {
  private readonly fs: ShellBgFs
  private readonly headFd: number
  private readonly headPath: string
  private readonly tailPath: string
  private readonly headMax: number
  private readonly tailMax: number
  private headLen = 0
  private omitted = 0
  private tail: Buffer[] = []
  private tailLen = 0
  private tailDirty = false
  private closed = false

  constructor(o: OutputStoreOptions) {
    this.fs = o.fs
    this.headPath = o.headPath
    this.tailPath = o.tailPath
    this.headMax = o.headMax
    this.tailMax = o.tailMax
    this.headFd = this.fs.openAppend(o.headPath, 0o600)
  }

  get total(): number {
    return this.headLen + this.omitted + this.tailLen
  }
  get omittedBytes(): number {
    return this.omitted
  }
  get path(): string {
    return this.headPath
  }

  append(chunk: Buffer): void {
    if (this.closed || chunk.length === 0) return
    let rest = chunk
    if (this.headLen < this.headMax) {
      const room = this.headMax - this.headLen
      const part = rest.subarray(0, room)
      this.fs.writeAll(this.headFd, part)
      this.headLen += part.length
      rest = rest.subarray(part.length)
    }
    if (rest.length === 0) return
    this.tail.push(Buffer.from(rest))
    this.tailLen += rest.length
    this.tailDirty = true
    while (this.tailLen > this.tailMax && this.tail.length > 0) {
      const over = this.tailLen - this.tailMax
      const first = this.tail[0]
      if (first.length <= over) {
        this.tail.shift()
        this.tailLen -= first.length
        this.omitted += first.length
      } else {
        this.tail[0] = first.subarray(over)
        this.tailLen -= over
        this.omitted += over
      }
    }
  }

  /** Vuelca la cola a su archivo si cambió (se llama en cada vuelta de supervisión y al cerrar). */
  flushTail(): void {
    if (this.closed || !this.tailDirty) return
    this.tailDirty = false
    try {
      this.fs.writeFile(this.tailPath, Buffer.concat(this.tail), 0o600)
    } catch {
      /* el volcado es solo para depuración; la lectura usa la memoria */
    }
  }

  /** Lee hasta `max` bytes desde `from`. Si `from` cae en el hueco, salta a la cola y lo marca. */
  read(from: number, max: number): RawRead {
    const total = this.total
    let start = Math.max(0, Math.min(from, total))
    let gapSkipped = false
    const tailStart = this.headLen + this.omitted
    if (start >= this.headLen && start < tailStart) {
      start = tailStart
      gapSkipped = true
    }
    const end = Math.min(total, start + max)
    const actualStart = start
    const parts: Buffer[] = []
    if (start < this.headLen) {
      const upto = Math.min(end, this.headLen)
      parts.push(this.fs.readRange(this.headPath, start, upto - start))
      start = upto
    }
    if (start < end && start >= tailStart) {
      const all = Buffer.concat(this.tail)
      parts.push(all.subarray(start - tailStart, end - tailStart))
    }
    const data = Buffer.concat(parts)
    return { data, nextByte: actualStart + data.length, gapSkipped, omittedBytes: this.omitted }
  }

  /** Últimos `n` líneas (de hasta ~64 KiB finales), sin marcador de hueco. */
  lastLines(n: number, maxChars = 2000): string[] {
    const window = 64 * 1024
    const from = Math.max(0, this.total - window)
    const r = this.read(from, window)
    const text = r.data.toString('utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '')
    if (text === '') return []
    let lines = text.split('\n')
    if (from > 0 && !r.gapSkipped) lines = lines.slice(1)
    lines = lines.slice(-n)
    let out = lines.join('\n')
    if (out.length > maxChars) out = '…' + out.slice(out.length - maxChars)
    return out.split('\n')
  }

  close(): void {
    if (this.closed) return
    this.flushTail()
    this.closed = true
    try {
      this.fs.close(this.headFd)
    } catch {
      /* ya cerrado */
    }
  }
}

/** Corta `buf` en un borde UTF-8 válido: no deja a medias un carácter multibyte al final. */
export function utf8Safe(buf: Buffer): { text: string; used: number } {
  let p = buf.length - 1
  let back = 0
  while (p > 0 && back < 3 && (buf[p] & 0xc0) === 0x80) {
    p--
    back++
  }
  let used = buf.length
  if (p >= 0) {
    const lead = buf[p]
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
    if (need > 1 && buf.length - p < need) used = p
  }
  return { text: buf.subarray(0, used).toString('utf8'), used }
}
