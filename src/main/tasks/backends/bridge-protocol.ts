/**
 * Trama de la stdio de `wsl.exe` entre `main` (Windows) y el lanzador dentro de la distro (módulo PURO).
 *
 *   [id:u32 BE][tipo:u8][len:u32 BE][datos…]      (cabecera de 9 bytes; len ≤ MAX_FRAME_DATA)
 *
 * id 0 = control de la sesión. Los flujos los abre quien los inicia: ids IMPARES = `main`, PARES = el agente.
 * Mismo formato en `resources/wsl/protocol.py` (vectores compartidos en `resources/wsl/vectors.json`).
 *
 * Seguridad:
 *  - la trama inicial (INIT) la construye `wsl-spec.ts` SIN acceso a las credenciales de proveedores y aquí
 *    `encodeInit` rechaza cualquier secreto que el llamador le pida vigilar (`forbid`): la clave real NUNCA va;
 *  - límites duros (trama ≤ 1 MiB, ≤ 256 flujos, INIT ≤ 64 KiB); al pasarlos el decodificador falla con un error
 *    tipado y queda envenenado (no acepta más bytes): el que recibe corta la sesión;
 *  - control de flujo por créditos (WINDOW) para que un flujo lento no llene la memoria de `main`.
 */

export const HEADER_SIZE = 9
export const MAX_FRAME_DATA = 1024 * 1024
export const MAX_STREAMS = 256
export const MAX_INIT_BYTES = 64 * 1024
export const INITIAL_WINDOW = 256 * 1024
export const PROTOCOL_VERSION = 1

export const FrameType = {
  /** id 0, host→agente: JSON de arranque (carpetas, entorno, puertos). */
  INIT: 1,
  /** abre un flujo: datos = puerto TCP u16 BE (host→agente: el del servidor; agente→host: destino en 127.0.0.1). */
  OPEN: 2,
  DATA: 3,
  /** cierra el flujo (en los dos sentidos). */
  CLOSE: 4,
  /** datos = u16 BE código + UTF-8 (≤ 256 bytes). */
  ERROR: 5,
  /** datos = u32 BE créditos que se conceden para enviar en ese flujo. */
  WINDOW: 6,
  PING: 7,
  PONG: 8,
  /** id 0, agente→host: el servidor está escuchando. */
  READY: 9,
  /** id 0, agente→host: el servidor terminó; datos = i32 BE código. */
  EXIT: 10
} as const
export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType]
const VALID_TYPES = new Set<number>(Object.values(FrameType))

export const ErrorCode = {
  frame_too_large: 1,
  bad_type: 2,
  bad_id: 3,
  too_many_streams: 4,
  bad_payload: 5,
  stream_unknown: 6,
  port_denied: 7,
  window_exceeded: 8,
  init_invalid: 9,
  init_secret: 10,
  closed: 11,
  internal: 12
} as const
export type BridgeErrorCode = keyof typeof ErrorCode
const CODE_BY_NUM = new Map<number, BridgeErrorCode>(
  (Object.entries(ErrorCode) as Array<[BridgeErrorCode, number]>).map(([k, v]) => [v, k])
)

export class BridgeProtocolError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'BridgeProtocolError'
  }
}

export interface Frame {
  id: number
  type: FrameTypeValue
  data: Buffer
}

/** Quién inicia flujos con ese id: impares `host`, pares `agent`, 0 es el control. */
export function idOwner(id: number): 'host' | 'agent' | 'control' {
  return id === 0 ? 'control' : id % 2 === 1 ? 'host' : 'agent'
}

export function encodeFrame(f: { id: number; type: number; data?: Buffer | Uint8Array }): Buffer {
  const data = f.data ? Buffer.from(f.data) : Buffer.alloc(0)
  if (!Number.isInteger(f.id) || f.id < 0 || f.id > 0xffffffff) throw new BridgeProtocolError('bad_id')
  if (!VALID_TYPES.has(f.type)) throw new BridgeProtocolError('bad_type')
  if (data.length > MAX_FRAME_DATA) throw new BridgeProtocolError('frame_too_large')
  const out = Buffer.alloc(HEADER_SIZE + data.length)
  out.writeUInt32BE(f.id, 0)
  out.writeUInt8(f.type, 4)
  out.writeUInt32BE(data.length, 5)
  data.copy(out, HEADER_SIZE)
  return out
}

