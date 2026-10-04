/**
 * Contrato del servicio de conexión («señal v1»): salas, código de vinculación y tramas entre el Mac y el servicio.
 *
 * TypeScript puro, sin Node ni DOM (solo `@noble/hashes`): lo comparten el Worker, el Mac, la PWA y el doble local de pruebas.
 *
 * MODELO. El servicio de conexión solo REENVÍA señalización (SDP/ICE) entre un Mac y un celular; no guarda nada ni ve
 * credenciales: la autenticación (handshake v3, ligado a las huellas DTLS) sigue ocurriendo por el DataChannel directo.
 *  - Cada Mac tiene UNA sala: `room = b64u(sha256(hostToken))`. Solo quien presenta `hostToken` puede hacer de Mac en ella; el
 *    celular solo conoce `room` (se la da el Mac al vincular, por el canal ya autenticado).
 *  - La vinculación usa una sala EFÍMERA propia: el Mac abre una segunda conexión de «host» con
 *    `pairHostToken(q)` mientras el QR vale. El servicio no ve `q`: ve el token, que no permite derivarlo.
 *  - Código de vinculación: 16 caracteres Crockford (80 bits) que el celular puede ESCRIBIR; de él sale `q`.
 */
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase64Url, toBase64Url } from './code'
import { LIMITS, ROOM_RE, SECRET_RE, parseIceServers, utf8Length, type IceServerSpec, type Parsed } from './protocol'

/** Origen de la PWA y del servicio de conexión (un solo origen: CSP `connect-src 'self'`). */
export const CLOUD_ORIGIN = 'https://remoto.onyxcode.cl'
/** Cabecera con la que el Mac presenta su `hostToken` (no va en la URL: no queda en registros). */
export const CLOUD_HOST_HEADER = 'x-onyx-host'
/** Servidor STUN que se usa SIEMPRE en el modo nube (sin él un celular en datos móviles casi nunca conecta directo). */
export const CLOUD_STUN_URL = 'stun:stun.cloudflare.com:3478'
export const CLOUD_HOST_PATH = '/v1/host'
export const CLOUD_PEER_PREFIX = '/v1/peer/'
export const CLOUD_PING = 'ping'
export const CLOUD_PONG = 'pong'

export const CLOUD_LIMITS = {
  /** Texto de un celular o del Mac reenviado tal cual (un SDP ronda 1–6 KB). */
  maxRelayBytes: LIMITS.maxSignalFrameBytes,
  maxPeersPerRoom: 2,
  /** Tramas y tiempo que un celular puede pasar en señalización (solo hace falta hasta que abre el canal). */
  maxPeerFrames: 80,
  peerLifetimeMs: 60_000,
  peersPerMinute: 30,
  grantsPerHour: 20,
  /** Sin respuesta automática al `ping` desde hace tanto, el Mac se da por caído. */
  hostDeadMs: 150_000,
  /** Tras reenviar el `hello`, plazo para que el Mac conteste `ready` o `error`. */
  readyMs: 5_000,
  /** Ping de aplicación del Mac. */
  pingMs: 60_000,
  /** Vida de las credenciales TURN (8 h). */
  turnTtlSeconds: 28_800,
  maxHostTokenChars: 43
} as const

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const SALT = enc('onyxcode/remote/v3')
const ID_RE = /^[a-z0-9]{8,16}$/

// ── salas ──

/** `hostToken` nuevo (32 B base64url). El azar lo da quien llama (`node:crypto` en el Mac). */
export function newHostToken(rand: (n: number) => Uint8Array): string {
  return toBase64Url(rand(32))
}

/** Sala de un token: `b64u(sha256(token))`. Versión síncrona (Mac y PWA). */
export function roomOfToken(hostToken: string): string {
  return toBase64Url(sha256(enc(hostToken)))
}

/** La misma cuenta con WebCrypto (el Worker no usa Node). Debe dar siempre lo mismo que `roomOfToken`. */
export async function roomOfTokenAsync(hostToken: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', enc(hostToken).slice().buffer as ArrayBuffer)
  return toBase64Url(new Uint8Array(d))
}

export const isHostToken = (v: unknown): v is string => typeof v === 'string' && SECRET_RE.test(v)
export const isRoom = (v: unknown): v is string => typeof v === 'string' && ROOM_RE.test(v)

function qBytes(q: string): Uint8Array {
  const b = SECRET_RE.test(q) ? fromBase64Url(q) : null
  if (!b || b.length !== 32) throw new Error('bad-pair-secret')
  return b
}

/** Token con el que el Mac abre la sala de vinculación del QR vigente (no permite derivar `q`). */
export function pairHostToken(q: string): string {
  return toBase64Url(hkdf(sha256, qBytes(q), SALT, enc('pair-host'), 32))
}

/** Sala de vinculación a la que se conecta el celular que tiene `q`. */
export function pairRoom(q: string): string {
  return roomOfToken(pairHostToken(q))
}

// ── código de vinculación (Crockford base32, 16 caracteres = 80 bits) ──

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const PAIR_CODE_BYTES = 10
export const PAIR_CODE_CHARS = 16

/** 16 caracteres sin separadores a partir de 10 bytes. */
export function encodePairCode(bytes: Uint8Array): string {
  if (bytes.length !== PAIR_CODE_BYTES) throw new Error('bad-code-bytes')
  let out = ''
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += CROCKFORD[(acc >> bits) & 31]
    }
    acc &= (1 << bits) - 1
  }
  return out
}

