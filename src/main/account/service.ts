/**
 * Servicio de cuenta (main): máquina de estados de la sesión. Sin dependencias de Electron (todo
 * entra por `deps`), para probarlo con reloj y red inyectados.
 *
 *  - Arranque: si hay sesión guardada se valida con `GET /v1/me` (y luego cada 24 h).
 *  - `decideAccess` (shared/account.ts) decide abrir, dar gracia o bloquear.
 *  - `isAllowed()` lo consultan Quick Entry, el atajo global y la bandeja.
 *  - Con la cuenta apagada (`config.enabled === false`) todo es no-op y `isAllowed()` es true.
 */
import {
  accountReducer,
  decideAccess,
  INITIAL_ACCOUNT_STATE,
  isAccessOpen,
  isValidCode,
  isValidEmail,
  normalizeEmail,
  REVALIDATE_MS,
  type AccountEvent,
  type AccountState,
  type StoredSession
} from '@shared/account'
import { isSafeBrowserUrl } from '@shared/account-url'
import { AccountApiError, type AccountClient, type SessionGrant } from './client'
import type { AccountConfig } from './config'
import type { LoopbackHandle, LoopbackOptions } from './loopback'
import { createPkce, createState, type Pkce } from './pkce'
import type { AccountStore, StoredAccount } from './store'

export interface AccountServiceDeps {
  config: AccountConfig
  client: AccountClient
  store: AccountStore
  now: () => number
  /** Repetición periódica; devuelve una función que la cancela. */
  setRepeating: (fn: () => void, ms: number) => () => void
  /** Abre una URL https en el navegador del sistema (ya validada). */
  openExternal: (url: string) => Promise<void>
  startLoopback: (o: LoopbackOptions) => Promise<LoopbackHandle>
  /** Guarda el JSON exportado con un diálogo «Guardar como…». `false` = el usuario canceló. */
  saveExport: (json: string, suggestedName: string) => Promise<boolean>
  onState: (s: AccountState) => void
  createPkce?: () => Pkce
  createState?: () => string
  /** Tope de espera de `POST /v1/logout` al cerrar sesión (no bloquea la pantalla más de esto). */
  logoutWaitMs?: number
}

/** Error con mensaje ya en español, pensado para mostrarse tal cual. */
export class AccountUserError extends Error {}

/** Convierte un fallo del cliente en un mensaje claro para la pantalla. */
export function friendlyAccountError(err: unknown, fallback: string): AccountUserError {
  if (err instanceof AccountUserError) return err
  if (err instanceof AccountApiError) {
    if (err.kind === 'unreachable')
      return new AccountUserError('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.')
    if (err.status === 429) {
      const wait = err.retryAfterSec && err.retryAfterSec > 0 ? ` Espera ${Math.ceil(err.retryAfterSec / 60)} min.` : ''
      return new AccountUserError(`Demasiados intentos.${wait} Prueba de nuevo más tarde.`)
    }
    if (err.status === 401 || err.status === 400) return new AccountUserError(fallback)
    if (err.kind === 'http') return new AccountUserError('El servidor no está disponible ahora. Inténtalo de nuevo en unos minutos.')
  }
  return new AccountUserError(fallback)
}

type Held = StoredAccount

export class AccountService {
  private state: AccountState
  private held: Held | null = null
  private validating: Promise<void> | null = null
  private stopRepeat: (() => void) | null = null
  private flow = 0
  private loopback: LoopbackHandle | null = null
  private started = false

  constructor(private readonly d: AccountServiceDeps) {
    this.state = { ...INITIAL_ACCOUNT_STATE, required: d.config.enabled }
  }

  getState(): AccountState {
    return this.state
  }

  /** Con la cuenta apagada siempre true; encendida, solo con sesión válida o en gracia. */
  isAllowed(): boolean {
    return isAccessOpen(this.state)
  }

  private dispatch(e: AccountEvent): void {
    const next = accountReducer(this.state, e)
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    this.d.onState(next)
  }

