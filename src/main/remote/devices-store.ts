/**
 * Dispositivos vinculados (`userData/remote.bin`), cifrado con `safeStorage` (Llavero de macOS). Del secreto
 * de dispositivo solo se guarda su sha256; el secreto en claro lo tiene únicamente el celular. Desde el protocolo v3 ese
 * sha256 es MATERIAL DE CLAVE (`deviceKey = HKDF(sha256)`), no una simple comprobación: quien lo descifre puede autenticarse
 * como el celular. Por eso solo sale de aquí derivado (`authKey`), nunca el valor. Si el cifrado no está disponible NUNCA se
 * escribe en claro: la función queda desactivada.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sha256Hex, toBase64Url, toHex } from '@shared/remote/code'
import { deviceKey } from '@shared/remote/handshake'
import { DEVICE_ID_RE, LIMITS, sanitizeDeviceName } from '@shared/remote/protocol'
import { DEFAULT_DEVICE_TTL_DAYS, DEVICE_TTL_OPTIONS, type DeviceTtlDays, type RemoteDeviceInfo } from '@shared/ipc-remote'
import { deviceFingerprint } from './confirm-queue'
import { PIN_PARAMS, hashPin, parsePinRecord, verifyPinHash, type PinParams, type PinRecord } from './pin'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Un día en ms (caducidad de los vínculos). */
export const DAY_MS = 86_400_000
/** Aviso al celular: si al reconectar le quedaban 7 días o menos, `authed` lleva `expiring`. */
export const EXPIRY_WARN_MS = 7 * DAY_MS

export interface DeviceRecord {
  id: string
  name: string
  /**
   * sha256 (hex) del secreto de dispositivo. El secreto son 32 bytes aleatorios (256 bits): con esa entropía un sha256
   * simple basta (no hay diccionario que atacar); el celular es el único que tiene el secreto en claro. Es material de
   * clave del handshake v3 (ver cabecera).
   */
  secretHash: string
  createdAt: number
  /** Último uso (autenticación correcta). */
  lastUsedAt: number | null
  /** Días de validez desde `renewedAt` (`null` = nunca caduca). */
  ttlDays: DeviceTtlDays
  /** Inicio de la ventana de validez vigente: alta, último uso, cambio de plazo o migración. */
  renewedAt: number
  /** Hash con sal del PIN (nunca el PIN). Ausente = el celular aún no fijó su PIN. */
  pin?: PinRecord
  /** Fallos de PIN seguidos (persistidos: reconectar no los reinicia). */
  pinFails?: number
  /** «Recordar 12 h»: ms desde epoch hasta los que vale la confirmación de conexión. */
  trustUntil?: number
}

/** Vista de un dispositivo para Ajustes (nunca incluye el PIN ni su hash). */
export function toDeviceInfo(
  d: DeviceRecord,
  connected: boolean,
  access: RemoteDeviceInfo['access'],
  now: number,
  capDays: number | null = null
): RemoteDeviceInfo {
  const expiresAt = expiresAtOf(d, capDays)
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt,
    expiresAt,
    expired: expiresAt !== null && expiresAt <= now,
    ttlDays: d.ttlDays,
    connected,
    fingerprint: deviceFingerprint(d.id),
    hasPin: !!d.pin,
    trustUntil: d.trustUntil && d.trustUntil > now ? d.trustUntil : null,
    access
  }
}

/** Plazo efectivo en días: el elegido por el dueño recortado por el tope de la política (`null` = no caduca). */
export function effectiveTtlDays(ttlDays: DeviceTtlDays, capDays: number | null): number | null {
  if (capDays === null) return ttlDays
  return ttlDays === null ? capDays : Math.min(ttlDays, capDays)
}

/** Fin de validez del vínculo (ms desde epoch) o `null` si no caduca. */
export function expiresAtOf(d: Pick<DeviceRecord, 'renewedAt' | 'ttlDays'>, capDays: number | null = null): number | null {
  const days = effectiveTtlDays(d.ttlDays, capDays)
  return days === null ? null : d.renewedAt + days * DAY_MS
}

