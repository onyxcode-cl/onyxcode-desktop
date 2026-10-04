/**
 * Comprueba CON LA LIBRERÍA REAL (`node-datachannel`/libdatachannel) la base del handshake v3: la huella DTLS del SDP se
 * VERIFICA contra el certificado del par. Dos `PeerConnection` en el mismo proceso, sin red externa (solo candidatos locales).
 * Se salta si el binario nativo no está disponible. Acota cada caso a unos segundos y no genera carga.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { sdpFingerprintStrict } from '@shared/remote/code'
import { remoteFingerprintMatches } from './rtc'

type Ndc = typeof import('node-datachannel')
let ndc: Ndc | null = null
try {
  ndc = createRequire(import.meta.url)('node-datachannel') as Ndc
  if (typeof ndc.PeerConnection !== 'function') ndc = null
} catch {
  ndc = null
}

const FAKE = Array(32).fill('AB').join(':')
const forge = (sdp: string): string => sdp.replace(/a=fingerprint:sha-256 [0-9A-Fa-f:]+/g, `a=fingerprint:sha-256 ${FAKE}`)

interface Result {
  aOpen: boolean
  bOpen: boolean
  bRemote: { value: string; algorithm: string } | null
  offerFp: string | null
}

/** `tamper`: a quién se le entrega un SDP con una huella falsa (el celular simulado A es el offerer; B, el «Mac»). */
function negotiate(tamper: 'none' | 'offer' | 'answer'): Promise<Result> {
  const lib = ndc as Ndc
  const A = new lib.PeerConnection('A', { iceServers: [] })
  const B = new lib.PeerConnection('B', { iceServers: [] })
  const r: Result = { aOpen: false, bOpen: false, bRemote: null, offerFp: null }
  A.onLocalDescription((sdp, type) => {
    if (type !== 'offer') return
    r.offerFp = sdpFingerprintStrict(sdp)
    B.setRemoteDescription(tamper === 'offer' ? forge(sdp) : sdp, 'offer')
  })
  B.onLocalDescription((sdp, type) => {
    if (type === 'answer') A.setRemoteDescription(tamper === 'answer' ? forge(sdp) : sdp, 'answer')
  })
  A.onLocalCandidate((c, m) => B.addRemoteCandidate(c, m))
  B.onLocalCandidate((c, m) => A.addRemoteCandidate(c, m))
  B.onDataChannel((dc) =>
    dc.onOpen(() => {
      r.bOpen = true
      r.bRemote = B.remoteFingerprint()
    })
  )
  const dc = A.createDataChannel('x')
  dc.onOpen(() => (r.aOpen = true))
  return new Promise((resolve) => {
    const done = (): void => {
      A.close()
      B.close()
      resolve(r)
    }
    const t = setInterval(() => {
      if (r.aOpen && r.bOpen) {
        clearInterval(t)
        done()
      }
    }, 50)
    setTimeout(
      () => {
        clearInterval(t)
        done()
      },
      tamper === 'none' ? 8000 : 3500
    )
  })
}

describe.skipIf(!ndc)('libdatachannel verifica la huella del SDP contra el certificado del par', () => {
  it('sin manipular: el canal abre y remoteFingerprint() es la huella del offer', async () => {
    const r = await negotiate('none')
    expect(r.aOpen && r.bOpen).toBe(true)
    expect(remoteFingerprintMatches(r.bRemote, r.offerFp)).toBe(true)
  }, 15_000)

  it('offer con huella falsa (lado del Mac): el canal NO abre', async () => {
    const r = await negotiate('offer')
    expect(r.bOpen).toBe(false)
    expect(r.aOpen).toBe(false)
  }, 15_000)

  it('answer con huella falsa (lado del celular): el canal NO abre', async () => {
    const r = await negotiate('answer')
    expect(r.bOpen).toBe(false)
    expect(r.aOpen).toBe(false)
  }, 15_000)
})

describe('remoteFingerprintMatches (defensa en profundidad)', () => {
  const hex = 'ab'.repeat(32)
  const colon = hex.match(/../g)!.join(':').toUpperCase()
  it('acepta la misma huella en cualquier formato y rechaza el resto', () => {
    expect(remoteFingerprintMatches({ value: colon, algorithm: 'sha-256' }, hex)).toBe(true)
    expect(remoteFingerprintMatches({ value: colon, algorithm: 'sha-1' }, hex)).toBe(false)
    expect(remoteFingerprintMatches({ value: 'cd'.repeat(32), algorithm: 'sha-256' }, hex)).toBe(false)
    expect(remoteFingerprintMatches({ value: colon, algorithm: 'sha-256' }, null)).toBe(false)
    expect(remoteFingerprintMatches(null, hex)).toBe(false)
    expect(remoteFingerprintMatches({}, hex)).toBe(false)
  })
})
