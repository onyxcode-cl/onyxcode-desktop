/**
 * Servicio del puente con Telegram (entrega 1: avisos y permisos con botones).
 *
 * Reglas que NO se negocian (cada una tiene su prueba en `service.test.ts`):
 *  - UN solo dueño: el chat privado que escribió el código de vinculación. Todo lo demás (otros chats, grupos, canales, bots) se
 *    ignora SIN responder. Los botones solo valen para el dueño, una vez, y caducan.
 *  - El código: 6 dígitos, 10 min, un solo uso, 5 intentos y bloqueo temporal.
 *  - Un texto que llegue por Telegram llega al motor SOLO si la persona activó «Permitir escribir a la sesión desde Telegram» (apagado por
 *    defecto) Y eligió una sesión con /sesiones; nunca concede permisos (siguen exigiendo sus botones) ni cambia modo, carpetas o sesiones.
 *    Comandos que existen: /start, /sesiones, /sesion, /salir, /estado, /desvincular (+ sus nombres en inglés). Ningún otro.
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
import { basename } from 'node:path'
import { ActionBook } from './actions'
import { TelegramApi, TelegramApiError, type TgCallbackQuery, type TgFileRef, type TgMessage, type TgUpdate } from './api'
import { EngineReplyError, agentFor, type EngineEvent, type EngineLink, type EnginePermission, type EngineSessionInfo } from './engine-link'
import {
  checkOutgoingFile,
  prepareIncoming,
  readOutgoingFile,
  type IncomingPart,
  type IncomingRefusal,
  type OutgoingRefusal
} from './files'
import { SessionFollower } from './follow'
import { agoParts, plainFileText } from './format'
import { ButtonBook, LinkCode, MinuteLimiter } from './guards'
import {
  buildPermissionMessage,
  doneMessage,
  errorMessage,
  fill,
  plain,
  questionMessage,
  stuckMessage,
  untitled,
  withStatus
} from './messages'
import { TelegramStore, type AuditInput, type PersistedActiveSession } from './store'
import { redactForTelegram, safeBlock, safeLine, scrubToken, stripControl } from './text'
import { analyzeTurn, baselineSeen } from './turn'

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
  /** Carpetas cuyas sesiones se pueden elegir: la de Chat y los proyectos recientes de Code (nunca Tareas/Overdrive). */
  sessionDirs?: () => { directory: string; kind: 'chat' | 'code' }[]
  /** Modelo que usa la pantalla para ese modo (si la sesión no tiene uno propio). */
  modelFor?: (kind: 'chat' | 'code') => { providerID: string; modelID: string } | undefined
  /** Carpetas desde las que se pueden mandar archivos de esa sesión (nunca otras). */
  fileRoots?: (s: { directory: string; kind: 'chat' | 'code' }) => string[]
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
  private readonly answers: MinuteLimiter
  private readonly writes: MinuteLimiter
  private readonly fileSends: MinuteLimiter
  private readonly actions: ActionBook
  private readonly follower: SessionFollower
  /** Archivos del dueño que esperan al siguiente mensaje de la sesión (ya validados). */
  private pendingAttach: { part: IncomingPart; at: number }[] = []
  private lastSessionCheck = 0
  private lastWriteBlockAudit = 0

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
    this.answers = new MinuteLimiter(this.L.answersPerHour, this.now, 3_600_000)
    this.writes = new MinuteLimiter(this.L.writesPerMinute, this.now)
    this.fileSends = new MinuteLimiter(this.L.fileSendsPerMinute, this.now)
    this.actions = new ActionBook(this.now)
    this.follower = new SessionFollower({
      engine: d.engine,
      api: () => this.api,
      owner: () => this.persisted.ownerChatId,
      now: this.now,
      limits: this.L,
      summariesOnly: () => this.persisted.summariesOnly,
      fileRoots: (a) => this.rootsOf(a),
      actions: this.actions,
      saveSeen: (userId) => {
        const a = this.persisted.active
        if (a) this.d.store.save({ active: { ...a, seenUpTo: userId } })
      },
      onSendError: (err) => this.noteSendError(err),
      audit: () => undefined,
      log: (m) => this.log(m)
    })
  }

  private rootsOf(s: { directory: string; kind: 'chat' | 'code' }): string[] {
    return this.d.fileRoots ? this.d.fileRoots(s) : [s.directory]
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
      pendingPermissions: this.countPending(),
      allowWrite: p.allowWrite,
      summariesOnly: p.summariesOnly,
      activeSession:
        p.active && p.ownerChatId !== null
          ? {
              title: stripControl(p.active.title).slice(0, 120),
              kind: p.active.kind,
              folder: p.active.kind === 'code' ? basename(p.active.directory) : null
            }
          : null
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
      const a = this.persisted.active
      if (a && !this.follower.session) void this.resumeActive(a)
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
    this.follower.detach()
    this.actions.clear()
    this.pendingAttach = []
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
    this.d.store.save({
      enabled: false,
      botId: null,
      botUsername: null,
      offset: 0,
      ownerChatId: null,
      ownerLabel: null,
      allowWrite: false,
      active: null
    })
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

  /** Interruptor «Permitir escribir a la sesión desde Telegram». Apagarlo descarta también los archivos que esperaban. */
  setAllowWrite(on: boolean): TelegramState {
    if (this.persisted.allowWrite === on) return this.getState()
    this.d.store.save({ allowWrite: on })
    if (!on) this.pendingAttach = []
    this.audit({ kind: 'write-toggled', on })
    this.emit()
    return this.getState()
  }

  /** Interruptor «Solo resúmenes». */
  setSummariesOnly(on: boolean): TelegramState {
    if (this.persisted.summariesOnly === on) return this.getState()
    this.d.store.save({ summariesOnly: on })
    this.audit({ kind: 'summaries-toggled', on })
    this.emit()
    return this.getState()
  }

  /** «Dejar de seguirla» desde la ventana. */
  releaseSession(): TelegramState {
    const a = this.persisted.active
    if (a) this.dropActive('app')
    this.emit()
    return this.getState()
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
    // Soltar el chat también apaga «escribir» y suelta la sesión: un vínculo nuevo empieza siempre en solo lectura.
    this.follower.detach()
    this.pendingAttach = []
    this.d.store.save({ ownerChatId: null, ownerLabel: null, allowWrite: false, active: null })
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
    const raw = typeof m.text === 'string' ? m.text.slice(0, 4096) : ''
    const text = raw.slice(0, 500)
    if (owner !== null) {
      if (m.chat.id !== owner) return this.noteForeign('other-chat', m.chat.id) // otro chat: sin respuesta
      if (m.document || m.photo || m.voice || m.audio || m.video) return this.onOwnerMedia(owner, m)
      return this.onOwnerText(owner, raw, m)
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

  private async onOwnerText(owner: number, text: string, m: TgMessage): Promise<void> {
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
    if (cmd === 'sesiones' || cmd === 'sessions') return this.cmdSessions(owner)
    if (cmd === 'sesion' || cmd === 'session') return this.cmdCurrent(owner)
    if (cmd === 'salir' || cmd === 'leave') {
      if (!this.persisted.active) return void (await this.reply(owner, plain('telegram.msg.noCurrent')))
      this.dropActive('command')
      this.emit()
      return void (await this.reply(owner, plain('telegram.msg.left')))
    }
    // Cualquier otro «/algo» NO existe (no hay comando para crear sesiones, cambiar el modo o las carpetas): no se manda a la IA.
    if (cmd !== null) return void (await this.reply(owner, plain('telegram.msg.unknownCmd')))
    // Texto libre: solo llega a la sesión elegida y solo con «Permitir escribir» encendido.
    await this.writeToSession(owner, text, m.message_id)
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
    if (ActionBook.isAction(cb.data)) return this.onAction(cb, owner)
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
    // Tope de «Permitir» por hora (rechazar siempre se puede): pasado el tope, se responde en el computador.
    if (r.action === 'a' && !this.answers.take()) {
      this.buttons.release(r.entry.id)
      return answer('telegram.msg.perm.toastLimit', true)
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
    this.follower.onEngine(ev)
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
    if (!b) return
    // La sesión que se sigue ya manda su respuesta final: no se repite con el aviso de «Terminó».
    if (this.persisted.active?.id === sessionID) return // ya se trató (llegan `session.status` y `session.idle`) o nunca estuvo trabajando
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

  // ---------------------------------------------------------------- sesiones (entrega 2)

  private modeLabel(mode: EngineSessionInfo['mode']): string {
    return mode === 'unknown' ? t('telegram.msg.sessions.noMode') : t(`code.mode.${mode}` as 'code.mode.manual')
  }

  private kindLabel(s: { kind: 'chat' | 'code'; directory: string }): string {
    return s.kind === 'chat'
      ? t('telegram.msg.sessions.kindChat')
      : t('telegram.msg.sessions.kindCode', { folder: stripControl(basename(s.directory)) })
  }

  /** Modos en los que la IA actúa sin preguntar (o casi): se avisa al elegir la sesión. */
  private static readonly RISKY = new Set<string>(['bypass', 'auto', 'acceptEdits'])

  private async cmdSessions(owner: number): Promise<void> {
    const dirs = this.d.sessionDirs?.() ?? []
    const list = (await this.d.engine.listSessions(dirs, this.L.sessionsListed)).slice(0, this.L.sessionsListed)
    if (list.length === 0) return void (await this.reply(owner, plain('telegram.msg.sessions.none')))
    const t0 = this.now()
    const lines: string[] = [`<b>${plain('telegram.msg.sessions.title')}</b>`, '']
    const rows: { text: string; callback_data: string }[][] = []
    list.forEach((s, i) => {
      const entry = this.actions.create('s', owner, { id: s.id, directory: s.directory, kind: s.kind }, 10 * 60_000)
      const ago = agoParts(t0, s.updatedAt)
      const when = ago.unit === 'now' ? t('telegram.ago.now') : t(`telegram.ago.${ago.unit}` as 'telegram.ago.min', { n: ago.n })
      const kind = s.kind === 'chat' ? this.kindLabel(s) : `${this.kindLabel(s)} · ${this.modeLabel(s.mode)}`
      lines.push(
        fill('telegram.msg.sessions.line', {
          n: String(i + 1),
          title: `<b>${safeLine(s.title || untitled(), 60)}</b>`,
          kind: safeLine(kind, 90),
          state: escapeHtmlText(t(s.busy ? 'telegram.msg.sessions.busy' : 'telegram.msg.sessions.idle')),
          ago: escapeHtmlText(when)
        })
      )
      const label = `${i + 1}. ${stripControl(redactForTelegram(s.title || t('telegram.msg.untitled')))
        .replace(/\s+/g, ' ')
        .slice(0, 34)}`
      rows.push([{ text: label, callback_data: ActionBook.data(entry) }])
    })
    try {
      await this.api?.sendMessage({ chatId: owner, text: lines.join('\n'), markup: { inline_keyboard: rows } })
    } catch (err) {
      this.noteSendError(err)
    }
  }

  private async cmdCurrent(owner: number): Promise<void> {
    const a = this.persisted.active
    if (!a) return void (await this.reply(owner, plain('telegram.msg.noCurrent')))
    const text = fill('telegram.msg.current', {
      title: `<b>${safeLine(a.title || untitled(), 100)}</b>`,
      kind: safeLine(this.kindLabel(a), 90)
    })
    await this.reply(
      owner,
      `${text}\n${plain(this.persisted.allowWrite ? 'telegram.msg.chosen.canWrite' : 'telegram.msg.chosen.readOnly')}`
    )
  }

  /** Suelta la sesión elegida (comando, ventana o porque dejó de existir). */
  private dropActive(why: 'command' | 'app' | 'lost'): void {
    const a = this.persisted.active
    if (!a) return
    this.audit({ kind: why === 'lost' ? 'session-lost' : 'session-released', why, sess: a.id, mode: a.kind })
    this.follower.detach()
    this.pendingAttach = []
    this.d.store.save({ active: null })
  }

  private async lostSession(): Promise<void> {
    const owner = this.persisted.ownerChatId
    this.dropActive('lost')
    this.emit()
    if (owner !== null) await this.reply(owner, plain('telegram.msg.lost'))
  }

  /** Al arrancar con un vínculo y una sesión guardada: comprueba que existe y retoma sin repetir lo ya contado. */
  private async resumeActive(a: PersistedActiveSession): Promise<void> {
    const r = await this.d.engine.getSession(a.directory, a.id, a.kind)
    if (this.persisted.active?.id !== a.id) return
    if (r === null) return this.lostSession()
    if (r === 'error') {
      this.follower.attach(a) // el motor aún no responde: se retoma con lo guardado
      this.follower.poke(true)
      return
    }
    const msgs = await this.d.engine.messages(a.directory, a.id)
    const next: PersistedActiveSession = { ...a, title: r.title || a.title, seenUpTo: msgs ? baselineSeen(msgs, r.busy) : a.seenUpTo }
    this.d.store.save({ active: next })
    this.follower.attach(next)
    this.follower.poke(true)
  }

  /** Cada cierto tiempo: ¿sigue existiendo la sesión elegida?, ¿cambió su modo de permisos?, ¿quedó un turno sin contar? */
  private async checkActive(): Promise<void> {
    const a = this.persisted.active
    const owner = this.persisted.ownerChatId
    if (!a || owner === null || !this.follower.session) return
    if (this.now() - this.lastSessionCheck < this.L.sessionCheckMs) return
    this.lastSessionCheck = this.now()
    const r = await this.d.engine.getSession(a.directory, a.id, a.kind)
    if (this.persisted.active?.id !== a.id) return
    if (r === 'error') return
    if (r === null) return this.lostSession()
    const before = this.sessionMode
    this.sessionMode = r.mode
    if (before !== null && before !== r.mode && a.kind === 'code') {
      await this.reply(owner, fill('telegram.msg.modeChanged', { mode: safeLine(this.modeLabel(r.mode), 60) }) + this.riskLine(r))
    }
    if (r.title && r.title !== a.title) this.d.store.save({ active: { ...a, title: r.title.slice(0, 200) } })
    this.follower.tick(r.busy)
  }

  private sessionMode: EngineSessionInfo['mode'] | null = null

  private riskLine(info: Pick<EngineSessionInfo, 'kind' | 'mode'>): string {
    if (info.kind !== 'code') return ''
    if (info.mode === 'unknown') return `\n${plain('telegram.msg.chosen.unknownMode')}`
    if (TelegramService.RISKY.has(info.mode))
      return `\n${fill('telegram.msg.chosen.riskMode', { mode: safeLine(this.modeLabel(info.mode), 60) })}`
    return ''
  }

  /** El dueño tocó una conversación de la lista de /sesiones. */
  private async chooseSession(
    cb: TgCallbackQuery,
    owner: number,
    pick: { id: string; directory: string; kind: 'chat' | 'code' }
  ): Promise<void> {
    const info = await this.d.engine.getSession(pick.directory, pick.id, pick.kind)
    if (info === null || info === 'error') {
      await this.toast(cb, info === null ? 'telegram.msg.btnGone' : 'telegram.msg.sendFailed')
      return
    }
    const msgs = await this.d.engine.messages(info.directory, info.id)
    const a: PersistedActiveSession = {
      id: info.id,
      directory: info.directory,
      kind: info.kind,
      title: info.title.slice(0, 200),
      seenUpTo: msgs ? baselineSeen(msgs, info.busy) : ''
    }
    this.follower.detach()
    this.pendingAttach = []
    this.sessionMode = info.mode
    this.lastSessionCheck = this.now()
    this.d.store.save({ active: a })
    this.follower.attach(a)
    this.audit({ kind: 'session-chosen', sess: info.id, mode: info.kind, chat: owner })
    await this.toast(cb, 'telegram.msg.perm.toastDone')
    const out: string[] = [
      fill('telegram.msg.chosen', { title: `<b>${safeLine(info.title || untitled(), 100)}</b>` }),
      `<i>${safeLine(info.kind === 'chat' ? this.kindLabel(info) : `${this.kindLabel(info)} · ${this.modeLabel(info.mode)}`, 120)}</i>`
    ]
    const turn = msgs ? analyzeTurn(msgs, this.now(), info.kind === 'code' ? info.directory : null) : null
    if (!turn?.userId) out.push('', plain('telegram.msg.chosen.empty'))
    else {
      out.push('')
      if (turn.userText) out.push(fill('telegram.msg.chosen.lastUser', { text: `<i>${safeLine(turn.userText, 300)}</i>` }))
      if (info.busy) out.push(plain('telegram.msg.chosen.working'))
      else if (turn.finalText) {
        out.push(fill('telegram.msg.chosen.lastAnswer', { text: `\n${safeBlock(turn.finalText, { max: 700, budget: 1400 })}` }))
      }
    }
    out.push('', plain(this.persisted.allowWrite ? 'telegram.msg.chosen.canWrite' : 'telegram.msg.chosen.readOnly'))
    const risk = this.riskLine(info).trim()
    if (risk) out.push(risk)
    await this.reply(owner, out.join('\n').slice(0, 4000))
    this.emit()
    this.follower.poke(true)
  }

  // ---------------------------------------------------------------- escribir a la sesión

  /** Texto del dueño hacia la sesión elegida. Todas las reglas de seguridad pasan por aquí. */
  private async writeToSession(owner: number, rawText: string, messageId: number, preAttached: IncomingPart[] = []): Promise<void> {
    const a = this.persisted.active
    if (!a) return void (await this.reply(owner, plain('telegram.msg.ownerText')))
    if (!this.persisted.allowWrite) {
      if (this.now() - this.lastWriteBlockAudit > 60_000) {
        this.lastWriteBlockAudit = this.now()
        this.audit({ kind: 'message-blocked', why: 'write-off', sess: a.id, mode: a.kind })
      }
      return void (await this.reply(owner, plain('telegram.msg.readOnly')))
    }
    const text = stripControl(rawText).trim()
    this.pruneAttach()
    const files = [...this.pendingAttach.map((x) => x.part), ...preAttached]
    if (!text && files.length === 0) return
    if (!this.writes.take()) return void (await this.reply(owner, plain('telegram.msg.rate')))
    // Una repetición del mismo mensaje de Telegram (reinicio a mitad de atenderlo) no se envía dos veces.
    if (messageId <= this.persisted.lastWriteId) return
    const info = await this.d.engine.getSession(a.directory, a.id, a.kind)
    if (info === null) return this.lostSession()
    if (info === 'error') return void (await this.reply(owner, plain('telegram.msg.sendFailed')))
    // Si la persona escribe en el computador a la vez, no se mezclan: mientras trabaja, no se le suma otro mensaje.
    if (info.busy) return void (await this.reply(owner, plain('telegram.msg.busy')))
    const msgs = await this.d.engine.messages(a.directory, a.id)
    const lastUser = msgs ? [...msgs].reverse().find((m) => m.role === 'user') : undefined
    const model = lastUser?.model ?? this.d.modelFor?.(a.kind)
    this.d.store.save({ lastWriteId: messageId })
    this.audit({ kind: 'message-sent', sess: a.id, mode: a.kind, bytes: Buffer.byteLength(text, 'utf8'), chat: owner })
    try {
      await this.d.engine.prompt(a.directory, a.id, {
        agent: agentFor(a.kind, lastUser?.agent ?? info.agent),
        ...(model ? { model } : {}),
        text,
        files: files.map((f) => ({ mime: f.mime, filename: f.filename, url: f.url }))
      })
    } catch (err) {
      this.log(`no se pudo enviar a la sesión: ${err instanceof Error ? err.message : 'error'}`)
      return void (await this.reply(
        owner,
        plain(err instanceof EngineReplyError && err.reason === 'not-found' ? 'telegram.msg.lost' : 'telegram.msg.sendFailed')
      ))
    }
    this.pendingAttach = []
    this.follower.poke(true)
    await this.reply(owner, plain('telegram.msg.sent'))
  }

  private pruneAttach(): void {
    const t0 = this.now()
    this.pendingAttach = this.pendingAttach.filter((x) => t0 - x.at < this.L.pendingAttachTtlMs)
  }

  // ---------------------------------------------------------------- archivos del dueño

  private async onOwnerMedia(owner: number, m: TgMessage): Promise<void> {
    const a = this.persisted.active
    if (m.voice || m.audio) return void (await this.reply(owner, plain('telegram.msg.voice.pending')))
    if (m.video) return void (await this.reply(owner, plain('telegram.msg.in.refused.type')))
    if (!a) return void (await this.reply(owner, plain('telegram.msg.in.needSession')))
    if (!this.persisted.allowWrite) return void (await this.reply(owner, plain('telegram.msg.in.needWrite')))
    this.pruneAttach()
    if (this.pendingAttach.length >= this.L.maxPendingAttach) return void (await this.reply(owner, plain('telegram.msg.in.full')))
    let ref: TgFileRef | undefined
    let name = 'archivo'
    let mime = ''
    if (m.document) {
      ref = m.document
      name = m.document.file_name || 'archivo'
      mime = m.document.mime_type || ''
    } else if (m.photo?.length) {
      // La foto más grande que quepa en el tope.
      const ok = m.photo.filter((p) => !p.file_size || p.file_size <= this.L.maxIncomingFileBytes)
      ref = ok[ok.length - 1] ?? m.photo[m.photo.length - 1]
      name = 'foto.jpg'
      mime = 'image/jpeg'
    }
    if (!ref?.file_id || !this.api) return
    const refuse = async (why: IncomingRefusal): Promise<void> => {
      this.audit({ kind: 'file-refused', why: `in-${why}`, sess: a.id, mode: a.kind })
      await this.reply(owner, plain(`telegram.msg.in.refused.${why}` as 'telegram.msg.in.refused.type'))
    }
    if (typeof ref.file_size === 'number' && ref.file_size > this.L.maxIncomingFileBytes) return refuse('size')
    let bytes: Uint8Array
    try {
      bytes = await this.api.downloadFile(ref.file_id, this.L.maxIncomingFileBytes)
    } catch (err) {
      if (err instanceof TelegramApiError && err.status === 413) return refuse('size')
      this.noteSendError(err)
      return void (await this.reply(owner, plain('telegram.msg.in.failed')))
    }
    const r = await prepareIncoming({ name, mime, bytes })
    if (!r.ok) return refuse(r.reason)
    this.audit({
      kind: 'file-received',
      sess: a.id,
      mode: a.kind,
      bytes: bytes.length,
      ext: /\.([A-Za-z0-9]{1,8})$/.exec(r.part.filename)?.[1] ?? undefined
    })
    const caption = typeof m.caption === 'string' ? m.caption.trim() : ''
    if (caption) {
      // Con pie de foto/archivo, el pie es el mensaje: se envía ya, con este archivo y los que esperaban.
      await this.writeToSession(owner, caption, m.message_id, [r.part])
      return
    }
    this.pendingAttach.push({ part: r.part, at: this.now() })
    await this.reply(owner, fill('telegram.msg.in.stored', { name: safeLine(r.part.filename, 80) }))
  }

  // ---------------------------------------------------------------- botones de sesiones, «Ver todo» y archivos

  private async toast(cb: TgCallbackQuery, key: Parameters<typeof plainText>[0], alert = false): Promise<void> {
    try {
      await this.api?.answerCallbackQuery({ id: cb.id, text: plainText(key), alert })
    } catch (err) {
      this.noteSendError(err)
    }
  }

  private async onAction(cb: TgCallbackQuery, owner: number): Promise<void> {
    const r = this.actions.take<Record<string, unknown>>(cb.data, owner)
    if (!r.ok) {
      if (r.reason === 'wrong-chat') return
      return this.toast(cb, 'telegram.msg.btnExpired')
    }
    const e = r.entry
    if (e.kind === 's') {
      const p = e.payload as { id: string; directory: string; kind: 'chat' | 'code' }
      return this.chooseSession(cb, owner, p)
    }
    if (!this.fileSends.take()) return this.toast(cb, 'telegram.msg.rate', true)
    if (this.persisted.summariesOnly) return this.toast(cb, 'telegram.msg.file.summaries', true)
    const a = this.persisted.active
    if (!this.api) return
    if (e.kind === 'o') {
      const p = e.payload as { name: string; text: string }
      await this.toast(cb, 'telegram.msg.perm.toastDone')
      const data = new TextEncoder().encode(plainFileText(p.text))
      if (data.length > this.L.maxSendFileBytes) return
      try {
        await this.api.sendDocument({
          chatId: owner,
          filename: p.name.replace(/[^A-Za-z0-9._-]/g, '_') || 'salida.txt',
          data,
          caption: plain('telegram.live.fullCaption')
        })
        this.audit({ kind: 'file-sent', sess: a?.id, mode: a?.kind, bytes: data.length, ext: 'txt', why: 'output' })
      } catch (err) {
        this.noteSendError(err)
      }
      return
    }
    // 'f': archivo creado por la IA. Se vuelve a validar AHORA, con las carpetas de la sesión elegida ahora.
    const p = e.payload as { path: string; sessionId: string }
    if (!a || a.id !== p.sessionId) return this.toast(cb, 'telegram.msg.file.wrongSession', true)
    const check = checkOutgoingFile(this.rootsOf(a), p.path, this.L.maxSendFileBytes)
    if (!check.ok) {
      this.audit({ kind: 'file-refused', why: `out-${check.reason}`, sess: a.id, mode: a.kind })
      await this.toast(cb, 'telegram.msg.perm.toastDone')
      return void (await this.reply(owner, plain(refusalKey(check.reason))))
    }
    const data = readOutgoingFile(check, this.L.maxSendFileBytes)
    if (!data) return this.toast(cb, 'telegram.msg.file.failed', true)
    await this.toast(cb, 'telegram.msg.perm.toastDone')
    try {
      await this.api.sendDocument({ chatId: owner, filename: check.name, data })
      this.audit({ kind: 'file-sent', sess: a.id, mode: a.kind, bytes: check.bytes, ext: check.ext || undefined, why: 'created' })
    } catch (err) {
      this.noteSendError(err)
      await this.reply(owner, plain('telegram.msg.file.failed'))
    }
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
    // 2b) La sesión elegida: ¿sigue existiendo? ¿cambió de modo? ¿quedó algo sin contar?
    await this.checkActive()
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

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function refusalKey(r: OutgoingRefusal): Parameters<typeof t>[0] {
  switch (r) {
    case 'outside':
      return 'telegram.msg.file.refused.outside'
    case 'secret':
      return 'telegram.msg.file.refused.secret'
    case 'blocked':
      return 'telegram.msg.file.refused.blocked'
    case 'too-big':
      return 'telegram.msg.file.refused.tooBig'
    case 'missing':
      return 'telegram.msg.file.refused.missing'
    case 'hidden-dir':
      return 'telegram.msg.file.refused.hidden'
    default:
      return 'telegram.msg.file.refused.invalid'
  }
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
