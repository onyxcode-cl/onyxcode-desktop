/**
 * Servidor de Telegram FALSO (solo pruebas): implementa lo que usa el puente de la entrega 1.
 *
 *   getMe · getUpdates (offset, long polling simulado) · sendMessage · editMessageText · answerCallbackQuery
 *
 * Imita las reglas de la API real que importan para nuestros errores: token en la ruta (`/bot<token>/<método>`), 401 si no
 * coincide, mensajes ≤ 4096 caracteres, `callback_data` ≤ 64 bytes, `parse_mode: HTML` estricto (un `<` o `&` sin escapar
 * da 400 «can't parse entities»), 429 con `parameters.retry_after` y «message is not modified».
 *
 * Uso: `const tg = await startFakeTelegram({ token })` → `tg.url` (http://127.0.0.1:<puerto>), `tg.sendUser(...)`,
 * `tg.press(...)`, `tg.messages`, `tg.edits`, `tg.callbackAnswers`, `tg.stop()`.
 * También se puede lanzar suelto: `node e2e/fake-telegram/server.mjs <token> [puerto]` (imprime la URL y se queda escuchando).
 */
import { createServer } from 'node:http'

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler', 'blockquote'])

/** Valida el HTML como lo haría Telegram: etiquetas permitidas bien cerradas y sin `<` ni `&` sueltos. Devuelve el error o null. */
export function htmlProblem(text) {
  const stack = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '<') {
      const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*)?>/.exec(text.slice(i))
      if (!m) return `Bad Request: can't parse entities: Unsupported start tag at byte offset ${i}`
      const name = m[2].toLowerCase()
      if (!ALLOWED_TAGS.has(name)) return `Bad Request: can't parse entities: Unsupported start tag "${name}" at byte offset ${i}`
      if (m[1]) {
        if (stack.pop() !== name) return `Bad Request: can't parse entities: Unmatched end tag at byte offset ${i}`
      } else stack.push(name)
      i += m[0].length
      continue
    }
    if (c === '&') {
      const m = /^&(?:amp|lt|gt|quot|#\d{1,7}|#x[0-9a-fA-F]{1,6});/.exec(text.slice(i))
      if (!m) return `Bad Request: can't parse entities: Unsupported entity at byte offset ${i}`
      i += m[0].length
      continue
    }
    if (c === '>') return `Bad Request: can't parse entities: Unescaped ">" at byte offset ${i}`
    i++
  }
  if (stack.length) return `Bad Request: can't parse entities: Can't find end tag corresponding to start tag "${stack.pop()}"`
  return null
}

/** Texto visible (sin etiquetas, con entidades resueltas), que es lo que Telegram cuenta para el tope de 4096. */
export function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function checkMarkup(markup) {
  if (!markup) return null
  const rows = markup.inline_keyboard
  if (!Array.isArray(rows)) return 'Bad Request: reply markup is invalid'
  for (const row of rows)
    for (const b of row) {
      if (typeof b.text !== 'string' || !b.text) return 'Bad Request: text buttons are unallowed in the inline keyboard'
      if (b.callback_data !== undefined && Buffer.byteLength(String(b.callback_data), 'utf8') > 64)
        return 'Bad Request: BUTTON_DATA_INVALID'
    }
  return null
}

