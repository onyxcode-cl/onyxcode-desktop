/**
 * Solo para pruebas: un «celular» que responde al handshake v3 de un `PeerSession` a través de un canal falso. Usa el
 * `ClientHandshake` real (el mismo código que la PWA), así que las pruebas ejercitan el protocolo de extremo a extremo.
 */
import { randomBytes } from 'node:crypto'
import { ClientHandshake, type Fps, type Rand } from '@shared/remote/handshake'
import type { HostFrame } from '@shared/remote/protocol'

/** Canal falso mínimo: lo que mandó el Mac (`sent`) y una forma de entregarle tramas del celular (`recv`). */
export interface HandshakeChannel {
  sent: HostFrame[]
  recv(raw: unknown): void
}

/** Huellas de prueba (una sola `a=fingerprint` sha-256 por SDP en los SDP reales). */
export const TEST_FPS: Fps = { offer: 'ab'.repeat(32), answer: 'cd'.repeat(32) }

const defaultRand: Rand = (n) => new Uint8Array(randomBytes(n))

export interface TestPhone {
  client: ClientHandshake
  /** Tras el handshake: ¿verificó el celular la prueba del Mac (`authed`/`pair-pending`/`auth-failed{expired}`)? */
  proofOk(): boolean
  /** Código de 6 dígitos del celular (solo vinculación y solo tras verificar la prueba). */
  sas(): string | null
}

function drive(ch: HandshakeChannel, client: ClientHandshake): TestPhone {
  ch.recv(client.hello())
  const hs2 = ch.sent.find((f) => f.t === 'hs2')
  if (hs2 && hs2.t === 'hs2') {
    const hs3 = client.onChallenge(hs2)
    if (hs3) ch.recv(hs3)
  }
  return {
    client,
    proofOk: () => {
      const f = ch.sent.find((x) => x.t === 'authed' || x.t === 'pair-pending' || (x.t === 'auth-failed' && 'proof' in x))
      return !!f && 'proof' in f && client.verifyProof(f.proof)
    },
    sas: () => client.sas()
  }
}

/** Reconexión: manda `hs1`, responde a `hs2` con `hs3` (si el Mac contestó) y devuelve al «celular». */
export function resumeAs(ch: HandshakeChannel, o: { deviceId: string; secret: string; fps?: Fps; rand?: Rand }): TestPhone {
  return drive(
    ch,
    new ClientHandshake({ mode: 'resume', deviceId: o.deviceId, secret: o.secret, fps: o.fps ?? TEST_FPS, rand: o.rand ?? defaultRand })
  )
}

/** Vinculación con el secreto `q` del QR. */
export function pairAs(ch: HandshakeChannel, o: { q: string; fps?: Fps; rand?: Rand }): TestPhone {
  return drive(ch, new ClientHandshake({ mode: 'pair', q: o.q, fps: o.fps ?? TEST_FPS, rand: o.rand ?? defaultRand }))
}