  /** Lee la sesión guardada y la valida. Idempotente. */
  start(): Promise<void> {
    if (!this.d.config.enabled || this.started) return Promise.resolve()
    this.started = true
    this.dispatch({ type: 'memory-only', value: this.d.store.memoryOnly })
    this.held = this.d.store.load()
    this.stopRepeat = this.d.setRepeating(() => void this.validate(), REVALIDATE_MS)
    if (!this.held) return Promise.resolve()
    this.dispatch({ type: 'checking', value: true })
    return this.validate()
  }

  stop(): void {
    this.stopRepeat?.()
    this.stopRepeat = null
    this.loopback?.cancel()
  }

  /** Valida la sesión guardada con el servidor (la deduplica). También es el «Reintentar» de la pantalla. */
  validate(): Promise<void> {
    if (!this.d.config.enabled) return Promise.resolve()
    if (this.validating) return this.validating
    const p = this.runValidate().finally(() => {
      this.validating = null
    })
    this.validating = p
    return p
  }

  private async runValidate(): Promise<void> {
    const held = this.held
    if (!held) {
      this.dispatch({ type: 'checking', value: false })
      return
    }
    const token = held.session.token
    let me
    try {
      me = await this.d.client.me(token)
    } catch {
      me = { result: { kind: 'unreachable' as const } }
    }
    // Durante la petición se cerró sesión o entró otra cuenta: este resultado ya no vale.
    if (this.held?.session.token !== token) return
    const now = this.d.now()
    if (me.result.kind === 'ok') {
      const session: StoredSession = {
        token: me.rotatedToken ?? token,
        email: me.email ?? held.session.email,
        provider: me.provider ?? held.session.provider
      }
      this.held = { session, lastValidation: now }
      this.persist()
    }
    const decision = decideAccess(now, held.session, held.lastValidation, me.result)
    if (decision.clearSession) {
      this.held = null
      this.d.store.clear()
    }
    this.dispatch({
      type: 'decision',
      decision,
      email: this.held?.session.email ?? held.session.email,
      provider: this.held?.session.provider ?? held.session.provider
    })
  }

  private persist(): void {
    if (!this.held) return
    try {
      this.d.store.save(this.held)
    } catch (err) {
      console.warn('[account] no se pudo guardar la sesión:', err instanceof Error ? err.message : err)
    }
    this.dispatch({ type: 'memory-only', value: this.d.store.memoryOnly })
  }

  private finishSignIn(g: SessionGrant): void {
    this.held = { session: { token: g.token, email: g.email, provider: g.provider }, lastValidation: this.d.now() }
    this.persist()
    this.dispatch({ type: 'signed-in', email: g.email, provider: g.provider })
  }

  // --- Correo + código ------------------------------------------------------------------------

  async emailStart(emailRaw: string): Promise<void> {
    this.requireEnabled()
    if (!isValidEmail(emailRaw)) throw new AccountUserError('Escribe un correo válido.')
    try {
      await this.d.client.emailStart(normalizeEmail(emailRaw))
    } catch (err) {
      throw friendlyAccountError(err, 'No se pudo enviar el código. Revisa el correo e inténtalo de nuevo.')
    }
  }

  async emailVerify(emailRaw: string, code: string): Promise<AccountState> {
    this.requireEnabled()
    if (!isValidEmail(emailRaw)) throw new AccountUserError('Escribe un correo válido.')
    if (!isValidCode(code)) throw new AccountUserError('El código tiene 6 dígitos.')
    try {
      this.finishSignIn(await this.d.client.emailVerify(normalizeEmail(emailRaw), code))
    } catch (err) {
      throw friendlyAccountError(err, 'El código es incorrecto o ya venció. Pide uno nuevo.')
    }
    return this.state
  }

  // --- Google por loopback (RFC 8252) con PKCE -------------------------------------------------