/** Decodificador incremental: tramas partidas o pegadas. Tras un error queda envenenado. */
export class FrameDecoder {
  private chunks: Buffer[] = []
  private size = 0
  private failure: BridgeProtocolError | null = null

  get failed(): BridgeProtocolError | null {
    return this.failure
  }
  /** Bytes pendientes de completar una trama. */
  get buffered(): number {
    return this.size
  }

  push(chunk: Buffer | Uint8Array): Frame[] {
    if (this.failure) throw this.failure
    if (chunk.length) {
      this.chunks.push(Buffer.from(chunk))
      this.size += chunk.length
    }
    const frames: Frame[] = []
    for (;;) {
      if (this.size < HEADER_SIZE) break
      const buf = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks)
      this.chunks = [buf]
      const id = buf.readUInt32BE(0)
      const type = buf.readUInt8(4)
      const len = buf.readUInt32BE(5)
      // Se valida la cabecera ANTES de esperar los datos: una longitud absurda no reserva memoria.
      if (!VALID_TYPES.has(type)) return this.fail('bad_type')
      if (len > MAX_FRAME_DATA) return this.fail('frame_too_large')
      if (this.size < HEADER_SIZE + len) break
      frames.push({ id, type: type as FrameTypeValue, data: Buffer.from(buf.subarray(HEADER_SIZE, HEADER_SIZE + len)) })
      const rest = buf.subarray(HEADER_SIZE + len)
      this.chunks = rest.length ? [Buffer.from(rest)] : []
      this.size = rest.length
    }
    return frames
  }

  private fail(code: BridgeErrorCode): never {
    this.failure = new BridgeProtocolError(code)
    this.chunks = []
    this.size = 0
    // Las tramas completas ya decodificadas en esta llamada se pierden a propósito: la sesión se corta.
    throw this.failure
  }
}

export function encodePort(port: number): Buffer {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BridgeProtocolError('bad_payload', 'puerto')
  const b = Buffer.alloc(2)
  b.writeUInt16BE(port)
  return b
}
export function decodePort(data: Buffer): number {
  if (data.length !== 2) throw new BridgeProtocolError('bad_payload', 'OPEN')
  const p = data.readUInt16BE(0)
  if (p < 1) throw new BridgeProtocolError('bad_payload', 'puerto 0')
  return p
}

export function encodeWindow(credits: number): Buffer {
  if (!Number.isInteger(credits) || credits < 0 || credits > 0xffffffff) throw new BridgeProtocolError('bad_payload', 'WINDOW')
  const b = Buffer.alloc(4)
  b.writeUInt32BE(credits)
  return b
}
export function decodeWindow(data: Buffer): number {
  if (data.length !== 4) throw new BridgeProtocolError('bad_payload', 'WINDOW')
  return data.readUInt32BE(0)
}

export function encodeError(code: BridgeErrorCode, message = ''): Buffer {
  const msg = Buffer.from(message, 'utf8').subarray(0, 256)
  const b = Buffer.alloc(2 + msg.length)
  b.writeUInt16BE(ErrorCode[code])
  msg.copy(b, 2)
  return b
}
export function decodeError(data: Buffer): { code: BridgeErrorCode; message: string } {
  if (data.length < 2 || data.length > 2 + 256) throw new BridgeProtocolError('bad_payload', 'ERROR')
  const code = CODE_BY_NUM.get(data.readUInt16BE(0)) ?? 'internal'
  return { code, message: data.subarray(2).toString('utf8') }
}

export function encodeExit(code: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeInt32BE(code | 0)
  return b
}
export function decodeExit(data: Buffer): number {
  if (data.length !== 4) throw new BridgeProtocolError('bad_payload', 'EXIT')
  return data.readInt32BE(0)
}

/**
 * Serializa la trama INIT. `forbid` son textos que NO pueden aparecer en ninguna parte (claves reales de
 * proveedores, la contraseña de otro servicio…): si alguno aparece (en el JSON o en su forma escapada) se lanza
 * `init_secret`. Los secretos más cortos de 8 caracteres no se vigilan (darían falsos positivos).
 */
