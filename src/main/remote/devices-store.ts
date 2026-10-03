/**
 * Dispositivos vinculados (`userData/remote.bin`), cifrado con `safeStorage` (Llavero de macOS). Del secreto
 * de dispositivo solo se guarda su sha256; el secreto en claro lo tiene únicamente el celular. Si el cifrado
 * no está disponible NUNCA se escribe en claro: la función queda desactivada.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { constantTimeEqual, sha256Hex, toBase64Url, toHex } from '@shared/remote/code'
import { DEVICE_ID_RE, LIMITS, sanitizeDeviceName } from '@shared/remote/protocol'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface DeviceRecord {
  id: string
  name: string
  /** sha256 (hex) del secreto de dispositivo. */
  secretHash: string
  createdAt: number
  lastSeenAt: number | null
}

/** Puerto de escucha guardado (D1: estable por instalación). Puertos de usuario; el resto se ignora. */
function parsePort(raw: string): number | null {
  try {
    const o = JSON.parse(raw) as { port?: unknown }
    return typeof o.port === 'number' && Number.isInteger(o.port) && o.port >= 1024 && o.port <= 65535 ? o.port : null
  } catch {
    return null
  }
}

export class DevicesLimitError extends Error {
  constructor() {
    super('devices-limit')
  }
}

export const REMOTE_FILE = 'remote.bin'

function parse(raw: string): DeviceRecord[] {
  try {
    const o = JSON.parse(raw) as { devices?: unknown }
    if (!o || !Array.isArray(o.devices)) return []
    const out: DeviceRecord[] = []
    for (const d of o.devices) {
      if (!d || typeof d !== 'object') continue
      const r = d as Record<string, unknown>
      if (typeof r.id !== 'string' || !DEVICE_ID_RE.test(r.id)) continue
      if (typeof r.secretHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.secretHash)) continue
      if (typeof r.name !== 'string') continue
      const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0
      const lastSeenAt = typeof r.lastSeenAt === 'number' && Number.isFinite(r.lastSeenAt) ? r.lastSeenAt : null
      out.push({ id: r.id, name: sanitizeDeviceName(r.name) || '?', secretHash: r.secretHash, createdAt, lastSeenAt })
      if (out.length >= LIMITS.maxDevices) break
    }
    return out
  } catch {
    return []
  }
}

export class DevicesStore {
  private cache: DeviceRecord[] | null = null
  private port: number | null = null

  constructor(
    private readonly file: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  /** ¿Se puede guardar de forma cifrada? */
  get available(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private load(): DeviceRecord[] {
    if (this.cache) return this.cache
    let list: DeviceRecord[] = []
    if (this.available && existsSync(this.file)) {
      try {
        const raw = this.safeStorage.decryptString(readFileSync(this.file))
        list = parse(raw)
        this.port = parsePort(raw)
      } catch {
        list = [] // archivo ilegible o de otro equipo: se empieza de cero
      }
    }
    this.cache = list
    return list
  }

  private save(): void {
    if (!this.available) throw new Error('safe-storage-unavailable')
    const data = this.safeStorage.encryptString(
      JSON.stringify({ devices: this.load(), ...(this.port === null ? {} : { port: this.port }) })
    )
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, data, { mode: 0o600 })
    renameSync(tmp, this.file)
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* el umask manda */
    }
  }

  /** Puerto estable guardado para el servidor local (`null` = aún no hay). */
  getPort(): number | null {
    this.load()
    return this.port
  }

  /** Guarda el puerto (solo se llama cuando no había uno). No es crítico si no se puede escribir. */
  setPort(port: number): void {
    this.load()
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return
    this.port = port
    try {
      this.save()
    } catch {
      /* sin cifrado disponible: el puerto no se guarda */
    }
  }

  list(): DeviceRecord[] {
    return this.load().map((d) => ({ ...d }))
  }

  get(id: string): DeviceRecord | null {
    const d = this.load().find((x) => x.id === id)
    return d ? { ...d } : null
  }

  /** Alta de un dispositivo: devuelve su id y el secreto en claro (solo se entrega una vez, al celular). */
  add(name: string, now: number = Date.now()): { id: string; secret: string } {
    const list = this.load()
    if (list.length >= LIMITS.maxDevices) throw new DevicesLimitError()
    const id = toHex(randomBytes(16))
    const secret = toBase64Url(randomBytes(LIMITS.secretBytes))
    list.push({ id, name: sanitizeDeviceName(name) || '?', secretHash: sha256Hex(secret), createdAt: now, lastSeenAt: null })
    this.save()
    return { id, secret }
  }

  /** Comprueba el secreto del dispositivo en tiempo constante. */
  verify(id: string, secret: string): boolean {
    const d = this.load().find((x) => x.id === id)
    // Se hace siempre el hash y la comparación, exista o no el dispositivo.
    const hash = sha256Hex(secret)
    const expected = d?.secretHash ?? '0'.repeat(64)
    const same = constantTimeEqual(hash, expected)
    return !!d && same
  }

  touch(id: string, now: number = Date.now()): void {
    const d = this.load().find((x) => x.id === id)
    if (!d) return
    d.lastSeenAt = now
    try {
      this.save()
    } catch {
      /* no es crítico */
    }
  }

  revoke(id: string): boolean {
    const list = this.load()
    const i = list.findIndex((x) => x.id === id)
    if (i < 0) return false
    list.splice(i, 1)
    this.save()
    return true
  }
}
