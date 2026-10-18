/**
 * Servicio del puente con Telegram (entrega 1: avisos y permisos con botones).
 *
 * Reglas que NO se negocian (cada una tiene su prueba en `service.test.ts`):
 *  - UN solo dueño: el chat privado que escribió el código de vinculación. Todo lo demás (otros chats, grupos, canales, bots) se
 *    ignora SIN responder. Los botones solo valen para el dueño, una vez, y caducan.
 *  - El código: 6 dígitos, 10 min, un solo uso, 5 intentos y bloqueo temporal.
 *  - Un texto que llegue por Telegram NUNCA llega al motor: solo hay tres comandos (/start, /estado, /desvincular) y los botones.
 *  - Lo que sale pasa por el tapado de secretos y se recorta (`text.ts`, `messages.ts`).
 *  - Mientras no hay dueño vinculado ni código activo, NO hay polling (sin servidor, sin puertos: solo `getUpdates` saliente).
 *  - Dos respondedores (pantalla y Telegram): gana el primero; el otro canal se actualiza.
 */
import { t } from '@shared/i18n'
import {
  TELEGRAM_DEFAULT_STATE,
  TELEGRAM_LIMITS,
  TELEGRAM_TOKEN_RE,
  cleanTelegramToken,
  type TelegramErrorCode,
  type TelegramPhase,
  type TelegramSaveTokenResult,
  type TelegramState,
  type TelegramTestResult
} from '@shared/telegram'
import { TelegramApi, TelegramApiError, type TgCallbackQuery, type TgMessage, type TgUpdate } from './api'
import { EngineReplyError, type EngineEvent, type EngineLink, type EnginePermission } from './engine-link'
import { ButtonBook, LinkCode, MinuteLimiter } from './guards'
import { buildPermissionMessage, doneMessage, errorMessage, plain, questionMessage, stuckMessage, untitled, withStatus } from './messages'
import { TelegramStore, type AuditInput } from './store'
import { scrubToken, stripControl } from './text'

export type Limits = { -readonly [K in keyof typeof TELEGRAM_LIMITS]: number }

export interface TelegramServiceDeps {
  store: TelegramStore
  engine: EngineLink
  /** Crea el cliente de la API para un token (la dirección base y el `fetch` los decide quien lo crea). */
  makeApi: (token: string) => TelegramApi
  now?: () => number
  limits?: Partial<Limits>
  /** Espera del servidor en cada `getUpdates` (s). */
  pollTimeoutSec?: number
  /** Cada cuántos ms revisa caducidades y sesiones atascadas (0 = no lo hace solo; las pruebas llaman a `tick()`). */
  housekeepingMs?: number
  /** Generador del código (pruebas). */
  codeGen?: () => string
  onState?: (s: TelegramState) => void
  log?: (msg: string) => void
}

interface PendingPerm {
  req: EnginePermission
  title: string
  /** Mensaje enviado (id de Telegram); `null` mientras espera el periodo de gracia. */
  messageId: number | null
  body: string
  entryId: string | null
  /** Se está respondiendo desde Telegram. */
  answering: boolean
  /** Respuesta de la pantalla que llegó mientras se respondía desde Telegram. */
  screenReply: 'once' | 'always' | 'reject' | null
  timer: ReturnType<typeof setTimeout> | null
}

interface BusyInfo {
  since: number
  last: number
  stuckNotified: boolean
}

const PRIVATE_FALLBACK_LABEL = ''

export class TelegramService {
  private readonly now: () => number
  private readonly L: Limits
  private readonly code: LinkCode
  private readonly buttons: ButtonBook
  private readonly incoming: MinuteLimiter
  private readonly notices: MinuteLimiter

  private api: TelegramApi | null = null
  private token: string | null = null
  private pollCtl: AbortController | null = null
  private polling = false
  private engineOn = false
  private error: TelegramErrorCode | null = null
  private hk: ReturnType<typeof setInterval> | null = null

