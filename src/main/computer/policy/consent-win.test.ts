import { describe, expect, it } from 'vitest'
import {
  CONSENT_ARM_MS,
  WIN_CONSENT_VERSION,
  consentView,
  createConsentController,
  isConsentValid,
  normalizeConsent,
  type WinConsent
} from './consent-win'

function memStore(initial: unknown = null): {
  read: () => unknown
  write: (v: WinConsent | null) => void
  writes: Array<WinConsent | null>
} {
  let v = initial
  const writes: Array<WinConsent | null> = []
  return { read: () => v, write: (x) => ((v = x), writes.push(x)), writes }
}

describe('consentimiento de Control del PC en Windows: datos', () => {
  it('lo ilegible o incompleto es «sin consentimiento»', () => {
    for (const raw of [
      null,
      undefined,
      'si',
      1,
      [],
      {},
      { version: 1 },
      { at: 5 },
      { version: 0, at: 5 },
      { version: 1.5, at: 5 },
      { version: '1', at: 5 },
      { version: 1, at: -1 },
      { version: 1, at: NaN }
    ]) {
      expect(normalizeConsent(raw), JSON.stringify(raw)).toBeNull()
      expect(consentView(raw).consent).toBe(false)
    }
  })
  it('solo vale la versión vigente (subirla invalida; una posterior tampoco vale)', () => {
    const c = { version: WIN_CONSENT_VERSION, at: 10 }
    expect(isConsentValid(c)).toBe(true)
    expect(isConsentValid(c, WIN_CONSENT_VERSION + 1)).toBe(false)
    expect(isConsentValid({ version: WIN_CONSENT_VERSION + 1, at: 10 })).toBe(false)
    expect(isConsentValid(null)).toBe(false)
  })
  it('la vista distingue «sin consentimiento» de «caducado por cambio de versión»', () => {
    expect(consentView(null)).toEqual({ consent: false, version: WIN_CONSENT_VERSION, stale: false })
    expect(consentView({ version: 1, at: 9 }, 2)).toEqual({ consent: false, version: 2, stale: true })
    expect(consentView({ version: 2, at: 9 }, 2)).toEqual({ consent: true, version: 2, stale: false })
  })
  it('la vista es exactamente la forma que el MCP espera de GET /consent', () => {
    const v = consentView({ version: WIN_CONSENT_VERSION, at: 1 })
    expect(Object.keys(v).sort()).toEqual(['consent', 'stale', 'version'])
    expect(typeof v.consent).toBe('boolean')
    expect(typeof v.version).toBe('number')
  })
})

describe('tarjeta de consentimiento (interfaz simulada)', () => {
  it('el botón solo se arma con la casilla marcada y pasados 600 ms; pulsar antes no guarda nada', () => {
    let t = 1000
    const store = memStore()
    const ui = createConsentController(store, () => t)
    ui.show()
    expect(ui.armed()).toBe(false)
    expect(ui.confirm()).toBe(false) // ni casilla ni tiempo
    ui.setChecked(true)
    t += CONSENT_ARM_MS - 1
    expect(ui.confirm()).toBe(false) // casilla pero demasiado pronto
    expect(store.writes).toEqual([])
    t += 1
    expect(ui.armed()).toBe(true)
    expect(ui.confirm()).toBe(true)
    expect(store.writes).toEqual([{ version: WIN_CONSENT_VERSION, at: t }])
    expect(ui.view().consent).toBe(true)
  })
  it('esperar sin marcar la casilla no arma el botón; desmarcarla lo desarma', () => {
    let t = 0
    const ui = createConsentController(memStore(), () => t)
    ui.show()
    t += 10_000
    expect(ui.armed()).toBe(false)
    ui.setChecked(true)
    expect(ui.armed()).toBe(true)
    ui.setChecked(false)
    expect(ui.armed()).toBe(false)
  })
  it('volver a mostrar la tarjeta reinicia el armado y desmarca la casilla', () => {
    let t = 0
    const ui = createConsentController(memStore(), () => t)
    ui.show()
    ui.setChecked(true)
    t += 5000
    ui.show()
    expect(ui.armed()).toBe(false)
    t += CONSENT_ARM_MS
    expect(ui.armed()).toBe(false) // casilla desmarcada por show()
  })
  it('es revocable: tras revocar, GET /consent da consent=false; confirmar dos veces no repite escritura sin volver a mostrar', () => {
    let t = 0
    const store = memStore()
    const ui = createConsentController(store, () => t)
    ui.show()
    ui.setChecked(true)
    t += CONSENT_ARM_MS
    expect(ui.confirm()).toBe(true)
    expect(ui.confirm()).toBe(false)
    expect(store.writes.length).toBe(1)
    ui.revoke()
    expect(store.writes.at(-1)).toBeNull()
    expect(ui.view()).toEqual({ consent: false, version: WIN_CONSENT_VERSION, stale: false })
  })
  it('un consentimiento de una versión anterior se ve como caducado y hay que volver a concederlo', () => {
    let t = 0
    const store = memStore({ version: 1, at: 5 })
    const ui = createConsentController(store, () => t, 2)
    expect(ui.view()).toEqual({ consent: false, version: 2, stale: true })
    ui.show()
    ui.setChecked(true)
    t += CONSENT_ARM_MS
    expect(ui.confirm()).toBe(true)
    expect(ui.view()).toEqual({ consent: true, version: 2, stale: false })
  })
})