export function encodeInit(init: unknown, forbid: readonly string[] = []): Buffer {
  let json: string
  try {
    json = JSON.stringify(init)
  } catch {
    throw new BridgeProtocolError('init_invalid')
  }
  if (typeof json !== 'string') throw new BridgeProtocolError('init_invalid')
  const data = Buffer.from(json, 'utf8')
  if (data.length > MAX_INIT_BYTES) throw new BridgeProtocolError('init_invalid', 'INIT demasiado grande')
  for (const s of forbid) {
    if (s.length >= 8 && (json.includes(s) || json.includes(JSON.stringify(s).slice(1, -1)))) {
      throw new BridgeProtocolError('init_secret')
    }
  }
  return encodeFrame({ id: 0, type: FrameType.INIT, data })
}

/**
 * Tabla de flujos de UN lado de la sesión: tope de flujos, propietario por paridad del id, y créditos de envío.
 * `peerIsHost` indica de qué lado está quien la usa para validar quién puede abrir qué ids.
 */
export class StreamTable {
  private readonly send = new Map<number, number>()
  constructor(
    private readonly local: 'host' | 'agent',
    private readonly max = MAX_STREAMS
  ) {}

  get count(): number {
    return this.send.size
  }
  has(id: number): boolean {
    return this.send.has(id)
  }

  /** Un flujo que abre el otro lado (OPEN recibido). */
  openRemote(id: number): void {
    const remote = this.local === 'host' ? 'agent' : 'host'
    if (idOwner(id) !== remote) throw new BridgeProtocolError('bad_id', 'id con la paridad del otro lado')
    this.add(id)
  }
  /** Un flujo que abrimos nosotros (OPEN a enviar). */
  openLocal(id: number): void {
    if (idOwner(id) !== this.local) throw new BridgeProtocolError('bad_id', 'id con la paridad del otro lado')
    this.add(id)
  }
  private add(id: number): void {
    if (this.send.has(id)) throw new BridgeProtocolError('bad_id', 'flujo ya abierto')
    if (this.send.size >= this.max) throw new BridgeProtocolError('too_many_streams')
    this.send.set(id, INITIAL_WINDOW)
  }

  close(id: number): boolean {
    return this.send.delete(id)
  }
  closeAll(): number[] {
    const ids = [...this.send.keys()]
    this.send.clear()
    return ids
  }

  /** Créditos que quedan para ENVIAR datos en ese flujo. */
  window(id: number): number {
    const w = this.send.get(id)
    if (w === undefined) throw new BridgeProtocolError('stream_unknown')
    return w
  }
  /** Gasta créditos al enviar `n` bytes (lanza si no alcanzan: el llamador debe esperar un WINDOW). */
  consume(id: number, n: number): void {
    const w = this.window(id)
    if (n > w) throw new BridgeProtocolError('window_exceeded')
    this.send.set(id, w - n)
  }
  grant(id: number, credits: number): void {
    const w = this.window(id)
    // Sin desbordes: más de 2^32 créditos acumulados es un par roto o malicioso.
    if (w + credits > 0xffffffff) throw new BridgeProtocolError('window_exceeded')
    this.send.set(id, w + credits)
  }
}

/**
 * Decodifica la salida de `wsl.exe` (la suya propia: `--status`, `-l -v`, `--version`, errores). Sin `WSL_UTF8=1`
 * sale en UTF-16LE (con o sin BOM); con él, en UTF-8. Se detecta por BOM o por el patrón de NULs, se quita el BOM y
 * los NUL sueltos, y se normaliza el fin de línea a `\n`.
 */
export function decodeWslOutput(buf: Buffer | Uint8Array): string {
  const b = Buffer.from(buf)
  let text: string
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    text = b.subarray(2).toString('utf16le')
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const swapped = Buffer.from(b.subarray(2))
    swapped.swap16()
    text = swapped.toString('utf16le')
  } else if (looksUtf16le(b)) {
    text = b.toString('utf16le')
  } else {
    text = b.toString('utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  }
  return text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n')
}

function looksUtf16le(b: Buffer): boolean {
  const n = Math.min(b.length, 256) & ~1
  if (n < 2) return false
  let oddZero = 0
  let evenZero = 0
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) evenZero++
    if (b[i + 1] === 0) oddZero++
  }
  const pairs = n / 2
  return oddZero >= pairs * 0.4 && evenZero < pairs * 0.1
}
