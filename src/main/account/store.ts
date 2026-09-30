/**
 * Almacén de la sesión de cuenta (solo main). El token se guarda cifrado con `safeStorage`
 * (Llavero de macOS) en `userData/account.bin`. Nunca pasa al renderer.
 *
 *  - Si el cifrado no está disponible, la sesión vive SOLO en memoria (se pierde al cerrar la app)
 *    y `memoryOnly` lo indica para avisar al usuario; jamás se escribe en claro.
 *  - Excepción de pruebas: con la app SIN empaquetar y `ONYXCODE_TEST_PLAIN_STORE=1` se usa un
 *    archivo de prueba en claro (`account.test.json`), para que los E2E no toquen el Llavero real.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountProvider, StoredSession } from '@shared/account'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface StoredAccount {
  session: StoredSession
  /** Última validación correcta con el servidor (ms epoch), o null si aún no hubo. */
  lastValidation: number | null
}

export interface AccountStore {
  load(): StoredAccount | null
  save(data: StoredAccount): void
  clear(): void
  /** true = la sesión no se puede guardar en disco (solo memoria). */
  readonly memoryOnly: boolean
}

export interface StoreOptions {
  /** Carpeta de datos de la app (`userData`). */
  dir: string
  safeStorage: SafeStorageLike
  /** Almacén en claro de prueba (ver `isPlainTestStore`). */
  plainTest?: boolean
}

/** El almacén en claro solo existe para pruebas: nunca en la app empaquetada. */
export function isPlainTestStore(i: { isPackaged: boolean; env: Record<string, string | undefined> }): boolean {
  return !i.isPackaged && i.env.ONYXCODE_TEST_PLAIN_STORE === '1'
}

export const ACCOUNT_FILE = 'account.bin'
export const ACCOUNT_TEST_FILE = 'account.test.json'

function parse(raw: string): StoredAccount | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const { token, email, provider } = o
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null
    if (typeof email !== 'string' || email.length === 0 || email.length > 254) return null
    if (provider !== 'google' && provider !== 'email') return null
    const lv = typeof o.lastValidation === 'number' && Number.isFinite(o.lastValidation) ? o.lastValidation : null
    return { session: { token, email, provider: provider as AccountProvider }, lastValidation: lv }
  } catch {
    return null
  }
}

function serialize(d: StoredAccount): string {
  return JSON.stringify({ ...d.session, lastValidation: d.lastValidation })
}

function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    /* sin permisos para cambiar el modo: el mkdir/umask del sistema manda */
  }
}

export function createAccountStore(o: StoreOptions): AccountStore {
  const plain = o.plainTest === true
  const file = join(o.dir, plain ? ACCOUNT_TEST_FILE : ACCOUNT_FILE)
  let memory: StoredAccount | null = null
  const canEncrypt = (): boolean => {
    try {
      return o.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
  const remove = (): void => {
    try {
      rmSync(file, { force: true })
    } catch {
      /* ya no está */
    }
  }

  return {
    get memoryOnly(): boolean {
      return !plain && !canEncrypt()
    },
    load() {
      if (memory) return memory
      if (!existsSync(file)) return null
      try {
        const raw = readFileSync(file)
        if (plain) return parse(raw.toString('utf8'))
        if (!canEncrypt()) return null
        const data = parse(o.safeStorage.decryptString(raw))
        if (!data) remove() // contenido ilegible (otro Llavero, archivo dañado): como si no hubiera sesión
        return data
      } catch {
        remove()
        return null
      }
    },
    save(data) {
      if (plain) {
        writeAtomic(file, serialize(data))
        return
      }
      if (!canEncrypt()) {
        memory = data
        remove() // no dejar una sesión antigua en disco
        return
      }
      memory = null
      writeAtomic(file, o.safeStorage.encryptString(serialize(data)))
    },
    clear() {
      memory = null
      remove()
    }
  }
}
