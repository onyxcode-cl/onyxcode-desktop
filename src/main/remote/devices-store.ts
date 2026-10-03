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
import type { RemoteDeviceInfo } from '@shared/ipc-remote'
import { deviceFingerprint } from './confirm-queue'
import { PIN_PARAMS, hashPin, parsePinRecord, verifyPinHash, type PinParams, type PinRecord } from './pin'

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
  /** Hash con sal del PIN (nunca el PIN). Ausente = el celular aún no fijó su PIN. */
  pin?: PinRecord
  /** Fallos de PIN seguidos (persistidos: reconectar no los reinicia). */
  pinFails?: number
  /** «Recordar 12 h»: ms desde epoch hasta los que vale la confirmación de conexión. */
  trustUntil?: number
}

/** Vista de un dispositivo para Ajustes (nunca incluye el PIN ni su hash). */
export function toDeviceInfo(d: DeviceRecord, connected: boolean, access: RemoteDeviceInfo['access'], now: number): RemoteDeviceInfo {
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    connected,
    fingerprint: deviceFingerprint(d.id),
    hasPin: !!d.pin,
    trustUntil: d.trustUntil && d.trustUntil > now ? d.trustUntil : null,
    access
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
      const rec: DeviceRecord = { id: r.id, name: sanitizeDeviceName(r.name) || '?', secretHash: r.secretHash, createdAt, lastSeenAt }
      const pin = parsePinRecord(r.pin)
      if (pin) rec.pin = pin
      if (typeof r.pinFails === 'number' && Number.isInteger(r.pinFails) && r.pinFails > 0) rec.pinFails = Math.min(r.pinFails, 100)
      if (typeof r.trustUntil === 'number' && Number.isFinite(r.trustUntil) && r.trustUntil > 0) rec.trustUntil = r.trustUntil
      out.push(rec)
      if (out.length >= LIMITS.maxDevices) break
    }
    return out
  } catch {
    return []
  }
}

export class DevicesStore {
  private cache: DeviceRecord[] | null = null

  constructor(
    private readonly file: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly pinParams: PinParams = PIN_PARAMS
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
        list = parse(this.safeStorage.decryptString(readFileSync(this.file)))
      } catch {
        list = [] // archivo ilegible o de otro equipo: se empieza de cero
      }
    }
    this.cache = list
    return list
  }

  private save(): void {
    if (!this.available) throw new Error('safe-storage-unavailable')
    const data = this.safeStorage.encryptString(JSON.stringify({ devices: this.load() }))
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

  // ── PIN y confianza (T6) ──

  hasPin(id: string): boolean {
    return !!this.load().find((x) => x.id === id)?.pin
  }

  /** Fija el PIN solo si el dispositivo aún no tiene uno (cambiarlo exige restablecerlo desde el Mac). */
  async setPin(id: string, pin: string): Promise<boolean> {
    if (!this.load().find((x) => x.id === id) || this.hasPin(id)) return false
    const rec = await hashPin(pin, this.pinParams)
    const d = this.load().find((x) => x.id === id)
    if (!d || d.pin) return false
    d.pin = rec
    delete d.pinFails
    this.save()
    return true
  }

  /** Comprueba el PIN (scrypt, tiempo constante). `false` si no hay PIN o el dispositivo no existe. */
  async verifyPin(id: string, pin: string): Promise<boolean> {
    const d = this.load().find((x) => x.id === id)
    return d?.pin ? verifyPinHash(pin, d.pin) : false
  }

  pinFails(id: string): number {
    return this.load().find((x) => x.id === id)?.pinFails ?? 0
  }

  /** Suma un fallo y lo persiste; devuelve el total. */
  recordPinFail(id: string): number {
    const d = this.load().find((x) => x.id === id)
    if (!d) return 0
    d.pinFails = (d.pinFails ?? 0) + 1
    try {
      this.save()
    } catch {
      /* el contador en memoria sigue valiendo */
    }
    return d.pinFails
  }

  clearPinFails(id: string): void {
    const d = this.load().find((x) => x.id === id)
    if (!d || !d.pinFails) return
    delete d.pinFails
    try {
      this.save()
    } catch {
      /* no es crítico */
    }
  }

  /** Borra el PIN (el celular tendrá que fijar uno nuevo al conectar). */
  resetPin(id: string): boolean {
    const d = this.load().find((x) => x.id === id)
    if (!d) return false
    delete d.pin
    delete d.pinFails
    this.save()
    return true
  }

  trustedUntil(id: string): number | null {
    return this.load().find((x) => x.id === id)?.trustUntil ?? null
  }

  /** «Recordar 12 h» (`until` en ms desde epoch) o `null` para olvidarlo. */
  setTrust(id: string, until: number | null): boolean {
    const d = this.load().find((x) => x.id === id)
    if (!d) return false
    if (until === null) delete d.trustUntil
    else d.trustUntil = until
    this.save()
    return true
  }
}
