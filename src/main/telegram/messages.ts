/**
 * Mensajes que el bot envía (HTML de Telegram). Todo texto dinámico pasa por `safeLine`/`safeBlock` (tapar → recortar → escapar);
 * los textos fijos vienen del diccionario (`telegram.msg.*`) y también se escapan.
 */
import { t, type MsgKey } from '@shared/i18n'
import { TELEGRAM_LIMITS } from '@shared/telegram'
import type { EnginePermission } from './engine-link'
import { ButtonBook, type ButtonEntry } from './guards'
import type { ReplyMarkup } from './api'
import { escapeHtml, safeBlock, safeLine } from './text'

/** Espacio que se deja libre al final del mensaje para añadir la línea de resultado al editarlo. */
const STATUS_RESERVE = 220

const PERMISSION_LABELS: Record<string, MsgKey> = {
  edit: 'code.perm.edit',
  write: 'code.perm.write',
  bash: 'code.perm.bash',
  webfetch: 'code.perm.webfetch',
  websearch: 'code.perm.websearch',
  read: 'code.perm.read',
  external_directory: 'code.perm.external_directory',
  task: 'code.perm.task',
  doom_loop: 'code.perm.doom_loop',
  todowrite: 'code.perm.todowrite'
}

export function permissionLabel(permission: string): string {
  const key = PERMISSION_LABELS[permission]
  return key ? t(key) : permission
}

export function untitled(): string {
  return t('telegram.msg.untitled')
}

const bold = (s: string): string => `<b>${escapeHtml(s)}</b>`

const omitted = (n: number): string => t('telegram.msg.perm.omitted', { count: n })

/** Lo principal que pide el permiso: el comando completo, la dirección, las rutas… (texto crudo; se tapa y escapa al armar el mensaje). */
export function permissionMainText(req: EnginePermission): { text: string; kind: 'command' | 'diff' | 'list' } {
  const md = req.metadata
  const command = typeof md.command === 'string' ? md.command : ''
  if (req.permission === 'bash' && command) return { text: command, kind: 'command' }
  const diff = typeof md.diff === 'string' ? md.diff : ''
  if (diff) return { text: diff, kind: 'diff' }
  if (command) return { text: command, kind: 'command' }
  const url = typeof md.url === 'string' ? md.url : ''
  if (url) return { text: url, kind: 'list' }
  return { text: req.patterns.join('\n'), kind: 'list' }
}

export interface PermissionMessage {
  /** HTML sin la línea de resultado ni botones (para reeditarlo). */
  body: string
  markup: ReplyMarkup
}