  private readonly pending = new Map<string, PendingPerm>()
  private readonly questions = new Set<string>()
  private readonly sessions = new Map<string, { title: string; parentID: string | null }>()
  private readonly busy = new Map<string, BusyInfo>()
  private readonly lastErrorNotice = new Map<string, number>()
  private lastForeignAudit = 0
  private lastTestAt = 0
  private disposed = false

  constructor(private readonly d: TelegramServiceDeps) {
    this.now = d.now ?? Date.now
    this.L = { ...TELEGRAM_LIMITS, ...(d.limits ?? {}) }
    this.code = new LinkCode(this.now, { ttlMs: this.L.codeTtlMs, maxAttempts: this.L.maxCodeAttempts, lockMs: this.L.lockMs }, d.codeGen)
    this.buttons = new ButtonBook(this.now, this.L.buttonTtlMs)
    this.incoming = new MinuteLimiter(this.L.incomingPerMinute, this.now)
    this.notices = new MinuteLimiter(this.L.noticesPerMinute, this.now)
  }

  // ---------------------------------------------------------------- estado

  private get persisted() {
    return this.d.store.load()
  }

  private phase(): TelegramPhase {
    const p = this.persisted
    if (!p.enabled) return 'off'
    if (!this.token) return 'no-bot'
    if (p.ownerChatId !== null) return 'linked'
    return this.code.current() ? 'linking' : 'idle'
  }

  getState(): TelegramState {
    const p = this.persisted
    const cur = this.code.current()
    return {
      ...TELEGRAM_DEFAULT_STATE,
      enabled: p.enabled,
      phase: this.phase(),
      botConfigured: this.token !== null,
      tokenTail: this.token ? this.token.slice(-4) : null,
      botUsername: this.token ? p.botUsername : null,
      ownerLabel: p.ownerChatId !== null ? p.ownerLabel || PRIVATE_FALLBACK_LABEL : null,
      code: p.ownerChatId === null ? (cur?.code ?? null) : null,
      codeExpiresAt: p.ownerChatId === null ? (cur?.expiresAt ?? null) : null,
      attemptsLeft: p.ownerChatId === null && cur ? this.code.attemptsLeft() : null,
      lockedUntil: p.ownerChatId === null ? this.code.lockUntil : null,
      error: this.error,
      secureStorage: this.d.store.secureAvailable(),
      pendingPermissions: this.countPending()
    }
  }

  private countPending(): number {
    let n = 0
    for (const p of this.pending.values()) if (p.messageId !== null) n++
    return n
  }

  private emit(): void {
    try {
      this.d.onState?.(this.getState())
    } catch {
      /* quien escucha no puede romper el servicio */
    }
  }

  private audit(i: AuditInput): void {
    this.d.store.audit(i)
  }

  private log(msg: string): void {
    try {
      this.d.log?.(scrubToken(msg, this.token))
    } catch {
      /* sin registro */
    }
  }

  // ---------------------------------------------------------------- ciclo de vida

  /** Al arrancar la app: retoma lo guardado. Si está activado y vinculado, vuelve a escuchar; si no, no hace nada de red. */
  init(): void {
    this.token = this.d.store.readToken()
    const p = this.persisted
    if (p.enabled && this.token && p.ownerChatId !== null) this.startRuntime()
    if (this.d.housekeepingMs && !this.hk) {
      this.hk = setInterval(() => void this.tick(), this.d.housekeepingMs)
      this.hk.unref?.()
    }
    this.emit()
  }

  /** Apagado de la app. */
  dispose(): void {
    this.disposed = true
    if (this.hk) clearInterval(this.hk)
    this.hk = null
    this.stopRuntime()
  }

  private startRuntime(): void {
    if (this.disposed || !this.token || !this.persisted.enabled) return
    this.api ??= this.d.makeApi(this.token)
    if (this.persisted.ownerChatId !== null && !this.engineOn) {
      this.engineOn = true
      this.d.engine.start((ev) => void this.onEngine(ev))
    }
    if (!this.polling) {
      this.polling = true
      this.pollCtl = new AbortController()
      void this.pollLoop(this.pollCtl.signal)
    }
  }

