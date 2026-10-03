/**
 * Interfaz: todo se construye con `createElement` + `textContent`. NUNCA `innerHTML` ni atributos con datos del equipo:
 * lo recibido se muestra como texto plano o como Markdown mínimo (código y negrita) generado con nodos del DOM.
 */
import type { RemoteMessage, RemotePart, RemotePermission, RemoteSession } from '../../src/shared/remote/protocol'
import { LIMITS } from '../../src/shared/remote/protocol'
import type { Conn, FailReason, RemoteClient, Snapshot } from './client'
import { lang, t } from './i18n'

type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'function') el.addEventListener(k.slice(3), v)
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '')
    } else el.setAttribute(k, v)
  }
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return el
}

// ── Markdown mínimo, escapado por construcción ──

const INLINE_RE = /(`[^`\n]{1,300}`|\*\*[^*\n]{1,300}\*\*)/
const FENCE_RE = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g

function inline(text: string): Node[] {
  return text.split(INLINE_RE).flatMap((tok): Node[] => {
    if (!tok) return []
    if (tok.length > 2 && tok.startsWith('`') && tok.endsWith('`')) return [h('code', {}, tok.slice(1, -1))]
    if (tok.length > 4 && tok.startsWith('**') && tok.endsWith('**')) return [h('strong', {}, tok.slice(2, -2))]
    return [document.createTextNode(tok)]
  })
}

export function renderRich(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  let last = 0
  const paragraphs = (s: string): void => {
    for (const para of s.split(/\n{2,}/)) {
      const p = para.replace(/^\n+|\n+$/g, '')
      if (p) frag.append(h('p', {}, ...inline(p)))
    }
  }
  for (const m of text.matchAll(FENCE_RE)) {
    const idx = m.index ?? 0
    paragraphs(text.slice(last, idx))
    frag.append(h('pre', { tabindex: '0' }, h('code', {}, m[1].replace(/\n$/, ''))))
    last = idx + m[0].length
    if (m[0].length === 0) break
  }
  paragraphs(text.slice(last))
  return frag
}

// ── utilidades ──

function ago(ms: number): string {
  const diff = Math.round((ms - Date.now()) / 1000)
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
    const a = Math.abs(diff)
    if (a < 45) return t('time.now')
    if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute')
    if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
    return rtf.format(Math.round(diff / 86400), 'day')
  } catch {
    return ''
  }
}

function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

interface Screen {
  key: string
  root: HTMLElement
  update(s: Snapshot): void
  focus(): void
}

function chip(conn: Conn): HTMLElement {
  const online = conn.k === 'online'
  const label = online
    ? t('conn.online')
    : conn.k === 'reconnecting'
      ? t('conn.reconnecting', { n: conn.attempt, max: conn.max })
      : t('conn.offline')
  return h(
    'span',
    { class: 'chip', role: 'status', 'aria-label': `${t('sr.connection')}: ${label}` },
    h('span', { class: online ? 'dot ok' : 'dot', 'aria-hidden': 'true' }),
    label
  )
}

function banner(conn: Conn): HTMLElement | null {
  if (conn.k === 'reconnecting')
    return h('div', { class: 'banner', role: 'status' }, t('conn.reconnecting', { n: conn.attempt, max: conn.max }))
  return null
}

// ── pantalla de estado (vinculación, conectando, errores) ──

function statusScreen(c: RemoteClient, s: Snapshot): Screen {
  const conn = s.conn
  const title = h('h1', { tabindex: '-1' })
  const root = h('div', { class: 'center' })
  const body = (text: string): HTMLElement => h('p', { class: 'muted' }, text)
  switch (conn.k) {
    case 'idle':
      title.textContent = t('idle.title')
      root.append(title, h('p', {}, t('idle.body')), body(t('idle.sameWifi')))
      break
    case 'connecting':
      title.textContent = t('conn.connecting')
      root.setAttribute('aria-busy', 'true')
      root.append(h('div', { class: 'spinner', 'aria-hidden': 'true' }), title)
      break
    case 'pairing':
      title.textContent = t('pair.title')
      root.append(title)
      if (conn.code) {
        root.append(
          h('p', { class: 'muted', id: 'codelabel' }, t('pair.codeLabel')),
          h(
            'div',
            {
              class: 'code',
              role: 'img',
              'aria-labelledby': 'codelabel',
              'aria-label': `${t('pair.codeLabel')}: ${conn.code.split('').join(' ')}`
            },
            groupCode(conn.code)
          ),
          h('p', {}, t('pair.compare')),
          body(conn.pending ? t('pair.waiting') : t('conn.confirm'))
        )
      }
      break
    case 'failed': {
      const r: FailReason = conn.reason
      title.textContent = t(failTitleKey(r))
      root.append(title, h('p', {}, t(failBodyKey(r))))
      const actions = h('div', { class: 'actions' })
      if (conn.canRetry) actions.append(h('button', { class: 'primary', type: 'button', 'on:click': () => c.retry() }, t('btn.retry')))
      if (s.paired && r !== 'revoked' && r !== 'unsupported')
        actions.append(h('button', { type: 'button', 'on:click': () => c.forget() }, t('btn.forget')))
      if (actions.childElementCount > 0) root.append(actions)
      break
    }
    default:
      break
  }
  return { key: `status:${JSON.stringify(conn)}:${s.paired}`, root, update: () => undefined, focus: () => title.focus() }
}

function failTitleKey(r: FailReason): string {
  switch (r) {
    case 'denied-timeout':
    case 'denied-limit':
      return 'fail.title.denied'
    case 'rate':
      return 'fail.title.rate'
    default:
      return `fail.title.${r}`
  }
}

function failBodyKey(r: FailReason): string {
  return r === 'rate' ? 'fail.body.rate' : `fail.body.${r}`
}

// ── tarjeta de permiso ──

function permCard(c: RemoteClient, p: RemotePermission, sessionTitle?: string): HTMLElement {
  const card = h('section', { class: 'perm', 'aria-label': t('perm.title') })
  card.append(h('h2', {}, p.title || t('perm.title')))
  if (sessionTitle) card.append(h('p', { class: 'muted' }, sessionTitle))
  if (p.summary) card.append(h('p', {}, p.summary))
  if (p.actionable) {
    const allow = h('button', { class: 'primary', type: 'button' }, t('btn.allow'))
    const reject = h('button', { class: 'danger', type: 'button' }, t('btn.reject'))
    const go = (reply: 'once' | 'reject'): void => {
      allow.disabled = true
      reject.disabled = true
      void c.replyPermission(p.requestId, reply).finally(() => {
        allow.disabled = false
        reject.disabled = false
      })
    }
    allow.addEventListener('click', () => go('once'))
    reject.addEventListener('click', () => go('reject'))
    card.append(h('div', { class: 'actions' }, allow, reject))
  } else {
    card.append(h('p', { class: 'note' }, t('perm.macOnly')), h('p', { class: 'muted' }, t('perm.macOnlyHint')))
  }
  return card
}

// ── lista de sesiones ──

function listScreen(c: RemoteClient): Screen {
  const title = h('h1', { tabindex: '-1' }, t('list.title'))
  const chipSlot = h('span')
  const bannerSlot = h('div')
  const permSlot = h('div', { role: 'region', 'aria-live': 'assertive' })
  const listEl = h('ul', { class: 'list' })
  const empty = h('p', { class: 'muted' })
  const scroll = h('div', { class: 'scroll' }, permSlot, listEl, empty)
  const root = h(
    'div',
    { class: 'center-wrap', style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
    h('div', { class: 'bar' }, title, chipSlot),
    bannerSlot,
    scroll
  )

  const update = (s: Snapshot): void => {
    chipSlot.replaceChildren(chip(s.conn))
    bannerSlot.replaceChildren(...(banner(s.conn) ? [banner(s.conn) as HTMLElement] : []))
    const sessions = s.sessions
    const byId = new Map((sessions ?? []).map((x) => [x.id, x]))
    permSlot.replaceChildren(...s.permissions.map((p) => permCard(c, p, byId.get(p.sessionId)?.title)))
    listEl.replaceChildren(...(sessions ?? []).map((x) => sessionRow(c, x)))
    empty.textContent = sessions === null ? t('list.loading') : sessions.length === 0 ? t('list.empty') : ''
  }
  return { key: 'list', root, update, focus: () => title.focus() }
}

function sessionRow(c: RemoteClient, x: RemoteSession): HTMLElement {
  const btn = h(
    'button',
    { class: 'row', type: 'button' },
    h('span', { class: 'title' }, x.title || '—'),
    h(
      'span',
      { class: 'meta' },
      h('span', { class: x.status === 'busy' ? 'dot busy' : 'dot', 'aria-hidden': 'true' }),
      [
        x.status === 'busy' ? t('status.busy') : t('status.idle'),
        t(x.kind === 'code' ? 'kind.code' : 'kind.chat'),
        x.project,
        ago(x.updatedAt)
      ]
        .filter(Boolean)
        .join(' · ')
    )
  )
  btn.addEventListener('click', () => {
    history.pushState({ onyxChat: x.id }, '')
    c.openChat(x.id)
  })
  return h('li', {}, btn)
}

// ── chat ──

function partNode(p: RemotePart): Node {
  if (p.type === 'text') {
    const d = h('div')
    d.append(renderRich(p.text))
    return d
  }
  return h('div', { class: 'tool' }, h('b', {}, p.name), ` · ${t(`tool.${p.status}`)}`, p.summary ? ` — ${p.summary}` : '')
}

function messageNode(m: RemoteMessage): HTMLElement {
  const el = h('article', { class: m.role === 'user' ? 'msg user' : 'msg' })
  el.append(
    h('div', { class: 'who' }, m.role === 'user' ? t('chat.you') : t('chat.assistant'), m.streaming ? ` · ${t('chat.streaming')}` : '')
  )
  for (const p of m.parts) el.append(partNode(p))
  return el
}

function chatScreen(c: RemoteClient, id: string): Screen {
  const back = h('button', { type: 'button', 'aria-label': t('btn.back') }, '‹')
  back.addEventListener('click', () => {
    if (history.state && (history.state as { onyxChat?: string }).onyxChat) history.back()
    else c.closeChat()
  })
  const title = h('h1', { tabindex: '-1' })
  const chipSlot = h('span')
  const bannerSlot = h('div')
  const permSlot = h('div', { role: 'region', 'aria-live': 'assertive' })
  const older = h('button', { type: 'button' }, t('btn.older'))
  older.addEventListener('click', () => void c.loadOlder())
  const emptyEl = h('p', { class: 'muted' })
  const msgsEl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'off' })
  const scroll = h('div', { class: 'scroll' }, permSlot, h('div', { class: 'actions' }, older), msgsEl, emptyEl)
  const ta = h('textarea', {
    rows: '1',
    maxlength: String(LIMITS.maxPromptChars),
    placeholder: t('chat.placeholder'),
    'aria-label': t('chat.messageLabel'),
    enterkeyhint: 'enter',
    autocomplete: 'off'
  })
  const send = h('button', { class: 'primary', type: 'submit' }, t('btn.send'))
  const stop = h('button', { class: 'danger', type: 'button' }, t('btn.stop'))
  stop.hidden = true
  const form = h('form', { class: 'composer' }, ta, stop, send)
  const root = h(
    'div',
    { style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
    h('div', { class: 'bar' }, back, title, chipSlot),
    bannerSlot,
    scroll,
    form
  )

  let sending = false
  const grow = (): void => {
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }
  ta.addEventListener('input', grow)
  const submit = async (): Promise<void> => {
    if (sending || ta.value.trim().length === 0) return
    sending = true
    send.disabled = true
    const ok = await c.sendPrompt(id, ta.value)
    sending = false
    send.disabled = false
    if (ok) {
      ta.value = ''
      grow()
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void submit()
  })
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  })
  stop.addEventListener('click', () => void c.abort(id))

  const rendered = new Map<string, { src: RemoteMessage; el: HTMLElement }>()
  let first = true
  let firstId = ''

  const update = (s: Snapshot): void => {
    const chat = s.chat
    if (!chat || chat.id !== id) return
    const session = s.sessions?.find((x) => x.id === id)
    title.textContent = session?.title || '…'
    chipSlot.replaceChildren(chip(s.conn))
    bannerSlot.replaceChildren(...(banner(s.conn) ? [banner(s.conn) as HTMLElement] : []))
    permSlot.replaceChildren(...s.permissions.filter((p) => p.sessionId === id).map((p) => permCard(c, p)))
    older.hidden = !chat.hasMore
    older.disabled = chat.loadingOlder
    emptyEl.textContent = chat.loading ? t('list.loading') : chat.messages.length === 0 ? t('chat.empty') : ''
    const last = chat.messages[chat.messages.length - 1]
    stop.hidden = !(session?.status === 'busy' || last?.streaming === true)

    const atBottom = first || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 80
    const prevHeight = scroll.scrollHeight
    const els: HTMLElement[] = []
    const keep = new Set<string>()
    for (const m of chat.messages) {
      keep.add(m.id)
      const cur = rendered.get(m.id)
      if (cur && cur.src === m) els.push(cur.el)
      else {
        const el = messageNode(m)
        rendered.set(m.id, { src: m, el })
        els.push(el)
      }
    }
    for (const k of [...rendered.keys()]) if (!keep.has(k)) rendered.delete(k)
    const same = els.length === msgsEl.children.length && els.every((el, i) => msgsEl.children[i] === el)
    if (!same) msgsEl.replaceChildren(...els)
    if (atBottom) scroll.scrollTop = scroll.scrollHeight
    else if (!first && chat.messages[0] && chat.messages[0].id !== firstId) scroll.scrollTop += scroll.scrollHeight - prevHeight
    firstId = chat.messages[0]?.id ?? ''
    scroll.scrollTop += Math.max(0, scroll.scrollHeight - prevHeight) * (scroll.scrollTop < 40 ? 1 : 0)
    if (!chat.loading) first = false
  }
  return { key: `chat:${id}`, root, update, focus: () => ta.focus({ preventScroll: true }) }
}

// ── montaje ──

function pickKey(s: Snapshot): string {
  const k = s.conn.k
  if (k === 'online' || k === 'reconnecting') return s.chat ? `chat:${s.chat.id}` : 'list'
  return `status:${JSON.stringify(s.conn)}:${s.paired}`
}

export function mountUi(root: HTMLElement, c: RemoteClient): void {
  const screenEl = h('div', { id: 'screen' })
  const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' })
  root.replaceChildren(screenEl, toastEl)
  let cur: Screen | null = null
  let lastToast = -1
  let everApp = false

  const render = (s: Snapshot): void => {
    if (s.toast && s.toast.n !== lastToast) {
      lastToast = s.toast.n
      toastEl.textContent = t(s.toast.key)
    } else if (!s.toast) toastEl.textContent = ''
    // Si ya se estaba en la app y la conexión se está recuperando, se mantiene la pantalla actual.
    const key = pickKey(s)
    if (!cur || cur.key !== key) {
      let next: Screen
      if (key === 'list') next = listScreen(c)
      else if (key.startsWith('chat:')) next = chatScreen(c, key.slice(5))
      else next = statusScreen(c, s)
      cur = next
      screenEl.replaceChildren(next.root)
      if (!key.startsWith('chat:') || !everApp) next.focus()
      if (key === 'list' || key.startsWith('chat:')) everApp = true
    }
    cur.update(s)
  }
  c.subscribe(render)
  render(c.state)

  // Botón «atrás» del navegador: vuelve de la conversación a la lista.
  window.addEventListener('popstate', () => {
    if (c.state.chat) c.closeChat()
  })
}
