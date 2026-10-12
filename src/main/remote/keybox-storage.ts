/**
 * Almacén cifrado de los celulares vinculados SIN depender de la identidad de Lazunox ante el Llavero de macOS.
 *
 * El problema: el Llavero reconoce un programa sin Team ID por el hash exacto de su código, que cambia en cada versión, y volvía a pedir la
 * contraseña tras cada actualización. La solución: una llave de 32 bytes vive en el Llavero, pero la lee un auxiliar diminuto que no
 * cambia entre versiones (`resources/keybox`, `lazunox-keybox`) y que solo se la entrega a Lazunox (comprueba la firma de quien lo lanza).
 * Lazunox cifra el archivo con esa llave (AES-256-GCM). Si el auxiliar no está o rechaza, se usa `safeStorage` de Electron como antes.
 *
 * Formato propio: `LZXK` + versión (1) + nonce (12) + etiqueta (16) + cifrado. Lo que no empieza así viene de `safeStorage` (`v10…`) y se
 * descifra con él (migración sin perder nada): al volver a guardar queda con el formato nuevo.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SafeStorageLike } from './devices-store'

const MAGIC = Buffer.from('LZXK\x01', 'latin1')
const NONCE_LEN = 12
const TAG_LEN = 16

/** Pide la llave al auxiliar. Devuelve 32 bytes o `null` si no está disponible o rechaza (el llamador usa el respaldo). */
export type KeyFetcher = () => Buffer | null

export class KeyboxSafeStorage implements SafeStorageLike {
  private key: Buffer | null | undefined

  constructor(
    private readonly fetchKey: KeyFetcher,
    private readonly fallback: SafeStorageLike
  ) {}

  /** La llave del auxiliar (una sola consulta por arranque), o `null`. */
  private loadKey(): Buffer | null {
    if (this.key === undefined) {
      try {
        const k = this.fetchKey()
        this.key = k && k.length === 32 ? k : null
      } catch {
        this.key = null
      }
    }
    return this.key
  }

  isEncryptionAvailable(): boolean {
    return this.loadKey() !== null || this.fallback.isEncryptionAvailable()
  }

  encryptString(plain: string): Buffer {
    const key = this.loadKey()
    if (!key) return this.fallback.encryptString(plain)
    const nonce = randomBytes(NONCE_LEN)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body])
  }

  decryptString(encrypted: Buffer): string {
    const data = Buffer.from(encrypted)
    if (data.length < MAGIC.length || !data.subarray(0, MAGIC.length).equals(MAGIC)) return this.fallback.decryptString(data)
    const key = this.loadKey()
    if (!key) throw new Error('keybox-unavailable')
    const nonce = data.subarray(MAGIC.length, MAGIC.length + NONCE_LEN)
    const tag = data.subarray(MAGIC.length + NONCE_LEN, MAGIC.length + NONCE_LEN + TAG_LEN)
    const body = data.subarray(MAGIC.length + NONCE_LEN + TAG_LEN)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }
}

/**
 * Consulta real al auxiliar (`lazunox-keybox key`): imprime la llave en base64. Cualquier fallo (rechazo, sin llavero, salida rara) es `null`.
 * `run` es inyectable para las pruebas.
 */
export function makeKeyboxFetcher(
  helperPath: string,
  run: (cmd: string, args: string[]) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout'> = (cmd, args) =>
    spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 })
): KeyFetcher {
  return () => {
    const r = run(helperPath, ['key'])
    if (r.status !== 0) return null
    const key = Buffer.from(String(r.stdout ?? '').trim(), 'base64')
    return key.length === 32 ? key : null
  }
}