  /** Detiene el polling y la escucha del motor y suelta todo lo pendiente (los botones dejan de valer). */
  private stopRuntime(): void {
    this.pollCtl?.abort()
    this.pollCtl = null
    this.polling = false
    if (this.engineOn) this.d.engine.stop()
    this.engineOn = false
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer)
    this.pending.clear()
    this.questions.clear()
    this.busy.clear()
    this.buttons.clear()
    this.api = null
  }

  // ---------------------------------------------------------------- acciones de la ventana

  setEnabled(on: boolean): TelegramState {
    if (on === this.persisted.enabled) return this.getState()
    if (on) {
      this.d.store.save({ enabled: true })
      this.audit({ kind: 'enabled' })
      this.error = null
      if (this.token) this.startLinking()
    } else {
      this.audit({ kind: 'disabled' })
      this.unlinkInternal('disabled', false)
      this.d.store.save({ enabled: false })
      this.stopRuntime()
      this.code.clear()
      this.error = null
    }
    this.emit()
    return this.getState()
  }

  /** Guarda (tras comprobarla con Telegram) la clave del bot. */
  async saveToken(raw: string): Promise<TelegramSaveTokenResult> {
    const token = cleanTelegramToken(raw)
    if (!TELEGRAM_TOKEN_RE.test(token)) return { ok: false, error: 'invalid-token' }
    if (!this.d.store.secureAvailable()) return { ok: false, error: 'no-secure-storage' }
    const api = this.d.makeApi(token)
    let me
    try {
      me = await api.getMe()
    } catch (err) {
      if (err instanceof TelegramApiError && (err.kind === 'unauthorized' || err.kind === 'bad-request' || err.kind === 'forbidden'))
        return { ok: false, error: 'invalid-token' }
      return { ok: false, error: err instanceof TelegramApiError && err.kind === 'rate-limited' ? 'rate-limited' : 'network' }
    }
    if (!me.username || me.is_bot === false) return { ok: false, error: 'invalid-token' }
    const botId = token.slice(0, token.indexOf(':'))
    // Otro bot: el chat vinculado y el offset eran del anterior.
    if (this.persisted.botId !== botId) {
      this.unlinkInternal('token-changed', false)
      this.stopRuntime()
      this.d.store.save({ offset: 0 })
    }
    if (!this.d.store.writeToken(token)) return { ok: false, error: 'no-secure-storage' }
    this.token = token
    this.d.store.save({ botId, botUsername: me.username })
    this.audit({ kind: 'token-saved' })
    this.error = null
    if (this.persisted.enabled && this.persisted.ownerChatId === null) this.startLinking()
    this.emit()
    return { ok: true, botUsername: me.username }
  }

  /** Pide un código nuevo y se pone a escuchar. */
  startLinking(): TelegramState {
    if (!this.persisted.enabled || !this.token || this.persisted.ownerChatId !== null) return this.getState()
    const issued = this.code.issue()
    if (issued) this.audit({ kind: 'link-started' })
    if (issued) {
      this.error = null
      this.startRuntime()
    }
    this.emit()
    return this.getState()
  }

  /** «Desvincular» desde la ventana. */
  unlink(): TelegramState {
    this.unlinkInternal('app', true)
    this.stopRuntime()
    this.emit()
    return this.getState()
  }

  /** «Quitar el bot»: desvincula, apaga y borra la clave del almacén seguro. */
  removeBot(): TelegramState {
    this.unlinkInternal('remove', false)
    this.stopRuntime()
    this.code.clear()
    this.d.store.deleteToken()
    this.token = null
    this.d.store.save({ enabled: false, botId: null, botUsername: null, offset: 0, ownerChatId: null, ownerLabel: null })
    this.audit({ kind: 'token-removed' })
    this.error = null
    this.emit()
    return this.getState()
  }

  /** Interruptor de emergencia: corta ya, sin avisar a Telegram. La clave se conserva. */
  panic(): TelegramState {
    this.audit({ kind: 'panic' })
    this.unlinkInternal('panic', false)
    this.stopRuntime()
    this.code.clear()
    this.d.store.save({ enabled: false })
    this.error = null
    this.emit()
    return this.getState()
  }

  async sendTest(): Promise<TelegramTestResult> {
    const owner = this.persisted.ownerChatId
    if (owner === null || !this.api) return { ok: false, error: 'not-linked' }
    if (this.now() - this.lastTestAt < 10_000) return { ok: false, error: 'too-soon' }
    this.lastTestAt = this.now()
    const id = await this.sendToOwner(plain('telegram.msg.test'))
    if (id === null) return { ok: false, error: this.error ?? 'send-failed' }
    this.audit({ kind: 'test-sent', chat: owner })
    return { ok: true }
  }

  /** Borra el vínculo. `notify`: avisa al chat antes de soltarlo. */
  private unlinkInternal(why: string, notify: boolean): void {
    const owner = this.persisted.ownerChatId
    if (owner === null) {
      this.code.clear()
      return
    }
    if (notify && this.api) void this.api.sendMessage({ chatId: owner, text: plain('telegram.msg.unlinked') }).catch(() => undefined)
    this.audit({ kind: 'unlinked', why, chat: owner })
    this.d.store.save({ ownerChatId: null, ownerLabel: null })
    this.code.clear()
  }

  // ---------------------------------------------------------------- polling

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let delay = 1000
    while (!signal.aborted) {
      const api = this.api
      if (!api) return
      try {
        const updates = await api.getUpdates({ offset: this.persisted.offset, timeoutSec: this.d.pollTimeoutSec ?? 25 }, signal)
        if (signal.aborted) return
        delay = 1000
        if (this.error === 'network' || this.error === 'conflict' || this.error === 'rate-limited') {
          this.error = null
          this.emit()
        }
        for (const u of updates) {
          if (signal.aborted) return
          try {
            await this.handleUpdate(u)
          } catch (err) {
            this.log(`error atendiendo un mensaje: ${err instanceof Error ? err.message : 'desconocido'}`)
          }
          // Se guarda el avance DESPUÉS de atender cada mensaje: al reiniciar no se repite lo ya visto.
          this.d.store.save({ offset: Math.max(this.persisted.offset, u.update_id + 1) })
        }
      } catch (err) {
        if (signal.aborted) return
        const wait = this.onPollError(err, delay)
        if (wait === null) return
        delay = Math.min(delay * 2, 30_000)
        await sleepAbortable(wait, signal)
      }
    }
  }

  /** Decide qué hacer ante un error de `getUpdates`: milisegundos a esperar, o `null` para dejar de escuchar. */
  private onPollError(err: unknown, delay: number): number | null {
    if (err instanceof TelegramApiError) {
      if (err.kind === 'unauthorized') {
        this.error = 'bot-revoked'
        this.polling = false
        this.log('Telegram rechazó la clave del bot')
        this.emit()
        return null
      }
      if (err.kind === 'conflict') {
        this.setError('conflict')
        return 30_000
      }
      if (err.kind === 'rate-limited') {
        this.setError('rate-limited')
        return Math.min(Math.max(err.retryAfter ?? 5, 1), 60) * 1000
      }
    }
    this.setError('network')
    return delay
  }

  private setError(code: TelegramErrorCode | null): void {
    if (this.error === code) return
    this.error = code
    this.emit()
  }

  // ---------------------------------------------------------------- mensajes entrantes

  /** Público para las pruebas: procesa un `update` de Telegram. */
  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) return this.onCallback(u.callback_query)
    if (u.message) return this.onMessage(u.message)
    // Cualquier otro tipo (canales, ediciones, grupos…): se descarta.
  }

  private noteForeign(why: string, chatId?: number): void {
    const t0 = this.now()
    if (t0 - this.lastForeignAudit < 60_000) return
    this.lastForeignAudit = t0
    this.audit({ kind: 'foreign-ignored', why, ...(chatId !== undefined ? { chat: chatId } : {}) })
  }

  private async onMessage(m: TgMessage): Promise<void> {
    // Solo chats privados, de personas (no bots): grupos y canales se ignoran siempre.
    if (m.chat.type !== 'private') return this.noteForeign('not-private')
    if (!m.from || m.from.is_bot === true || m.from.id !== m.chat.id) return this.noteForeign('not-person')
    if (!this.incoming.take()) return // demasiados mensajes por minuto: se descarta sin responder
    const owner = this.persisted.ownerChatId
    const text = typeof m.text === 'string' ? m.text.slice(0, 500) : ''
    if (owner !== null) {
      if (m.chat.id !== owner) return this.noteForeign('other-chat', m.chat.id) // otro chat: sin respuesta
      return this.onOwnerText(owner, text)
    }
    // Sin dueño: solo se atiende mientras hay una vinculación en curso (el polling solo corre entonces).
    if (!this.persisted.enabled || !this.token) return
    return this.onLinkingText(m, text)
  }

  private parseCommand(text: string): string | null {
    const m = /^\/([A-Za-z_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s|$)/.exec(text)
    if (!m) return null
    const target = m[2]
    const me = this.persisted.botUsername
    if (target && me && target.toLowerCase() !== me.toLowerCase()) return '' // dirigido a otro bot
    return (m[1] as string).toLowerCase()
  }

  private async onLinkingText(m: TgMessage, text: string): Promise<void> {
    const chatId = m.chat.id
    const cmd = this.parseCommand(text)
    if (cmd === '') return
    if (cmd === 'start') {
      await this.reply(chatId, this.code.current() ? plain('telegram.msg.needCode') : plain('telegram.msg.noCode'))
      return
    }
    if (cmd !== null) return
    if (!/^\d{6}$/.test(text.trim())) {
      await this.reply(chatId, this.code.current() ? plain('telegram.msg.needCode') : plain('telegram.msg.noCode'))
      return
    }
    const r = this.code.check(text)
    if (r.ok) {
      const label = stripControl(m.from?.first_name ?? '')
        .trim()
        .slice(0, 40)
      this.d.store.save({ ownerChatId: chatId, ownerLabel: label || null })
      this.audit({ kind: 'linked', chat: chatId })
      this.error = null
      this.startRuntime() // enciende la escucha del motor
      await this.reply(chatId, plain('telegram.msg.linked'))
      this.emit()
      return
    }
    this.audit({ kind: r.reason === 'locked' ? 'link-locked' : 'link-failed', why: r.reason, chat: chatId })
    if (r.reason === 'wrong') await this.reply(chatId, plain('telegram.msg.wrong', { count: r.attemptsLeft }))
    else if (r.reason === 'expired') await this.reply(chatId, plain('telegram.msg.expired'))
    else if (r.reason === 'locked') await this.reply(chatId, plain('telegram.msg.locked'))
    else await this.reply(chatId, plain('telegram.msg.noCode'))
    if (r.reason === 'locked' || r.reason === 'expired') this.pauseIfUnlinked()
    this.emit()
  }

  private async onOwnerText(owner: number, text: string): Promise<void> {
    const cmd = this.parseCommand(text)
    if (cmd === '') return
    if (cmd === 'desvincular' || cmd === 'unlink') {
      // El mensaje de despedida va antes de soltar el vínculo.
      await this.reply(owner, plain('telegram.msg.unlinked'))
      this.unlinkInternal('command', false)
      this.stopRuntime()
      this.emit()
      return
    }
    if (cmd === 'estado' || cmd === 'status') {
      await this.reply(owner, plain('telegram.msg.status', { pending: this.countPending(), busy: this.busy.size }))
      return
    }
    if (cmd === 'start') {
      await this.reply(owner, plain('telegram.msg.ownerStart'))
      return
    }
    // Texto libre: JAMÁS se reenvía al motor en esta entrega.
    await this.reply(owner, plain('telegram.msg.ownerText'))
  }

  /** Sin dueño y sin código vigente no hay motivo para seguir escuchando. */
  private pauseIfUnlinked(): void {
    if (this.persisted.ownerChatId !== null) return
    if (this.code.current()) return
    this.pollCtl?.abort()
    this.pollCtl = null
    this.polling = false
    this.api = null
  }

  private async reply(chatId: number, html: string): Promise<void> {
    try {
      await this.api?.sendMessage({ chatId, text: html })
    } catch (err) {
      this.noteSendError(err)
    }
  }

  private noteSendError(err: unknown): void {
    if (err instanceof TelegramApiError) {
      if (err.kind === 'unauthorized') this.setError('bot-revoked')
      else if (err.kind === 'rate-limited') this.setError('rate-limited')
      else if (err.kind === 'network') this.setError('network')
      else this.setError('send-failed')
    }
    this.log(`no se pudo enviar: ${err instanceof Error ? err.message : 'error'}`)
  }

  // ---------------------------------------------------------------- botones

  private async onCallback(cb: TgCallbackQuery): Promise<void> {
    const owner = this.persisted.ownerChatId
    // Solo el dueño, desde su chat privado. Cualquier otro: sin respuesta.
    if (owner === null || cb.from.id !== owner || cb.message?.chat.id !== owner || cb.message.chat.type !== 'private') {
      return this.noteForeign('callback-foreign')
    }
    if (!this.incoming.take()) return
    const answer = async (key: Parameters<typeof plainText>[0], alert = false): Promise<void> => {
      try {
        await this.api?.answerCallbackQuery({ id: cb.id, text: plainText(key), alert })
      } catch (err) {
        this.noteSendError(err)
      }
    }
    const r = this.buttons.take(cb.data, owner)
    if (!r.ok) {
      if (r.reason === 'used') return answer(r.entry?.by === 'screen' ? 'telegram.msg.perm.toastAnswered' : 'telegram.msg.perm.toastUsed')
      if (r.reason === 'expired') {
        await answer('telegram.msg.perm.toastExpired')
        if (r.entry) await this.expire(r.entry.permissionId)
        return
      }
      if (r.reason === 'wrong-chat') return
      return answer('telegram.msg.perm.toastExpired')
    }
    const pend = this.pending.get(r.entry.permissionId)
    if (!pend || pend.answering) {
      // Ya no está pendiente: lo contestó la pantalla (o no existe).
      this.buttons.retire(r.entry.permissionId)
      return answer('telegram.msg.perm.toastAnswered')
    }
    // ¿Sigue pendiente en el motor? (mejor esfuerzo: si la lista falla, se intenta responder igual)
    pend.answering = true
    const still = await this.d.engine.pendingIds(pend.req)
    if (still && !still.has(pend.req.id)) {
      pend.answering = false
      await this.finishFromScreen(pend, pend.screenReply)
      return answer('telegram.msg.perm.toastAnswered')
    }
    const reply = r.action === 'a' ? 'once' : 'reject'
    try {
      await this.d.engine.reply(pend.req, reply)
    } catch (err) {
      const notFound = err instanceof EngineReplyError && err.reason === 'not-found'
      pend.answering = false
      // «No encontrado», o falló pero la pantalla ya había contestado (llegó su aviso mientras tanto): ganó la pantalla.
      if (notFound || pend.screenReply !== null) {
        await this.finishFromScreen(pend, pend.screenReply)
        return answer('telegram.msg.perm.toastAnswered')
      }
      this.buttons.release(r.entry.id) // se puede reintentar mientras no caduque
      return answer('telegram.msg.perm.toastFailed', true)
    }
    // Respondido desde Telegram.
    this.pending.delete(pend.req.id)
    this.buttons.retire(pend.req.id, 'telegram')
    this.audit({ kind: 'permission-answered', via: 'telegram', reply, perm: safePerm(pend.req.permission), chat: owner })
    await this.edit(pend, reply === 'once' ? 'telegram.msg.perm.allowed' : 'telegram.msg.perm.rejected')
    await answer(reply === 'once' ? 'telegram.msg.perm.toastDone' : 'telegram.msg.perm.toastRejected')
    this.emit()
  }

  private async edit(pend: PendingPerm, statusKey: Parameters<typeof withStatus>[1]): Promise<void> {
    const owner = this.persisted.ownerChatId
    if (owner === null || pend.messageId === null || !this.api) return
    try {
      await this.api.editMessageText({ chatId: owner, messageId: pend.messageId, text: withStatus(pend.body, statusKey) })
    } catch (err) {
      this.log(`no se pudo editar el mensaje: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  /** La pantalla ganó: se edita el mensaje («ya respondido en el computador») y se quitan los botones. */
  private async finishFromScreen(pend: PendingPerm, reply: 'once' | 'always' | 'reject' | null): Promise<void> {
    this.pending.delete(pend.req.id)
    this.buttons.retire(pend.req.id)
    if (pend.timer) clearTimeout(pend.timer)
    this.audit({
      kind: 'permission-screen',
      via: 'screen',
      perm: safePerm(pend.req.permission),
      ...(reply === 'once' || reply === 'always' ? { reply: 'once' as const } : reply === 'reject' ? { reply: 'reject' as const } : {})
    })
    await this.edit(
      pend,
      reply === 'always'
        ? 'telegram.msg.perm.alwaysScreen'
        : reply === 'reject'
          ? 'telegram.msg.perm.rejectedScreen'
          : reply === 'once'
            ? 'telegram.msg.perm.allowedScreen'
            : 'telegram.msg.perm.gone'
    )
    this.emit()
  }

  private async expire(permissionId: string): Promise<void> {
    const pend = this.pending.get(permissionId)
    this.buttons.retire(permissionId, 'expired')
    if (!pend) return
    this.pending.delete(permissionId)
    this.audit({ kind: 'permission-expired', perm: safePerm(pend.req.permission) })
    await this.edit(pend, 'telegram.msg.perm.expired')
    this.emit()
  }

  // ---------------------------------------------------------------- eventos del motor

  /** Público para las pruebas. */
  async onEngine(ev: EngineEvent): Promise<void> {
    if (this.persisted.ownerChatId === null) return
    switch (ev.kind) {
      case 'connected': {
        for (const req of await this.d.engine.listPending()) this.onPermissionAsked(req)
        return
      }
      case 'session-info':
        this.sessions.set(ev.sessionID, { title: ev.title, parentID: ev.parentID })
        return
      case 'activity': {
        const b = this.busy.get(ev.sessionID)
        if (b) {
          b.last = this.now()
          b.stuckNotified = false
        }
        return
      }
      case 'status': {
        if (ev.status === 'idle') return this.onIdle(ev.sessionID)
        const b = this.busy.get(ev.sessionID)
        if (b) {
          b.last = this.now()
          b.stuckNotified = false
        } else this.busy.set(ev.sessionID, { since: this.now(), last: this.now(), stuckNotified: false })
        return
      }
      case 'permission-asked':
        return this.onPermissionAsked(ev.req)
      case 'permission-replied':
        return this.onPermissionReplied(ev.id, ev.reply)
      case 'question-asked': {
        if (this.questions.has(ev.id)) return
        this.questions.add(ev.id)
        if (!this.notices.take()) return
        await this.sendToOwner(questionMessage(this.titleOf(ev.sessionID), ev.text))
        return
      }
      case 'question-closed':
        this.questions.delete(ev.id)
        return
      case 'error': {
        const key = ev.sessionID ?? '-'
        const last = this.lastErrorNotice.get(key) ?? 0
        if (this.now() - last < 30_000 || !this.notices.take()) return
        this.lastErrorNotice.set(key, this.now())
        await this.sendToOwner(errorMessage(this.titleOf(ev.sessionID), ev.message))
        return
      }
    }
  }

  private titleOf(sessionID: string | null): string {
    return (sessionID ? this.sessions.get(sessionID)?.title : '') || untitled()
  }

  private async onIdle(sessionID: string): Promise<void> {
    const b = this.busy.get(sessionID)
    this.busy.delete(sessionID)
    if (!b) return // ya se trató (llegan `session.status` y `session.idle`) o nunca estuvo trabajando
    if (this.sessions.get(sessionID)?.parentID) return // subagente: avisa la conversación principal
    if (this.now() - b.since < this.L.minBusyForDoneMs) return // respuesta corta: no vale un aviso
    if (!this.notices.take()) return
    await this.sendToOwner(doneMessage(this.titleOf(sessionID)))
  }

  private onPermissionAsked(req: EnginePermission): void {
    if (this.pending.has(req.id) || this.buttons.forPermission(req.id)) return
    const pend: PendingPerm = {
      req,
      title: this.titleOf(req.sessionID),
      messageId: null,
      body: '',
      entryId: null,
      answering: false,
      screenReply: null,
      timer: null
    }
    this.pending.set(req.id, pend)
    // Periodo de gracia: si la pantalla lo contesta enseguida (aprobación automática de solo lectura, o la persona está delante),
    // no se manda nada.
    pend.timer = setTimeout(() => void this.sendPermission(pend), this.L.permissionGraceMs)
    pend.timer.unref?.()
  }

  private async sendPermission(pend: PendingPerm): Promise<void> {
    pend.timer = null
    const owner = this.persisted.ownerChatId
    if (owner === null || !this.api || this.pending.get(pend.req.id) !== pend) return
    const entry = this.buttons.create(pend.req.id, owner)
    const msg = buildPermissionMessage(pend.req, this.titleOf(pend.req.sessionID), entry)
    pend.body = msg.body
    pend.entryId = entry.id
    try {
      const sent = await this.api.sendMessage({ chatId: owner, text: msg.body, markup: msg.markup })
      pend.messageId = sent.message_id
      this.audit({ kind: 'permission-sent', perm: safePerm(pend.req.permission), chat: owner })
      // ¿La pantalla lo contestó mientras se enviaba?
      if (this.pending.get(pend.req.id) !== pend) await this.edit(pend, 'telegram.msg.perm.gone')
      this.emit()
    } catch (err) {
      this.noteSendError(err)
      this.pending.delete(pend.req.id)
      this.buttons.retire(pend.req.id)
    }
  }

  private async onPermissionReplied(id: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    const pend = this.pending.get(id)
    if (!pend) return
    if (pend.answering) {
      pend.screenReply = reply // la respuesta de Telegram está en vuelo; si falla por «no encontrado» se usará esta
      return
    }
    if (pend.messageId === null) {
      // Aún no se había enviado (periodo de gracia): no se manda nada.
      if (pend.timer) clearTimeout(pend.timer)
      this.pending.delete(id)
      this.buttons.retire(id)
      return
    }
    await this.finishFromScreen(pend, reply)
  }

  // ---------------------------------------------------------------- envíos y mantenimiento

  private async sendToOwner(html: string): Promise<number | null> {
    const owner = this.persisted.ownerChatId
    if (owner === null || !this.api) return null
    try {
      const sent = await this.api.sendMessage({ chatId: owner, text: html })
      if (this.error === 'send-failed') this.setError(null)
      return sent.message_id
    } catch (err) {
      this.noteSendError(err)
      return null
    }
  }

  /** Mantenimiento periódico (también lo llaman las pruebas con el reloj inyectado). */
  async tick(): Promise<void> {
    if (this.disposed) return
    // 1) Vinculación sin código vigente: deja de escuchar.
    if (this.persisted.ownerChatId === null && this.polling && !this.code.current()) {
      this.pauseIfUnlinked()
      this.emit()
    }
    // 2) Botones caducados: se edita el mensaje.
    for (const e of this.buttons.expiredOpen()) await this.expire(e.permissionId)
    // 3) Sesiones atascadas.
    if (this.persisted.ownerChatId !== null) {
      const t0 = this.now()
      for (const [sid, b] of this.busy) {
        if (b.stuckNotified || t0 - b.last < this.L.stuckAfterMs) continue
        if ([...this.pending.values()].some((p) => p.req.sessionID === sid) || this.questions.size > 0) continue // espera a la persona, no está atascada
        b.stuckNotified = true
        if (this.notices.take()) await this.sendToOwner(stuckMessage(this.titleOf(sid)))
      }
    }
  }
}

function plainText(key: Parameters<typeof t>[0]): string {
  return t(key)
}

/** Tipo de permiso apto para el registro (solo letras, cifras y `_`). */
function safePerm(p: string): string {
  return /^[A-Za-z0-9_.:-]{1,40}$/.test(p) ? p : 'other'
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