  async signInGoogle(): Promise<AccountState> {
    this.requireEnabled()
    this.loopback?.cancel()
    const flow = ++this.flow
    this.dispatch({ type: 'signing-in' })
    const pkce = (this.d.createPkce ?? createPkce)()
    const state = (this.d.createState ?? createState)()
    let lb: LoopbackHandle | null = null
    try {
      lb = await this.d.startLoopback({ state })
      this.loopback = lb
      if (flow !== this.flow) return this.state
      const { authUrl } = await this.d.client.googleStart({ redirectUri: lb.redirectUri, state, challenge: pkce.challenge })
      if (flow !== this.flow) return this.state // «Cancelar» durante la petición: no se abre el navegador
      if (!isSafeBrowserUrl(authUrl, this.d.config.allowLocalHttp))
        throw new AccountUserError('El servidor devolvió una dirección no válida.')
      await this.d.openExternal(authUrl)
      const r = await lb.result
      if (flow !== this.flow) return this.state // reemplazado por otro intento
      if (!r.ok) {
        if (r.reason === 'cancelled') return this.revertSignIn()
        if (r.reason === 'timeout') throw new AccountUserError('Se agotó el tiempo para iniciar sesión. Inténtalo de nuevo.')
        if (r.reason === 'denied') throw new AccountUserError('No se completó el inicio de sesión con Google.')
        throw new AccountUserError('No se pudo completar el inicio de sesión. Inténtalo de nuevo.')
      }
      this.finishSignIn(await this.d.client.exchange({ code: r.code, verifier: pkce.verifier, redirectUri: lb.redirectUri }))
      return this.state
    } catch (err) {
      if (flow !== this.flow) return this.state
      this.revertSignIn()
      throw friendlyAccountError(err, 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.')
    } finally {
      lb?.cancel()
      if (this.loopback === lb) this.loopback = null
    }
  }

  private revertSignIn(): AccountState {
    this.dispatch({ type: 'cancel' })
    return this.state
  }

  /** «Cancelar» mientras se espera al navegador. */
  cancel(): AccountState {
    this.flow++
    this.loopback?.cancel()
    this.loopback = null
    return this.revertSignIn()
  }

  // --- Sesión ----------------------------------------------------------------------------------

  async signOut(): Promise<AccountState> {
    this.requireEnabled()
    const held = this.held
    this.held = null
    this.d.store.clear()
    this.dispatch({ type: 'signed-out' })
    if (held) {
      const wait = this.d.logoutWaitMs ?? 4000
      // Revocar en el servidor es un buen esfuerzo: sin red, la sesión local ya se borró.
      await Promise.race([
        this.d.client.logout(held.session.token).catch(() => undefined),
        new Promise((r) => setTimeout(r, wait).unref?.())
      ])
    }
    return this.state
  }

  async deleteAccount(): Promise<AccountState> {
    this.requireEnabled()
    const held = this.held
    if (!held) throw new AccountUserError('No hay una sesión iniciada.')
    try {
      await this.d.client.deleteMe(held.session.token)
    } catch (err) {
      const gone = err instanceof AccountApiError && err.kind === 'http' && (err.status === 401 || err.status === 404 || err.status === 410)
      if (!gone) throw friendlyAccountError(err, 'No se pudo borrar la cuenta. Inténtalo de nuevo.')
    }
    // Solo se borra la sesión de cuenta: las claves de IA y las conversaciones no se tocan.
    this.held = null
    this.d.store.clear()
    this.dispatch({ type: 'signed-out' })
    return this.state
  }

  /** «Descargar mis datos»: JSON de `GET /v1/me` → diálogo de guardado. Devuelve si se guardó. */
  async exportData(): Promise<{ saved: boolean }> {
    this.requireEnabled()
    const held = this.held
    if (!held) throw new AccountUserError('No hay una sesión iniciada.')
    let data: unknown
    try {
      data = await this.d.client.exportMe(held.session.token)
    } catch (err) {
      throw friendlyAccountError(err, 'No se pudieron obtener tus datos. Inténtalo de nuevo.')
    }
    const json = JSON.stringify(data, null, 2)
    return { saved: await this.d.saveExport(json, 'mis-datos.json') }
  }

  private requireEnabled(): void {
    if (!this.d.config.enabled) throw new AccountUserError('Las cuentas no están activadas en esta versión.')
  }
}