/** Arma el mensaje de un permiso con sus dos botones («Permitir una vez» y «Rechazar»; nunca «siempre»). */
export function buildPermissionMessage(req: EnginePermission, sessionTitle: string, entry: ButtonEntry): PermissionMessage {
  const md = req.metadata
  const file =
    typeof md.filepath === 'string'
      ? md.filepath
      : typeof md.filePath === 'string'
        ? md.filePath
        : typeof md.path === 'string'
          ? md.path
          : ''
  const description = typeof md.description === 'string' ? md.description : ''
  const main = permissionMainText(req)

  const head: string[] = [
    bold(t('telegram.msg.perm.title')),
    escapeHtml(t('telegram.msg.session', { title: '' })).trimEnd() + ' ' + `<i>${safeLine(sessionTitle || untitled())}</i>`,
    `${escapeHtml(t('telegram.msg.perm.what', { label: '' })).trimEnd()} <b>${safeLine(permissionLabel(req.permission), 120)}</b>`
  ]
  if (description) head.push(`<i>${safeLine(description, 200)}</i>`)
  if (file) head.push(`${escapeHtml(t('telegram.msg.perm.file', { file: '' })).trimEnd()} <code>${safeLine(file, 300)}</code>`)

  // Otros patrones que el permiso incluye (distintos del texto principal), pocos y cortos.
  const extra = req.patterns.filter((p) => p && p !== main.text && p !== file).slice(0, 5)
  const tail: string[] = []
  if (extra.length > 0 && main.kind !== 'list') {
    tail.push(
      `${escapeHtml(t('telegram.msg.perm.also', { items: '' })).trimEnd()} ${extra.map((p) => `<code>${safeLine(p, 120)}</code>`).join(', ')}`
    )
  }
  tail.push(`<i>${escapeHtml(t('telegram.msg.perm.footer', { minutes: Math.round(TELEGRAM_LIMITS.buttonTtlMs / 60_000) }))}</i>`)

  const fixed = head.join('\n') + '\n\n' + tail.join('\n')
  const overhead = fixed.length + '<pre></pre>'.length + 4
  const budget = Math.max(200, TELEGRAM_LIMITS.messageMax - STATUS_RESERVE - overhead)
  const max = main.kind === 'diff' ? Math.min(1600, TELEGRAM_LIMITS.commandMax) : TELEGRAM_LIMITS.commandMax
  const block = main.text ? safeBlock(main.text, { max, budget, omittedLabel: omitted }) : ''

  const body = head.join('\n') + (block ? `\n<pre>${block}</pre>` : '') + '\n\n' + tail.join('\n')
  return {
    body,
    markup: {
      inline_keyboard: [
        [
          { text: t('code.perm.once'), callback_data: ButtonBook.data(entry, 'a') },
          { text: t('code.perm.reject'), callback_data: ButtonBook.data(entry, 'r') }
        ]
      ]
    }
  }
}

/** El mismo mensaje con una línea de resultado al final y SIN botones (se usa con `editMessageText`). */
export function withStatus(body: string, statusKey: MsgKey): string {
  return `${body}\n\n<b>${escapeHtml(t(statusKey))}</b>`.slice(0, TELEGRAM_LIMITS.messageMax)
}

export function doneMessage(title: string): string {
  return escapeHtml(t('telegram.msg.done', { title: '\u0000' })).replace('\u0000', () => `<b>${safeLine(title || untitled())}</b>`)
}

export function questionMessage(title: string, question: string): string {
  const q = question ? safeBlock(question, { max: 700, budget: 1200 }) : ''
  return escapeHtml(t('telegram.msg.question', { title: '\u0000', question: '\u0001' }))
    .replace('\u0000', () => `<b>${safeLine(title || untitled())}</b>`)
    .replace('\u0001', () => q)
}

export function errorMessage(title: string, detail: string): string {
  const d = detail ? safeBlock(detail, { max: 500, budget: 900 }) : ''
  return escapeHtml(t('telegram.msg.error', { title: '\u0000', detail: '\u0001' }))
    .replace('\u0000', () => `<b>${safeLine(title || untitled())}</b>`)
    .replace('\u0001', () => `<pre>${d}</pre>`)
}

export function stuckMessage(title: string): string {
  return escapeHtml(t('telegram.msg.stuck', { title: '\u0000' })).replace('\u0000', () => `<b>${safeLine(title || untitled())}</b>`)
}

/** Texto fijo (sin datos de la sesión): se escapa y listo. */
export function plain(key: MsgKey, params?: Record<string, string | number>): string {
  return escapeHtml(t(key, params))
}

/**
 * Texto del diccionario con huecos reemplazados por HTML YA seguro (el llamador usa `safeLine`/`safeBlock` para cada valor).
 * El texto fijo se escapa; los valores entran después, así nada dinámico se escapa dos veces ni se queda sin escapar.
 */
export function fill(key: MsgKey, vars: Record<string, string>, params: Record<string, string | number> = {}): string {
  const marks: Record<string, string> = {}
  for (const k of Object.keys(vars)) marks[k] = `\u0001${k}\u0001`
  let out = escapeHtml(t(key, { ...params, ...marks }))
  for (const [k, v] of Object.entries(vars)) out = out.split(`\u0001${k}\u0001`).join(v)
  return out
}
