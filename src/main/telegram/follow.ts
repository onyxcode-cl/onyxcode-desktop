/**
 * Seguimiento de UNA sesión desde el chat dueño (entrega 2): un mensaje de avance que se va EDITANDO con una línea por paso y, al
 * terminar, la respuesta final en mensajes nuevos.
 *
 * Cómo funciona (decisión de diseño, ver `docs/telegram.md` §9):
 *  - Los eventos del motor solo AVISAN de que algo cambió en la sesión elegida (`poke`). La verdad se lee del motor
 *    (`engine.messages`), así que un evento perdido, repetido o fuera de orden no deja el mensaje mal ni duplica nada.
 *  - Un turno se identifica por el id del último mensaje de la persona (`userId`). `seenUpTo` es el último turno ya contado: se guarda en
 *    disco, de modo que al reiniciar no se repite una respuesta ni se manda una vieja.
 *  - Si la persona escribe en el computador mientras tanto, es simplemente otro turno (otro `userId`): el avance anterior se cierra y el
 *    nuevo empieza en un mensaje aparte. Nada se mezcla ni se duplica porque cada turno tiene su propio mensaje y su propio cierre.
 *  - Las ediciones van separadas al menos `liveEditGapMs` (3 s) y, además, `TelegramApi` espera `retry_after` ante un 429.
 *  - Todo texto que sale pasa por tapar → recortar → escapar (`text.ts`, `format.ts`).
 */
import { t, type MsgKey } from '@shared/i18n'
import { TELEGRAM_LIMITS } from '@shared/telegram'
import { ActionBook } from './actions'
import { TelegramApi, TelegramApiError, type ReplyMarkup } from './api'
import type { EngineEvent, EngineLink, EngineMessage } from './engine-link'
import { checkOutgoingFile } from './files'
import { chunkAnswer, plainFileText, previewBlock } from './format'
import { escapeHtml, safeLine, stripControl, redactForTelegram } from './text'
import { analyzeTurn, type TurnView } from './turn'
import type { PersistedActiveSession } from './store'

export interface FollowDeps {
  engine: EngineLink
  api: () => TelegramApi | null
  owner: () => number | null
  now: () => number
  limits: {
    liveEditGapMs: number
    chunkMax: number
    maxChunks: number
    liveLines: number
    outputPreviewMax: number
    maxFileButtons: number
  }
  summariesOnly: () => boolean
  /** Carpetas desde las que se pueden mandar archivos de esa sesión (nunca otras). */
  fileRoots: (s: PersistedActiveSession) => string[]
  actions: ActionBook
  /** Guarda en disco hasta qué turno ya se contó. */
  saveSeen: (userId: string) => void
  onSendError: (err: unknown) => void
  audit: (kind: 'file-sent', s: PersistedActiveSession, extra?: { bytes?: number; ext?: string }) => void
  log: (msg: string) => void
  /** Espera inyectable (pruebas). */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
}

interface Live {
  turn: string
  messageId: number
  lastHtml: string
  lastEditAt: number
}

const OMITTED = (n: number): string => t('telegram.msg.perm.omitted', { count: n })
const TTL_ACTION_MS = 60 * 60_000

export class SessionFollower {
  private active: PersistedActiveSession | null = null
  private live: Live | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private again = false
  private sawIdle = false
  private finalRetries = 0
  /** Turno al que se le está creando el mensaje de avance (evita crear dos a la vez). */
  private creating = false
  private lastView: TurnView | null = null
  private lastRefreshAt = 0

  constructor(private readonly d: FollowDeps) {}

  get session(): PersistedActiveSession | null {
    return this.active
  }

  /** Empieza a seguir `s`; `seenUpTo` ya viene fijado por quien llama (el turno de base). */
  attach(s: PersistedActiveSession): void {
    this.detach()
    this.active = { ...s }
    this.sawIdle = false
    this.finalRetries = 0
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.active = null
    this.live = null
    this.running = false
    this.again = false
    this.lastView = null
    this.d.actions.clearKind('o')
    this.d.actions.clearKind('f')
  }

  get isLive(): boolean {
    return this.live !== null
  }

