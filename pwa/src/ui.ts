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

// ── iconos e ilustraciones en SVG en línea (constantes del código; nunca datos del equipo) ──

const SVG_NS = 'http://www.w3.org/2000/svg'
let gemId = 0

function svg(size: number, nodes: Array<[string, Record<string, string>]>, extra: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, 'svg')
  const attrs: Record<string, string> = { width: String(size), height: String(size), 'aria-hidden': 'true', ...extra }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const [tag, a] of nodes) {
    const n = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v)
    el.append(n)
  }
  return el
}

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }

type IconName = 'back' | 'up' | 'down' | 'stop' | 'chevron' | 'phone' | 'clock' | 'wifioff' | 'ban' | 'alert' | 'chat' | 'shield'

const ICONS: Record<IconName, Array<[string, Record<string, string>]>> = {
  back: [['path', { d: 'M15 18l-6-6 6-6' }]],
  chevron: [['path', { d: 'M9 18l6-6-6-6' }]],
  up: [['path', { d: 'M12 19V5M5 12l7-7 7 7' }]],
  down: [['path', { d: 'M12 5v14M19 12l-7 7-7-7' }]],
  stop: [['rect', { x: '6', y: '6', width: '12', height: '12', rx: '2.5', fill: 'currentColor', stroke: 'none' }]],
  phone: [
    ['rect', { x: '6.5', y: '2.5', width: '11', height: '19', rx: '3' }],
    ['path', { d: 'M10.5 18.5h3' }]
  ],
  clock: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M12 7v5l3 2' }]
  ],
  wifioff: [
    ['path', { d: 'M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-4.3-2.4M8.5 16a5 5 0 0 1 7 0' }],
    ['path', { d: 'M12 19.5h.01M3 3l18 18' }]
  ],
  ban: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M5.6 5.6l12.8 12.8' }]
  ],
  alert: [['path', { d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' }]],
  chat: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
  shield: [['path', { d: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM12 8v4M12 15.5h.01' }]]
}

function icon(name: IconName, size = 20): SVGElement {
  const el = svg(size, ICONS[name], { viewBox: '0 0 24 24', ...STROKE })
  if (name === 'stop') el.setAttribute('stroke', 'none')
  return el
}

/** «Faceta»: gema de 4 facetas + chispa dorada (geometría de `build/icon.svg` y de `Logo.tsx`). */
function gem(size: number, animated = false): SVGElement {
  const el = document.createElementNS(SVG_NS, 'svg')
  el.setAttribute('width', String(size))
  el.setAttribute('height', String(size))
  el.setAttribute('viewBox', '0 0 32 32')
  el.setAttribute('aria-hidden', 'true')
  const mk = (tag: string, a: Record<string, string>, parent: Element = el): Element => {
    const n = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v)
    parent.append(n)
    return n
  }
  const id = `gm${(gemId += 1)}`
  const clip = mk('clipPath', { id }, mk('defs', {}))
  mk('rect', { x: '7.5', y: '7.5', width: '17', height: '17', rx: '3.6', transform: 'rotate(45 16 16)' }, clip)
  const g = mk('g', { 'clip-path': `url(#${id})` })
  const c = '16,14.6'
  mk('polygon', { points: `16,-2 ${c} -2,16`, fill: '#a9bbff' }, g)
  mk('polygon', { points: `16,-2 34,16 ${c}`, fill: '#5f7ff6' }, g)
  mk('polygon', { points: `-2,16 ${c} 16,34`, fill: '#3556e0' }, g)
  mk('polygon', { points: `${c} 34,16 16,34`, fill: '#1c2f94' }, g)
  mk(
    'path',
    {
      d: 'M26 1.2 Q26.85 5.15 30.8 6 Q26.85 6.85 26 10.8 Q25.15 6.85 21.2 6 Q25.15 5.15 26 1.2Z',
      fill: '#f0c35a',
      class: animated ? 'spark' : ''
    },
    el
  )
  return el
}

/** Ilustración mínima de los estados vacíos y de error. */
function art(kind: IconName | 'gem', tone: '' | 'warn' | 'bad' = '', small = false, busy = false): HTMLElement {
  const inner = kind === 'gem' ? gem(small ? 40 : 56, busy) : icon(kind, small ? 32 : 44)
  return h('div', { class: `art ${tone}${small ? ' small' : ''}${busy ? ' busyart' : ''}`.trim(), 'aria-hidden': 'true' }, inner)
}

// ── Markdown mínimo, escapado por construcción ──

const INLINE_RE = /(`[^`\n]{1,300}`|\*\*[^*\n]{1,300}\*\*)/
const FENCE_RE = /```([^\n]*)\n?([\s\S]*?)(?:```|$)/g

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
    const language = m[1]
      .trim()
      .replace(/[^\w+#.-]/g, '')
      .slice(0, 24)
    frag.append(
      h(
        'div',
        { class: 'codeblock' },
        language ? h('span', { class: 'lang' }, language) : null,
        h('pre', { tabindex: '0' }, h('code', {}, m[2].replace(/\n$/, '')))
      )
    )
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
  // En «reconectando» el texto largo ya lo dice el aviso bajo la barra: aquí solo el punto (y la etiqueta accesible).
  const dot = online ? 'dot ok' : conn.k === 'reconnecting' ? 'dot busy' : 'dot off'
  return h(
    'span',
    { class: 'chip', role: 'status', 'aria-label': `${t('sr.connection')}: ${label}` },
    h('span', { class: dot, 'aria-hidden': 'true' }),
    conn.k === 'reconnecting' ? t('conn.reconnectingShort') : label
  )
}

function banner(conn: Conn): HTMLElement | null {
  if (conn.k === 'reconnecting')
    return h('div', { class: 'banner', role: 'status' }, t('conn.reconnecting', { n: conn.attempt, max: conn.max }))
  return null
}

function brand(): HTMLElement {
  return h('span', { class: 'brand' }, gem(26), t('appName'))
}

// ── pantalla de estado (vinculación, conectando, errores) ──

function failArt(r: FailReason): HTMLElement {
  switch (r) {
    case 'expired':
      return art('clock', 'warn')
    case 'no-host':
    case 'unreachable':
      return art('wifioff', 'warn')
    case 'busy':
    case 'rate':
    case 'other-device':
      return art('alert', 'warn')
    case 'version':
    case 'unsupported':
    case 'protocol':
      return art('alert', 'bad')
    default:
      return art('ban', 'bad')
  }
}

function statusScreen(c: RemoteClient, s: Snapshot): Screen {
  const conn = s.conn
  const title = h('h1', { tabindex: '-1' })
  const root = h('div', { class: 'center' })
  const body = (text: string): HTMLElement => h('p', { class: 'muted fine' }, text)
  switch (conn.k) {
    case 'idle':
      title.textContent = t('idle.title')
      root.append(art('phone'), title, h('p', { class: 'muted' }, t('idle.body')), body(t('idle.sameWifi')))
      break
    case 'connecting':
      title.textContent = t('conn.connecting')
      root.setAttribute('aria-busy', 'true')
      root.append(art('gem', '', false, true), title)
      break
    case 'pairing':
      title.textContent = t('pair.title')
      root.append(art('gem', '', true, true), title)
      if (conn.code) {
        root.append(
          h('p', { class: 'label', id: 'codelabel' }, t('pair.codeLabel')),
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
          h('p', { class: 'muted' }, t('pair.compare')),
          body(conn.pending ? t('pair.waiting') : t('conn.confirm'))
        )
      }
      break
    case 'locked': {
      const why = conn.why
      title.textContent = t(why === 'confirm' ? 'lock.confirm.title' : why === 'pin-set' ? 'lock.set.title' : 'lock.verify.title')
      root.append(art('gem', '', true, true), title)
      if (why === 'confirm') {
        root.setAttribute('aria-busy', 'true')
        root.append(h('p', { class: 'muted' }, t('lock.confirm.body')))
        break
      }
      root.append(
        h('p', { class: 'muted' }, t(why === 'pin-set' ? 'lock.set.body' : why === 'inactive' ? 'lock.inactive.body' : 'lock.verify.body'))
      )
      const setting = why === 'pin-set'
      const field = (label: string): HTMLInputElement =>
        h('input', {
          type: 'password',
          inputmode: 'numeric',
          pattern: '[0-9]*',
          maxlength: '6',
          autocomplete: 'off',
          'aria-label': label,
          placeholder: label,
          class: 'pin'
        })
      const pin = field(t('lock.pin'))
      const again = setting ? field(t('lock.pinAgain')) : null
      const err = h('p', { class: 'muted fine', role: 'alert' })
      if (conn.left !== undefined) err.textContent = t('lock.wrong', { left: conn.left })
      const go = h('button', { class: 'primary', type: 'submit' }, t(setting ? 'lock.set.btn' : 'lock.verify.btn')) as HTMLButtonElement
      const form = h(
        'form',
        {
          class: 'actions',
          'on:submit': (e: Event) => {
            e.preventDefault()
            if (!/^[0-9]{6}$/.test(pin.value)) return void (err.textContent = t('lock.format'))
            if (again && again.value !== pin.value) return void (err.textContent = t('lock.mismatch'))
            go.disabled = true
            c.sendPin(pin.value, setting)
            pin.value = ''
            if (again) again.value = ''
          }
        },
        pin,
        ...(again ? [again] : []),
        go
      )
      if (conn.retryMs) {
        go.disabled = true
        setTimeout(() => (go.disabled = false), conn.retryMs)
      }
      root.append(form, err)
      return { key: `status:${JSON.stringify(conn)}:${s.paired}`, root, update: () => undefined, focus: () => pin.focus() }
    }
    case 'failed': {
      const r: FailReason = conn.reason
      title.textContent = t(failTitleKey(r))
      root.append(failArt(r), title, h('p', { class: 'muted' }, t(failBodyKey(r))))
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
  card.append(
    h('header', {}, h('span', { class: 'shield', 'aria-hidden': 'true' }, icon('shield', 18)), h('h2', {}, p.title || t('perm.title')))
  )
  if (sessionTitle) card.append(h('p', { class: 'where' }, sessionTitle))
  if (p.summary) card.append(h('p', { class: 'sum' }, p.summary))
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
    card.append(h('p', { class: 'note' }, t('perm.macOnly')), h('p', { class: 'muted fine' }, t('perm.macOnlyHint')))
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
  const empty = h('div', { class: 'empty' })
  const scroll = h(
    'div',
    { class: 'scroll' },
    h('div', { class: 'pagetitle' }, title),
    permSlot,
    listEl,
    empty,
    h('div', { class: 'list-pad' })
  )
  const root = h('div', { class: 'col' }, h('div', { class: 'bar' }, brand(), chipSlot), bannerSlot, scroll)

  const update = (s: Snapshot): void => {
    chipSlot.replaceChildren(chip(s.conn))
    bannerSlot.replaceChildren(...(banner(s.conn) ? [banner(s.conn) as HTMLElement] : []))
    const sessions = s.sessions
    const byId = new Map((sessions ?? []).map((x) => [x.id, x]))
    permSlot.replaceChildren(...s.permissions.map((p) => permCard(c, p, byId.get(p.sessionId)?.title)))
    listEl.replaceChildren(...(sessions ?? []).map((x) => sessionRow(c, x)))
    if (sessions === null) empty.replaceChildren(h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' }))
    else if (sessions.length === 0) empty.replaceChildren(art('chat', '', true), h('p', {}, t('list.empty')))
    else empty.replaceChildren()
    empty.style.padding = sessions === null ? '0' : ''
  }
  return { key: 'list', root, update, focus: () => title.focus() }
}

function sessionRow(c: RemoteClient, x: RemoteSession): HTMLElement {
  const busy = x.status === 'busy'
  const btn = h(
    'button',
    { class: busy ? 'row busyrow' : 'row', type: 'button' },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, icon('chat', 18)),
    h(
      'span',
      { class: 'txt' },
      h('span', { class: 'title' }, x.title || '—'),
      h(
        'span',
        { class: 'meta' },
        h('span', { class: busy ? 'dot busy' : 'dot', 'aria-hidden': 'true' }),
        h(
          'span',
          {},
          [busy ? t('status.busy') : t('status.idle'), t(x.kind === 'code' ? 'kind.code' : 'kind.chat'), x.project, ago(x.updatedAt)]
            .filter(Boolean)
            .join(' · ')
        )
      )
    ),
    h('span', { class: 'go', 'aria-hidden': 'true' }, icon('chevron', 16))
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
  return h(
    'div',
    { class: `tool ${p.status}` },
    h('span', { class: 'st', 'aria-hidden': 'true' }),
    h('span', {}, h('b', {}, p.name), ` · ${t(`tool.${p.status}`)}`, p.summary ? ` — ${p.summary}` : '')
  )
}

function messageNode(m: RemoteMessage): HTMLElement {
  const user = m.role === 'user'
  const el = h('article', { class: `msg${user ? ' user' : ''}${m.streaming ? ' streaming' : ''}` })
  el.append(
    h(
      'div',
      { class: 'who' },
      user ? null : gem(16),
      user ? t('chat.you') : t('chat.assistant'),
      m.streaming ? ` · ${t('chat.streaming')}` : ''
    )
  )
  for (const p of m.parts) el.append(partNode(p))
  return el
}

function chatScreen(c: RemoteClient, id: string): Screen {
  const back = h('button', { class: 'ghost back', type: 'button', 'aria-label': t('btn.back') }, icon('back', 22))
  back.addEventListener('click', () => {
    if (history.state && (history.state as { onyxChat?: string }).onyxChat) history.back()
    else c.closeChat()
  })
  const title = h('h1', { tabindex: '-1' })
  const chipSlot = h('span')
  const bannerSlot = h('div')
  const permSlot = h('div', { class: 'permdock', role: 'region', 'aria-live': 'assertive' })
  const older = h('button', { type: 'button' }, t('btn.older'))
  older.addEventListener('click', () => void c.loadOlder())
  const emptyEl = h('div', { class: 'empty' })
  const msgsEl = h('div', { class: 'msgs', role: 'log', 'aria-live': 'off' })
  const scroll = h('div', { class: 'scroll' }, h('div', { class: 'older' }, older), msgsEl, emptyEl)
  const toEnd = h('button', { class: 'toend', type: 'button', 'aria-label': t('btn.toEnd') }, icon('down', 18))
  toEnd.hidden = true
  const wrap = h('div', { class: 'wrap' }, scroll, toEnd)
  const ta = h('textarea', {
    rows: '1',
    maxlength: String(LIMITS.maxPromptChars),
    placeholder: t('chat.placeholder'),
    'aria-label': t('chat.messageLabel'),
    enterkeyhint: 'enter',
    autocomplete: 'off'
  })
  const send = h('button', { class: 'primary round', type: 'submit', 'aria-label': t('btn.send') }, icon('up', 20))
  const stop = h('button', { class: 'danger round', type: 'button', 'aria-label': t('btn.stop') }, icon('stop', 18))
  stop.hidden = true
  const form = h('form', { class: 'composer' }, ta, stop, send)
  const root = h('div', { class: 'col' }, h('div', { class: 'bar' }, back, title, chipSlot), bannerSlot, wrap, permSlot, form)

  let sending = false
  const grow = (): void => {
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }
  ta.addEventListener('input', grow)
  const nearEnd = (): boolean => scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 80
  scroll.addEventListener('scroll', () => {
    toEnd.hidden = nearEnd()
  })
  toEnd.addEventListener('click', () => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: calm ? 'auto' : 'smooth' })
  })
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
    older.parentElement?.toggleAttribute('hidden', !chat.hasMore)
    older.disabled = chat.loadingOlder
    if (chat.loading) emptyEl.replaceChildren(h('p', {}, t('list.loading')))
    else if (chat.messages.length === 0) emptyEl.replaceChildren(art('chat', '', true), h('p', {}, t('chat.empty')))
    else emptyEl.replaceChildren()
    const last = chat.messages[chat.messages.length - 1]
    const working = session?.status === 'busy' || last?.streaming === true
    stop.hidden = !working

    const atBottom = first || nearEnd()
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
    toEnd.hidden = nearEnd()
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

/**
 * Teclado en pantalla: `visualViewport` (no exige contexto seguro) se encoge cuando aparece el teclado; se ajusta la altura
 * de la app a la zona visible para que el compositor quede encima. Sin `visualViewport` no hace nada (queda `100dvh`).
 */
function trackViewport(root: HTMLElement): void {
  const vv = window.visualViewport
  if (!vv) return
  const apply = (): void => {
    const kb = window.innerHeight - vv.height > 120
    document.documentElement.classList.toggle('kb', kb)
    root.style.height = kb ? `${Math.round(vv.height)}px` : ''
    root.style.transform = kb && vv.offsetTop > 0 ? `translateY(${Math.round(vv.offsetTop)}px)` : ''
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
}

export function mountUi(root: HTMLElement, c: RemoteClient): void {
  trackViewport(root)
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