/** Estado de caducidad de un vínculo ya autenticado. */
export type ExpiryState = 'ok' | 'expired'

/** Ajustes globales del control remoto que se guardan junto a los dispositivos. */
export interface RemotePrefs {
  /** Pedir confirmación en el Mac en cada conexión de un celular ya vinculado (apagado por defecto). */
  confirmEachConnection: boolean
}
export const DEFAULT_PREFS: RemotePrefs = { confirmEachConnection: false }

/** Puerto de escucha guardado (D1: estable por instalación). Puertos de usuario; el resto se ignora. */
function parsePort(raw: string): number | null {
  try {
    const o = JSON.parse(raw) as { port?: unknown }
    return typeof o.port === 'number' && Number.isInteger(o.port) && o.port >= 1024 && o.port <= 65535 ? o.port : null
  } catch {
    return null
  }
}

/** Lee el bloque `prefs` (cualquier valor que no sea un booleano `true` deja el valor por defecto). */
function parsePrefs(raw: string): RemotePrefs {
  try {
    const o = JSON.parse(raw) as { prefs?: unknown }
    const p = o.prefs
    if (!p || typeof p !== 'object') return { ...DEFAULT_PREFS }
    return { confirmEachConnection: (p as Record<string, unknown>).confirmEachConnection === true }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export class DevicesLimitError extends Error {
  constructor() {
    super('devices-limit')
  }
}

export const REMOTE_FILE = 'remote.bin'

/** Lee `remote.bin`. Formato anterior (sin `ttlDays`/`renewedAt`, con `lastSeenAt`): se migra con 90 días desde `now`. */
function parse(raw: string, now: number, onMigrate: () => void = () => undefined): DeviceRecord[] {
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
      // `lastSeenAt` es el nombre del formato anterior.
      const used = r.lastUsedAt ?? r.lastSeenAt
      const lastUsedAt = typeof used === 'number' && Number.isFinite(used) ? used : null
      const ttlDays: DeviceTtlDays =
        'ttlDays' in r
          ? r.ttlDays === null
            ? null
            : DEVICE_TTL_OPTIONS.includes(r.ttlDays as DeviceTtlDays)
              ? (r.ttlDays as DeviceTtlDays)
              : DEFAULT_DEVICE_TTL_DAYS
          : DEFAULT_DEVICE_TTL_DAYS
      // Sin `renewedAt` (migración): la ventana empieza ahora, para no caducar de golpe un vínculo antiguo.
      const hasRenewed = typeof r.renewedAt === 'number' && Number.isFinite(r.renewedAt) && r.renewedAt > 0
      if (!hasRenewed || !('ttlDays' in r)) onMigrate()
      const renewedAt = hasRenewed ? (r.renewedAt as number) : now
      const rec: DeviceRecord = {
        id: r.id,
        name: sanitizeDeviceName(r.name) || '?',
        secretHash: r.secretHash,
        createdAt,
        lastUsedAt,
        ttlDays,
        renewedAt
      }
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
  private port: number | null = null
  private prefs: RemotePrefs = { ...DEFAULT_PREFS }

  constructor(
    private readonly file: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly pinParams: PinParams = PIN_PARAMS,
    private readonly clock: () => number = Date.now
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
        let migrated = false
        list = parse(raw, this.clock(), () => (migrated = true))
        this.port = parsePort(raw)
        this.prefs = parsePrefs(raw)
        if (migrated) {
          // Formato anterior: se reescribe ya (si no, la ventana de 90 días se reiniciaría en cada arranque).
          this.cache = list
          try {
            this.save()
          } catch {
            /* sin disco no se persiste: se migra de nuevo en el próximo arranque */
          }
        }
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
      JSON.stringify({
        devices: this.load(),
        ...(this.port === null ? {} : { port: this.port }),
        prefs: this.prefs
      })
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
  add(
    name: string,
    now: number = this.clock(),
    ttlDays: DeviceTtlDays = DEFAULT_DEVICE_TTL_DAYS,
    capDays: number | null = null,
    maxDevices: number = LIMITS.maxDevices
  ): { id: string; secret: string } {
    this.pruneExpired(now, capDays)
    const list = this.load()
    if (list.length >= Math.min(maxDevices, LIMITS.maxDevices)) throw new DevicesLimitError()
    const id = toHex(randomBytes(16))
    const secret = toBase64Url(randomBytes(LIMITS.secretBytes))
    list.push({
      id,
      name: sanitizeDeviceName(name) || '?',
      secretHash: sha256Hex(secret),
      createdAt: now,
      lastUsedAt: null,
      ttlDays,
      renewedAt: now
    })
    this.save()
    return { id, secret }
  }

  /**
   * Clave de autenticación del handshake v3 de un dispositivo (`HKDF(secretHash)`), o `null` si no existe. El `secretHash` no
   * sale del almacén; el handshake solo necesita esta derivación.
   */
  authKey(id: string): Uint8Array | null {
    const d = this.load().find((x) => x.id === id)
    return d ? deviceKey(d.secretHash) : null
  }

  /** Caducidad de un vínculo (`ok` si no caduca o no existe: la existencia ya la comprobó la clave). */
  expiryState(id: string, now: number = this.clock(), capDays: number | null = null): ExpiryState {
    const exp = this.expiresAt(id, capDays)
    return exp !== null && exp <= now ? 'expired' : 'ok'
  }

  /** Fin de validez de un dispositivo (`null` = no caduca o no existe). */
  expiresAt(id: string, capDays: number | null = null): number | null {
    const d = this.load().find((x) => x.id === id)
    return d ? expiresAtOf(d, capDays) : null
  }

  isExpired(id: string, now: number = this.clock(), capDays: number | null = null): boolean {
    const exp = this.expiresAt(id, capDays)
    return exp !== null && exp <= now
  }

  /** Quita los vínculos caducados (liberan su hueco). Devuelve cuántos. */
  pruneExpired(now: number = this.clock(), capDays: number | null = null): number {
    const list = this.load()
    const keep = list.filter((d) => {
      const exp = expiresAtOf(d, capDays)
      return exp === null || exp > now
    })
    const removed = list.length - keep.length
    if (removed > 0) {
      list.splice(0, list.length, ...keep)
      try {
        this.save()
      } catch {
        /* sin cifrado no se persiste; la memoria ya está limpia */
      }
    }
    return removed
  }

  /** Uso correcto: apunta `lastUsedAt` y renueva la ventana de validez. */
  touch(id: string, now: number = this.clock()): void {
    const d = this.load().find((x) => x.id === id)
    if (!d) return
    d.lastUsedAt = now
    d.renewedAt = now
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

  /** Quita todos los dispositivos. Devuelve cuántos había. */
  revokeAll(): number {
    const list = this.load()
    const n = list.length
    if (n === 0) return 0
    list.length = 0
    this.save()
    return n
  }

  /** Plazo de validez de un dispositivo (30, 90, 365 o `null` = nunca); la ventana se renueva desde ahora. */
  setTtl(id: string, days: DeviceTtlDays, now: number = this.clock()): boolean {
    if (!DEVICE_TTL_OPTIONS.includes(days)) return false
    const d = this.load().find((x) => x.id === id)
    if (!d) return false
    d.ttlDays = days
    d.renewedAt = now
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

  /** Borra «Recordar 12 h» de todos los dispositivos (una sola escritura). */
  clearAllTrust(): void {
    let any = false
    for (const d of this.load()) {
      if (d.trustUntil !== undefined) {
        delete d.trustUntil
        any = true
      }
    }
    if (any) this.save()
  }

  // ── ajustes globales ──

  getPrefs(): RemotePrefs {
    this.load()
    return { ...this.prefs }
  }

  setPrefs(p: RemotePrefs): void {
    this.load()
    this.prefs = { confirmEachConnection: p.confirmEachConnection === true }
    this.save()
  }
}