/** Para mostrar: `XXXX-XXXX-XXXX-XXXX`. */
export function formatPairCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}

/**
 * Lee lo que escribió la persona: mayúsculas o minúsculas, con o sin guiones y espacios; `O`→`0`, `I`/`L`→`1` (Crockford).
 * `null` si no son exactamente 16 caracteres válidos (la `U` no existe en el alfabeto).
 */
export function normalizePairCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== PAIR_CODE_CHARS) return null
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null
  return s
}

/** Bytes de un código ya normalizado, o `null`. */
export function decodePairCode(input: string): Uint8Array | null {
  const s = normalizePairCode(input)
  if (!s) return null
  const out = new Uint8Array(PAIR_CODE_BYTES)
  let acc = 0
  let bits = 0
  let n = 0
  for (const ch of s) {
    acc = (acc << 5) | CROCKFORD.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out[n++] = (acc >> bits) & 255
      acc &= (1 << bits) - 1
    }
  }
  return out
}

/** El secreto `q` (32 B base64url) que se deriva del código: de él salen `qid`, la clave del canal y la sala. */
export function pairSecretFromCode(code: string): string | null {
  const bytes = decodePairCode(code)
  return bytes ? toBase64Url(hkdf(sha256, bytes, SALT, enc('pair-code'), 32)) : null
}

/** Extrae el código del fragmento `#c=XXXX-XXXX-XXXX-XXXX` (y solo de ahí). */
export function codeFromHash(hash: string): string | null {
  const m = /^#c=([0-9A-Za-z-]{16,24})$/.exec(hash)
  return m ? normalizePairCode(m[1]) : null
}

// ── tramas entre el Mac y el servicio ──

/** Id de un celular dentro de la sala (lo asigna el servicio). */
export const isPeerId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

export type CloudToHostFrame =
  | { t: 'peer'; id: string }
  | { t: 'from'; id: string; d: string }
  | { t: 'gone'; id: string }
  | { t: 'turn'; id: string; servers: IceServerSpec[] }

export type HostToCloudFrame =
  | { t: 'to'; id: string; d: string }
  /** El Mac aceptó el `hello` de ese celular: el servicio puede pedir TURN y mandarlo (antes del siguiente `to`). */
  | { t: 'grant'; id: string }
  | { t: 'kick'; id: string }

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
/**
 * Tope del SOBRE JSON (no del texto `d`, que va limitado aparte a `maxRelayBytes` ya decodificado): `d` es JSON y vuelve a
 * escaparse al envolverlo, así que ocupa hasta 6 veces más en el cable (cada carácter de control `\uXXXX`).
 */
export const CLOUD_ENVELOPE_MAX_BYTES = CLOUD_LIMITS.maxRelayBytes * 6 + 512

function parseObj(raw: unknown): Parsed<Record<string, unknown>> {
  if (typeof raw !== 'string') return fail('not-text')
  const max = CLOUD_ENVELOPE_MAX_BYTES
  if (raw.length > max || utf8Length(raw) > max) return fail('too-large')
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return fail('bad-json')
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('not-object')
  return { ok: true, value: v as Record<string, unknown> }
}

const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))

/** El texto reenviado (`d`): no vacío y como mucho `maxRelayBytes` en UTF-8. */
export function isRelayText(d: unknown): d is string {
  return typeof d === 'string' && d.length > 0 && d.length <= CLOUD_LIMITS.maxRelayBytes && utf8Length(d) <= CLOUD_LIMITS.maxRelayBytes
}

export function parseCloudToHost(raw: unknown): Parsed<CloudToHostFrame> {
  const j = parseObj(raw)
  if (!j.ok) return j
  const o = j.value
  if (!isPeerId(o.id)) return fail('bad-id')
  switch (o.t) {
    case 'peer':
    case 'gone':
      return onlyKeys(o, ['t', 'id']) ? { ok: true, value: { t: o.t, id: o.id } } : fail('extra-keys')
    case 'from':
      if (!onlyKeys(o, ['t', 'id', 'd'])) return fail('extra-keys')
      return isRelayText(o.d) ? { ok: true, value: { t: 'from', id: o.id, d: o.d } } : fail('bad-data')
    case 'turn': {
      if (!onlyKeys(o, ['t', 'id', 'servers'])) return fail('extra-keys')
      const servers = parseIceServers(o.servers)
      return servers ? { ok: true, value: { t: 'turn', id: o.id, servers } } : fail('bad-servers')
    }
    default:
      return fail('unknown-type')
  }
}

export function parseHostToCloud(raw: unknown): Parsed<HostToCloudFrame> {
  const j = parseObj(raw)
  if (!j.ok) return j
  const o = j.value
  if (!isPeerId(o.id)) return fail('bad-id')
  switch (o.t) {
    case 'grant':
    case 'kick':
      return onlyKeys(o, ['t', 'id']) ? { ok: true, value: { t: o.t, id: o.id } } : fail('extra-keys')
    case 'to':
      if (!onlyKeys(o, ['t', 'id', 'd'])) return fail('extra-keys')
      return isRelayText(o.d) ? { ok: true, value: { t: 'to', id: o.id, d: o.d } } : fail('bad-data')
    default:
      return fail('unknown-type')
  }
}

export const encodeCloudFrame = (f: CloudToHostFrame | HostToCloudFrame): string => JSON.stringify(f)