export async function startFakeTelegram(opts = {}) {
  const token = opts.token ?? '123456789:' + 'A'.repeat(35)
  const botId = token.split(':')[0]
  const username = opts.username ?? 'lazunox_prueba_bot'
  /** Tope de espera de un getUpdates (ms), para que las pruebas sean rápidas. */
  const maxHold = opts.maxHoldMs ?? 600

  const state = {
    token,
    username,
    updates: [],
    nextUpdateId: opts.firstUpdateId ?? 1000,
    nextMessageId: 1,
    /** Mensajes enviados por el bot: { chat_id, message_id, text, reply_markup, parse_mode, at }. */
    messages: [],
    /** Ediciones: { chat_id, message_id, text, reply_markup }. */
    edits: [],
    callbackAnswers: [],
    /** Todas las peticiones: { method, params, tokenOk }. */
    requests: [],
    /** Offsets recibidos por getUpdates. */
    offsets: [],
    pollers: 0,
    failures: new Map()
  }
  const waiters = new Set()

  const wake = () => {
    for (const w of [...waiters]) w()
  }

  const api = {
    getMe: () => ({ id: Number(botId), is_bot: true, first_name: 'Bot de prueba', username }),
    getUpdates: async (p, signal) => {
      const offset = Number(p.offset ?? 0)
      state.offsets.push(offset)
      // Telegram confirma (borra) todo lo anterior al offset.
      state.updates = state.updates.filter((u) => u.update_id >= offset)
      const hold = Math.min(Number(p.timeout ?? 0) * 1000, maxHold)
      const pick = () => state.updates.filter((u) => u.update_id >= offset).slice(0, Number(p.limit ?? 100))
      if (pick().length === 0 && hold > 0) {
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(t)
            waiters.delete(done)
            resolve()
          }
          const t = setTimeout(done, hold)
          waiters.add(done)
          signal?.addEventListener('abort', done, { once: true })
        })
      }
      return pick()
    },
    sendMessage: (p) => {
      if (typeof p.chat_id !== 'number') return { error: [400, 'Bad Request: chat not found'] }
      if (typeof p.text !== 'string' || !p.text) return { error: [400, 'Bad Request: message text is empty'] }
      if (p.parse_mode === 'HTML') {
        const bad = htmlProblem(p.text)
        if (bad) return { error: [400, bad] }
      }
      if (visibleText(p.text).length > 4096) return { error: [400, 'Bad Request: message is too long'] }
      const mk = checkMarkup(p.reply_markup)
      if (mk) return { error: [400, mk] }
      if (state.blocked?.has(p.chat_id)) return { error: [403, 'Forbidden: bot was blocked by the user'] }
      const message_id = state.nextMessageId++
      const m = { chat_id: p.chat_id, message_id, text: p.text, parse_mode: p.parse_mode, reply_markup: p.reply_markup, at: Date.now() }
      state.messages.push(m)
      return { result: { message_id, chat: { id: p.chat_id, type: 'private' }, date: Math.floor(Date.now() / 1000), text: p.text } }
    },
    editMessageText: (p) => {
      const orig = state.messages.find((m) => m.chat_id === p.chat_id && m.message_id === p.message_id)
      if (!orig) return { error: [400, 'Bad Request: message to edit not found'] }
      if (p.parse_mode === 'HTML') {
        const bad = htmlProblem(p.text)
        if (bad) return { error: [400, bad] }
      }
      if (visibleText(p.text).length > 4096) return { error: [400, 'Bad Request: message is too long'] }
      const mk = checkMarkup(p.reply_markup)
      if (mk) return { error: [400, mk] }
      const cur = [...state.edits].reverse().find((e) => e.chat_id === p.chat_id && e.message_id === p.message_id) ?? orig
      if (cur.text === p.text && JSON.stringify(cur.reply_markup ?? null) === JSON.stringify(p.reply_markup ?? null))
        return { error: [400, 'Bad Request: message is not modified'] }
      state.edits.push({ chat_id: p.chat_id, message_id: p.message_id, text: p.text, reply_markup: p.reply_markup, at: Date.now() })
      return { result: true }
    },
    answerCallbackQuery: (p) => {
      state.callbackAnswers.push({ id: p.callback_query_id, text: p.text, show_alert: p.show_alert === true })
      return { result: true }
    }
  }

  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? '')
      if (!m || req.method !== 'POST') return send(404, { ok: false, error_code: 404, description: 'Not Found' })
      let params = {}
      try {
        params = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch {
        return send(400, { ok: false, error_code: 400, description: 'Bad Request: invalid JSON' })
      }
      const tokenOk = decodeURIComponent(m[1]) === token
      const method = m[2]
      state.requests.push({ method, params, tokenOk })
      if (!tokenOk) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
      const fail = state.failures.get(method)
      if (fail && fail.times > 0) {
        fail.times--
        const body = {
          ok: false,
          error_code: fail.status,
          description: fail.description ?? 'Too Many Requests: retry after ' + fail.retry_after
        }
        if (fail.retry_after !== undefined) body.parameters = { retry_after: fail.retry_after }
        return send(fail.status, body)
      }
      if (state.revoked) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
      if (method === 'getUpdates' && state.conflict)
        return send(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
      const fn = api[method]
      if (!fn) return send(404, { ok: false, error_code: 404, description: 'Not Found' })
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      if (method === 'getUpdates') state.pollers++
      try {
        const out = await fn(params, ac.signal)
        if (method === 'getUpdates' || method === 'getMe') return send(200, { ok: true, result: out })
        if (out.error) return send(out.error[0], { ok: false, error_code: out.error[0], description: out.error[1] })
        return send(200, { ok: true, result: out.result })
      } finally {
        if (method === 'getUpdates') state.pollers--
      }
    })
  })

  await new Promise((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const port = server.address().port

  const push = (u) => {
    state.updates.push({ update_id: state.nextUpdateId++, ...u })
    wake()
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    username,
    state,
    get messages() {
      return state.messages
    },
    get edits() {
      return state.edits
    },
    get callbackAnswers() {
      return state.callbackAnswers
    },
    get requests() {
      return state.requests
    },
    get offsets() {
      return state.offsets
    },
    get pollers() {
      return state.pollers
    },
    /** Una persona escribe al bot. `chatType` 'private' (por defecto), 'group', 'supergroup' o 'channel'. */
    sendUser({ chatId, text, fromId, firstName = 'Ana', chatType = 'private', isBot = false }) {
      push({
        message: {
          message_id: state.nextMessageId++,
          from: { id: fromId ?? chatId, is_bot: isBot, first_name: firstName },
          chat: { id: chatId, type: chatType },
          date: Math.floor(Date.now() / 1000),
          text
        }
      })
    },
    /** Una persona pulsa un botón de un mensaje del bot. */
    press({ chatId, messageId, data, fromId, chatType = 'private' }) {
      const id = `cb${state.nextUpdateId}`
      push({
        callback_query: {
          id,
          from: { id: fromId ?? chatId, is_bot: false, first_name: 'Ana' },
          message: { message_id: messageId, chat: { id: chatId, type: chatType }, date: 0 },
          data
        }
      })
      return id
    },
    /** Un tipo de update que el bot no pide (p. ej. edited_message): debe descartarse. */
    sendRaw(update) {
      push(update)
    },
    /** Hace fallar las próximas `times` llamadas de `method` con ese estado (429 con `retry_after`, 500…). */
    failNext(method, { status = 429, retry_after, times = 1, description } = {}) {
      state.failures.set(method, { status, retry_after, times, description })
    },
    /** A partir de ahora toda petición responde 401 (token revocado). */
    revoke() {
      state.revoked = true
    },
    /** getUpdates responde 409 (otra aplicación lee el bot). */
    setConflict(on) {
      state.conflict = on
    },
    /** El usuario bloqueó al bot: sendMessage a ese chat da 403. */
    block(chatId) {
      state.blocked ??= new Set()
      state.blocked.add(chatId)
    },
    /** Mensajes del bot a un chat. */
    to(chatId) {
      return state.messages.filter((m) => m.chat_id === chatId)
    },
    async stop() {
      wake()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

// Ejecución suelta: `node e2e/fake-telegram/server.mjs <token> [puerto]`.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const tg = await startFakeTelegram({ token: process.argv[2] ?? undefined, port: process.argv[3] ? Number(process.argv[3]) : 0 })
  console.log(tg.url)
  process.on('SIGTERM', () => void tg.stop().then(() => process.exit(0)))
}
