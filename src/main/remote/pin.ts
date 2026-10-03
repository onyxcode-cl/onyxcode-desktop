/**
 * PIN de 6 dígitos del celular (D4). El Mac NUNCA guarda el PIN: solo `scrypt(pin, sal)` con coste fuerte y sal aleatoria
 * por dispositivo. Se compara en tiempo constante. Ni el PIN ni su hash salen de este módulo hacia logs/auditoría.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { PIN_RE } from '@shared/remote/protocol'

export interface PinParams {
  N: number
  r: number
  p: number
}

/** Coste por defecto: N=2^15, r=8, p=1 (≈32 MiB y ~100 ms en un Mac actual). */
export const PIN_PARAMS: PinParams = { N: 32768, r: 8, p: 1 }
const KEYLEN = 32

export interface PinRecord {
  /** Sal en hex (16 bytes). */
  salt: string
  /** scrypt en hex (32 bytes). */
  hash: string
  N: number
  r: number
  p: number
}

function derive(pin: string, salt: Buffer, prm: PinParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // `maxmem` holgado: scrypt exige 128·N·r bytes y el tope por defecto (32 MiB) rechazaría N=2^15.
    scrypt(pin, salt, KEYLEN, { N: prm.N, r: prm.r, p: prm.p, maxmem: 128 * prm.N * prm.r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  })
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_RE.test(pin)
}

export async function hashPin(pin: string, params: PinParams = PIN_PARAMS): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('bad-pin')
  const salt = randomBytes(16)
  const key = await derive(pin, salt, params)
  return { salt: salt.toString('hex'), hash: key.toString('hex'), ...params }
}

export async function verifyPinHash(pin: string, rec: PinRecord): Promise<boolean> {
  if (!isValidPin(pin)) return false
  try {
    const key = await derive(pin, Buffer.from(rec.salt, 'hex'), { N: rec.N, r: rec.r, p: rec.p })
    const want = Buffer.from(rec.hash, 'hex')
    return want.length === key.length && timingSafeEqual(key, want)
  } catch {
    return false
  }
}

/** Valida un registro leído del disco (formato y rangos razonables de coste). */
export function parsePinRecord(v: unknown): PinRecord | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const hex = (x: unknown, len: number): x is string => typeof x === 'string' && x.length === len && /^[0-9a-f]+$/.test(x)
  const pow2 = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 2 && x <= 1 << 20 && (x & (x - 1)) === 0
  const small = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 16
  if (!hex(o.salt, 32) || !hex(o.hash, KEYLEN * 2) || !pow2(o.N) || !small(o.r) || !small(o.p)) return null
  return { salt: o.salt, hash: o.hash, N: o.N, r: o.r, p: o.p }
}