  /** Evento del motor: solo lo que toca a la sesión seguida. */
  onEngine(ev: EngineEvent): void {
    const s = this.active
    if (!s) return
    if (ev.kind === 'connected') return this.poke(true)
    if (!('sessionID' in ev) || ev.sessionID !== s.id) return
    if (ev.kind === 'status') {
      if (ev.status === 'idle') {
        this.sawIdle = true
        this.finalRetries = 0
        return this.poke(true)
      }
      this.sawIdle = false
    }
    if (ev.kind === 'activity' || ev.kind === 'status' || ev.kind === 'error') this.poke(false)
  }

  /**
   * Pide una lectura pronto. Las lecturas normales van separadas al menos `liveEditGapMs` (un aluvión de eventos de texto no
   * multiplica las lecturas); el cierre de un turno (`urgent`) no espera.
   */
  poke(urgent: boolean, extraDelayMs = 0): void {
    if (!this.active) return
    const now = Date.now()
    const base = urgent ? 0 : Math.max(0, this.lastRefreshAt + this.d.limits.liveEditGapMs - now)
    const delay = Math.max(base, extraDelayMs)
    if (this.timer) {
      if (!urgent) return
      clearTimeout(this.timer)
      this.timer = null
    }
    const set = this.d.setTimer ?? setTimeout
    this.timer = set(() => {
      this.timer = null
      void this.refresh()
    }, delay)
    this.timer.unref?.()
  }

  /** Mantenimiento: si la sesión sigue trabajando (o no se vio terminar), la relee. */
  tick(busyNow: boolean | null): void {
    const s = this.active
    if (!s) return
    if (this.live || busyNow === true) return this.poke(false)
    // El motor dice que no trabaja y hay un turno sin contar (se perdió el aviso de que terminó): ciérralo.
    if (busyNow === false && (!this.lastView || this.lastView.userId !== s.seenUpTo)) {
      this.sawIdle = true
      this.poke(true)
    }
  }

