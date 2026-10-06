/**
 * Almacén del vínculo en el celular.
 *
 *  - HTTPS (modo nube): IndexedDB `lazunox` / almacén `link`. Guarda el `CryptoKey` NO exportable (se clona con el algoritmo de
 *    estructurado, sin exponer sus bytes), el `deviceId`, la sala del Mac y su nombre. El secreto en claro NO se guarda.
 *  - HTTP (red local, sin `crypto.subtle`): el `localStorage` de siempre (`deviceId` + secreto), sin cambios.
 *
 * Todo va en try/catch: un navegador sin almacenamiento (modo privado, política) no rompe la página; `load()` devuelve `null`
 * y `save()` rechaza con `StoreError` para que la interfaz diga «Este navegador no puede guardar el vínculo».
 */
import { DEVICE_ID_RE, SECRET_RE } from '../../src/shared/remote/protocol'

export class StoreError extends Error {
  constructor() {
    super('store-unavailable')
  }
}

export interface CloudLink {
  deviceId: string
  /** Clave HMAC de reconexión, no exportable. */
  key: CryptoKey
  /** Sala del Mac (43 car. base64url). */
  room: string
  macName: string
  pairedAt: number
}

export interface LinkStore {
  load(): Promise<CloudLink | null>
  save(link: CloudLink): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'lazunox'
const STORE = 'link'
const KEY = 'current'
const ROOM_RE = /^[A-Za-z0-9_-]{43}$/

function validLink(v: unknown, roomless = false): v is CloudLink {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.deviceId === 'string' &&
    DEVICE_ID_RE.test(o.deviceId) &&
    typeof o.room === 'string' &&
    // Modo viaje: no hay sala (el origen del túnel ya identifica al Mac); en la nube la sala es obligatoria.
    (roomless ? o.room === '' : ROOM_RE.test(o.room)) &&
    typeof o.macName === 'string' &&
    o.macName.length <= 80 &&
    typeof o.pairedAt === 'number' &&
    !!o.key &&
    typeof o.key === 'object'
  )
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(new StoreError())
  })
}

/** Almacén sobre IndexedDB. `factory` se inyecta en las pruebas (un doble en memoria). */
export function idbLinkStore(factory?: IDBFactory, opts: { roomless?: boolean } = {}): LinkStore {
  const roomless = opts.roomless === true
  const open = (): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const f = factory ?? (typeof indexedDB === 'undefined' ? null : indexedDB)
        if (!f) return reject(new StoreError())
        const r = f.open(DB_NAME, 1)
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE)
        }
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(new StoreError())
        r.onblocked = () => reject(new StoreError())
      } catch {
        reject(new StoreError())
      }
    })
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    let db: IDBDatabase | null = null
    try {
      db = await open()
      return await req(fn(db.transaction(STORE, mode).objectStore(STORE)))
    } catch {
      throw new StoreError()
    } finally {
      try {
        db?.close()
      } catch {
        /* nada */
      }
    }
  }
  return {
    async load() {
      try {
        const v = await run('readonly', (s) => s.get(KEY))
        return validLink(v, roomless) ? v : null
      } catch {
        return null
      }
    },
    async save(link) {
      if (!validLink(link, roomless)) throw new StoreError()
      await run('readwrite', (s) => s.put(link, KEY))
    },
    async clear() {
      try {
        await run('readwrite', (s) => s.delete(KEY))
      } catch {
        /* sin almacenamiento: no hay nada que borrar */
      }
    }
  }
}

// ── red local (HTTP): el almacenamiento de siempre ──

const LEGACY_KEY = 'lazunox.pwa.device'

export interface LegacyCreds {
  id: string
  secret: string
}

export function loadLegacyCreds(storage: Pick<Storage, 'getItem'> | null = safeLocal()): LegacyCreds | null {
  try {
    const raw = storage?.getItem(LEGACY_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { id?: unknown; secret?: unknown }
    if (typeof o.id === 'string' && DEVICE_ID_RE.test(o.id) && typeof o.secret === 'string' && SECRET_RE.test(o.secret))
      return { id: o.id, secret: o.secret }
  } catch {
    /* almacenamiento bloqueado o dañado */
  }
  return null
}

export function saveLegacyCreds(c: LegacyCreds, storage: Pick<Storage, 'setItem'> | null = safeLocal()): boolean {
  try {
    storage?.setItem(LEGACY_KEY, JSON.stringify(c))
    return !!storage
  } catch {
    return false
  }
}

export function clearLegacyCreds(storage: Pick<Storage, 'removeItem'> | null = safeLocal()): void {
  try {
    storage?.removeItem(LEGACY_KEY)
  } catch {
    /* nada */
  }
}

function safeLocal(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