  /** Lee la sesión y actualiza el mensaje de avance o cierra el turno. Una sola lectura a la vez. */
  async refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    this.lastRefreshAt = Date.now()
    try {
      do {
        this.again = false
        await this.once()
      } while (this.again && this.active)
    } catch (err) {
      this.d.log(`seguimiento: ${err instanceof Error ? err.message : 'error'}`)
    } finally {
      this.running = false
    }
  }

  private async once(): Promise<void> {
    const s = this.active
    const owner = this.d.owner()
    const api = this.d.api()
    if (!s || owner === null || !api) return
    const msgs = await this.d.engine.messages(s.directory, s.id)
    if (!msgs || this.active?.id !== s.id) return
    const root = s.kind === 'code' ? s.directory : null
    let view = analyzeTurn(msgs, this.d.now(), root)
    this.lastView = view
    if (!view.userId || view.userId === this.active.seenUpTo) return
    // ¿Otro turno distinto del que tenía el mensaje de avance? (escribieron en el computador): se cierra el anterior.
    if (this.live && this.live.turn !== view.userId) {
      await this.closeLive(api, owner, null)
      this.live = null
    }
    const finished = this.sawIdle && view.assistantDone
    if (this.sawIdle && !view.assistantDone) {
      // El motor dijo que terminó pero el último mensaje aún no figura completo: se reintenta un par de veces.
      if (this.finalRetries < 4) {
        this.finalRetries++
        this.poke(false, 1500)
        return
      }
    }
    const forced = this.sawIdle && this.finalRetries >= 4 && !view.running
    if (finished || forced) {
      view = analyzeTurn(msgs, this.d.now(), root, { files: true })
      return this.finish(s, view, api, owner)
    }
    if (view.steps.length > 0) await this.updateLive(s, view, api, owner, false)
  }

  // ---------------------------------------------------------------- mensaje de avance

  private liveHtml(view: TurnView, final: boolean): { html: string; markup?: ReplyMarkup } {
    const lines = view.steps
    const max = this.d.limits.liveLines
    const shown = lines.slice(-max)
    const hidden = lines.length - shown.length
    const head = `<b>${safeLine(final ? view.titleDone : view.title || t('telegram.live.working'), 120)}</b>`
    const body: string[] = []
    if (hidden > 0) body.push(escapeHtml(t('telegram.live.hidden', { count: hidden })))
    for (const st of shown) body.push(`• ${safeLine(st.line, 140)}${st.failed ? ` (${escapeHtml(t('telegram.live.failed'))})` : ''}`)
    let html = [head, ...body].join('\n')
    let markup: ReplyMarkup | undefined
    if (!this.d.summariesOnly()) {
      // Salida del último paso que la tiene (recortada con inicio y final) y «Ver todo» para los más recientes.
      const withOutput = lines.filter((x) => x.full.trim().length > 0)
      const latest = withOutput[withOutput.length - 1]
      if (latest) {
        const room = Math.max(120, TELEGRAM_LIMITS.messageMax - 400 - html.length)
        const pv = previewBlock(latest.full, Math.min(this.d.limits.outputPreviewMax, room), OMITTED)
        // `previewBlock` escapa; el tope se mide ya escapado.
        const block = pv.html.length > room ? pv.html.slice(0, room) : pv.html
        const safe = block.replace(/&[a-z#0-9]*$/i, '')
        html += `\n<pre>${safe}</pre>`
      }
      const rows: { text: string; callback_data: string }[][] = []
      for (const st of withOutput.slice(-3)) {
        if (st.full.length <= this.d.limits.outputPreviewMax) continue
        const owner = this.d.owner()
        if (owner === null) break
        const entry = this.d.actions.create(
          'o',
          owner,
          { name: `${st.tool || 'salida'}-${st.id.slice(-6)}.txt`, text: st.full },
          TTL_ACTION_MS
        )
        const label = `${t('telegram.live.seeAll')}: ${stripControl(redactForTelegram(st.line)).replace(/\s+/g, ' ').slice(0, 30)}`
        rows.push([{ text: label, callback_data: ActionBook.data(entry) }])
      }
      if (rows.length) markup = { inline_keyboard: rows }
    }
    return { html: html.slice(0, TELEGRAM_LIMITS.messageMax), markup }
  }

  private async updateLive(s: PersistedActiveSession, view: TurnView, api: TelegramApi, owner: number, final: boolean): Promise<void> {
    if (this.creating) return
    const { html, markup } = this.liveHtml(view, final)
    const now = Date.now()
    if (!this.live) {
      this.creating = true
      try {
        const sent = await api.sendMessage({ chatId: owner, text: html, markup })
        this.live = { turn: view.userId as string, messageId: sent.message_id, lastHtml: html, lastEditAt: Date.now() }
      } catch (err) {
        this.d.onSendError(err)
      } finally {
        this.creating = false
      }
      return
    }
    if (html === this.live.lastHtml) return
    if (!final && now - this.live.lastEditAt < this.d.limits.liveEditGapMs) {
      this.poke(false, this.d.limits.liveEditGapMs - (now - this.live.lastEditAt))
      return
    }
    await this.editLive(api, owner, html, markup)
    void s
  }

  private async editLive(api: TelegramApi, owner: number, html: string, markup?: ReplyMarkup): Promise<void> {
    const live = this.live
    if (!live) return
    try {
      await api.editMessageText({ chatId: owner, messageId: live.messageId, text: html, markup })
      live.lastHtml = html
      live.lastEditAt = Date.now()
    } catch (err) {
      live.lastEditAt = Date.now()
      if (err instanceof TelegramApiError && err.kind === 'bad-request') {
        if (/not modified/i.test(err.message)) {
          live.lastHtml = html
          return
        }
        if (/not found|can't be edited/i.test(err.message)) {
          this.live = null // la persona borró el mensaje: el siguiente avance crea uno nuevo
          return
        }
      }
      this.d.onSendError(err)
    }
  }

  /** Cierra el mensaje de avance de un turno que ya no se sigue (otro turno lo reemplazó). */
  private async closeLive(api: TelegramApi, owner: number, view: TurnView | null): Promise<void> {
    const live = this.live
    if (!live) return
    const text = view ? this.liveHtml(view, true).html : live.lastHtml
    try {
      await api.editMessageText({ chatId: owner, messageId: live.messageId, text })
    } catch (err) {
      if (!(err instanceof TelegramApiError && err.kind === 'bad-request')) this.d.onSendError(err)
    }
  }

  // ---------------------------------------------------------------- cierre del turno

  private async finish(s: PersistedActiveSession, view: TurnView, api: TelegramApi, owner: number): Promise<void> {
    const userId = view.userId as string
    // Se marca primero: aunque algo falle a mitad, no se manda dos veces.
    this.active = { ...s, seenUpTo: userId }
    this.d.saveSeen(userId)
    this.sawIdle = false
    this.finalRetries = 0
    if (view.steps.length > 0) {
      if (!this.live) await this.updateLive(s, view, api, owner, true)
      else {
        const { html, markup } = this.liveHtml(view, true)
        if (html !== this.live.lastHtml) {
          const wait = this.d.limits.liveEditGapMs - (Date.now() - this.live.lastEditAt)
          if (wait > 0) await new Promise<void>((r) => (this.d.setTimer ?? setTimeout)(r, wait))
          await this.editLive(api, owner, html, markup)
        }
      }
    }
    this.live = null
    await this.sendFinal(s, view, api, owner)
  }

  private async sendFinal(s: PersistedActiveSession, view: TurnView, api: TelegramApi, owner: number): Promise<void> {
    const files = this.fileButtons(s, view, owner)
    const L = this.d.limits
    let text = view.finalText
    if (!text && view.error) text = t('telegram.live.errorLine', { detail: view.error })
    if (!text) {
      if (files.length) await this.safeSend(api, owner, escapeHtml(t('telegram.live.filesMade')), files)
      return
    }
    const chunks = chunkAnswer(text, L.chunkMax)
    if (chunks.length === 0) return
    if (chunks.length > L.maxChunks) {
      // Larguísima: un archivo con todo y un resumen corto al principio.
      const head = chunkAnswer(text.slice(0, 900) + '…', L.chunkMax)[0] ?? ''
      const data = new TextEncoder().encode(plainFileText(text))
      try {
        await api.sendDocument({
          chatId: owner,
          filename: 'respuesta.md',
          data,
          caption: `${head.slice(0, 700).replace(/<[^>]*$/, '')}\n\n<i>${escapeHtml(t('telegram.live.longAsFile'))}</i>`.slice(0, 1000)
        })
      } catch (err) {
        this.d.onSendError(err)
      }
      if (files.length) await this.safeSend(api, owner, escapeHtml(t('telegram.live.filesMade')), files)
      return
    }
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1
      await this.safeSend(api, owner, chunks[i] as string, last ? files : undefined)
    }
  }

  private async safeSend(api: TelegramApi, owner: number, html: string, rows?: { text: string; callback_data: string }[][]): Promise<void> {
    try {
      await api.sendMessage({ chatId: owner, text: html, markup: rows && rows.length ? { inline_keyboard: rows } : undefined })
    } catch (err) {
      this.d.onSendError(err)
    }
  }

  /** Un botón «Recibir archivo» por archivo creado que PASA las reglas (carpetas de esa sesión, secretos, ejecutables, 50 MB). */
  private fileButtons(s: PersistedActiveSession, view: TurnView, owner: number): { text: string; callback_data: string }[][] {
    if (this.d.summariesOnly()) return []
    const roots = this.d.fileRoots(s)
    const rows: { text: string; callback_data: string }[][] = []
    const seen = new Set<string>()
    for (const p of view.files) {
      if (rows.length >= this.d.limits.maxFileButtons) break
      const c = checkOutgoingFile(roots, p)
      if (!c.ok || seen.has(c.real)) continue
      seen.add(c.real)
      const entry = this.d.actions.create('f', owner, { path: c.real, roots, sessionId: s.id }, TTL_ACTION_MS)
      const name = stripControl(redactForTelegram(c.name)).replace(/\s+/g, ' ').slice(0, 40)
      rows.push([{ text: `${t('telegram.live.receiveFile')}: ${name}`, callback_data: ActionBook.data(entry) }])
    }
    return rows
  }

  /** Último turno leído (para el resumen al elegir la sesión y para las pruebas). */
  get last(): TurnView | null {
    return this.lastView
  }
}

export type { MsgKey, EngineMessage }
