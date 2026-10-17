/**
 * Exportar / copiar una conversación (Chat, Code y Tareas): generador PURO de Markdown y de HTML estático para PDF.
 * Lo usan el renderer (copiar al portapapeles) y main (guardar `.md` / `.pdf` con el diálogo nativo).
 *
 * Privacidad: TODO texto pasa por `redactForExport` antes de salir (claves y tokens con los patrones compartidos de
 * `redact-patterns.ts`, y las rutas con nombre de usuario `/Users/ana/…` → `~/…`). El HTML no lleva scripts, no cita recursos
 * externos y escapa todo lo que viene de la conversación (el Markdown del modelo nunca se inserta como HTML crudo).
 */
import { t } from './i18n'
import { maskSecretPatterns, REDACT_MASK } from './redact-patterns'

export type ExportPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  /** Una herramienta usada: solo nombre y un resumen de una línea (nunca su salida cruda). */
  | { kind: 'tool'; tool: string; detail: string }

export interface ExportTurn {
  role: 'user' | 'assistant'
  /** ms desde epoch. */
  at: number
  parts: ExportPart[]
  /** Nombres de los archivos adjuntos (solo nombres, sin rutas). */
  files: string[]
}

export interface ExportDoc {
  title: string
  /** ms desde epoch de la creación de la conversación. */
  createdAt: number
  /** Nombre del modelo (vacío si no se conoce). */
  model: string
  turns: ExportTurn[]
}

export interface ExportOptions {
  /** Incluir el razonamiento del modelo. */
  reasoning: boolean
  /** Incluir un resumen corto de las herramientas usadas. */
  tools: boolean
  /** Incluir los nombres de los archivos adjuntos. */
  attachments: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { reasoning: false, tools: true, attachments: true }

export const EXPORT_LIMITS = { turns: 5000, parts: 400, files: 50, text: 2_000_000, detail: 300, name: 200 } as const

export interface ExportResult {
  content: string
  /** Cuántas posibles claves se tacharon. */
  redactions: number
}

// ───────────────────────────── Redacción ─────────────────────────────

const HOME_PATH_RES: RegExp[] = [/\/(?:Users|home)\/[^/\s"'`<>:]+/g, /\b[A-Za-z]:\\Users\\[^\\\s"'`<>:]+/g]

function countMask(s: string): number {
  let n = 0
  for (let i = s.indexOf(REDACT_MASK); i >= 0; i = s.indexOf(REDACT_MASK, i + 1)) n++
  return n
}

/** Tacha claves/tokens y oculta el nombre de usuario de las rutas personales. Devuelve el texto y cuántas claves se tacharon. */
export function redactForExport(text: string): { text: string; count: number } {
  let out = text
  for (const re of HOME_PATH_RES) out = out.replace(re, '~')
  const before = countMask(out)
  const masked = maskSecretPatterns(out)
  return { text: masked, count: Math.max(0, countMask(masked) - before) }
}

class Redactor {
  count = 0
  r(text: string): string {
    const res = redactForExport(text)
    this.count += res.count
    return res.text
  }
}

// ───────────────────────────── Nombre de archivo ─────────────────────────────

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Nombre de archivo seguro para guardar: sin separadores de ruta, `..`, caracteres de control ni reservados de Windows, sin puntos
 * (la extensión la pone SIEMPRE esta función: un título «a.exe» queda «a-exe.md») y como mucho 80 letras de base.
 */
export function sanitizeExportFileName(raw: string, ext: 'md' | 'pdf', fallback = 'conversation'): string {
  let base = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\.+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 80)
    .trim()
  if (!base || WIN_RESERVED.test(base)) base = base ? `${base}-` : fallback
  return `${base}.${ext}`
}

// ───────────────────────────── Utilidades ─────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Group {
  role: 'user' | 'assistant'
  at: number
  blocks: { kind: 'text' | 'reasoning' | 'tools' | 'files'; text: string }[]
}

/** Redacta, filtra según las opciones y junta los turnos seguidos del mismo rol bajo un solo título. */
function prepare(doc: ExportDoc, opts: ExportOptions, red: Redactor): Group[] {
  const groups: Group[] = []
  for (const turn of doc.turns) {
    const blocks: Group['blocks'] = []
    let tools: string[] = []
    const flushTools = (): void => {
      if (tools.length) blocks.push({ kind: 'tools', text: tools.join('\n') })
      tools = []
    }
    for (const p of turn.parts) {
      if (p.kind === 'text') {
        flushTools()
        const text = red.r(p.text).trim()
        if (text) blocks.push({ kind: 'text', text })
      } else if (p.kind === 'reasoning') {
        if (!opts.reasoning) continue
        flushTools()
        const text = red.r(p.text).trim()
        if (text) blocks.push({ kind: 'reasoning', text })
      } else if (opts.tools) {
        const detail = red
          .r(p.detail)
          .replace(/[`\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        const short = detail.length > 120 ? `${detail.slice(0, 119)}…` : detail
        tools.push(t('conv.export.tool', { tool: red.r(p.tool).replace(/[`\s]+/g, ''), detail: short ? `: ${short}` : '' }))
      }
    }
    flushTools()
    if (opts.attachments && turn.files.length > 0) {
      blocks.push({ kind: 'files', text: t('conv.export.attachments', { files: turn.files.map((f) => red.r(f)).join(', ') }) })
    }
    if (blocks.length === 0) continue
    const last = groups[groups.length - 1]
    if (last && last.role === turn.role) last.blocks.push(...blocks)
    else groups.push({ role: turn.role, at: turn.at, blocks })
  }
  return groups
}

const roleLabel = (role: 'user' | 'assistant'): string => (role === 'user' ? t('conv.export.you') : t('conv.export.assistant'))

function headerMeta(doc: ExportDoc, red: Redactor): string[] {
  const meta = [t('conv.export.date', { value: stamp(doc.createdAt) })]
  const model = red.r(doc.model).trim()
  if (model) meta.push(t('conv.export.model', { value: model }))
  return meta
}

// ───────────────────────────── Markdown ─────────────────────────────

/** Markdown: título, fecha y modelo, y un `##` por turno. Los bloques de código y las tablas del texto se conservan tal cual. */
export function buildConversationMarkdown(doc: ExportDoc, opts: ExportOptions): ExportResult {
  const red = new Redactor()
  const title = red.r(doc.title).replace(/\s+/g, ' ').trim() || t('conv.export.untitled')
  const out: string[] = [`# ${title}`, '', ...headerMeta(doc, red).map((m) => `- ${m}`), '', '---', '']
  for (const g of prepare(doc, opts, red)) {
    out.push(`## ${roleLabel(g.role)} · ${stamp(g.at)}`, '')
    for (const b of g.blocks) {
      if (b.kind === 'reasoning') {
        const quoted = b.text.split('\n').map((l) => (l ? `> ${l}` : '>'))
        out.push(`> **${t('conv.export.reasoning')}**`, '>', ...quoted, '')
      } else if (b.kind === 'tools') {
        out.push(...b.text.split('\n').map((l) => `> ${l}`), '')
      } else if (b.kind === 'files') {
        out.push(`_${b.text}_`, '')
      } else out.push(b.text, '')
    }
  }
  return { content: `${out.join('\n').trimEnd()}\n`, redactions: red.count }
}

// ───────────────────────────── HTML estático (PDF) ─────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** CSP del documento exportado: sin scripts, sin red, solo estilos propios e imágenes `data:`. */
export const EXPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"

function inline(src: string): string {
  const parts = src.split(/`([^`\n]+)`/)
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(seg)}</code>`
      let s = escapeHtml(seg)
      s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => `<a href="${url}">${text}</a>`)
      s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\*)/g, '$1<em>$2</em>')
      s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      return s
    })
    .join('')
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]{0,30})[^\n]*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    /^\s{0,3}>/.test(line) ||
    LIST_RE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP_RE.test(next) && next.includes('-') && next.includes('|'))
  )
}

/** Markdown (el del modelo) → HTML escapado: títulos, párrafos, listas, citas, tablas, código con su lenguaje y énfasis. Sin HTML crudo. */
export function markdownToSafeHtml(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++
      out.push(
        `<figure class="code">${lang ? `<figcaption>${escapeHtml(lang)}</figcaption>` : ''}<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre></figure>`
      )
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) {
      out.push(`<h${Math.min(h[1].length + 2, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 6)}>`)
      i++
      continue
    }
    if (HR_RE.test(line)) {
      out.push('<hr>')
      i++
      continue
    }
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1]) &&
      lines[i + 1].includes('-') &&
      lines[i + 1].includes('|')
    ) {
      const head = splitRow(line)
      const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]))
      const cell = (tag: string, c: string, k: number): string =>
        `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</${tag}>`
      out.push(
        `<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_c, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      out.push(`<blockquote>${markdownToSafeHtml(body.join('\n'))}</blockquote>`)
      continue
    }
    if (LIST_RE.test(line)) {
      const stack: { indent: number; tag: 'ul' | 'ol' }[] = []
      const html: string[] = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i])
        if (!m) {
          // Continuación indentada del ítem anterior.
          if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && stack.length) {
            html.push(` ${inline(lines[i].trim())}`)
            i++
            continue
          }
          break
        }
        const indent = m[1].replace(/\t/g, '    ').length
        const tag = /\d/.test(m[2][0]) ? 'ol' : 'ul'
        while (stack.length && indent < stack[stack.length - 1].indent) html.push(`</li></${stack.pop()!.tag}>`)
        const top = stack[stack.length - 1]
        if (!top || indent > top.indent) {
          stack.push({ indent, tag })
          html.push(`<${tag}><li>`)
        } else html.push('</li><li>')
        html.push(inline(m[3]))
        i++
      }
      while (stack.length) html.push(`</li></${stack.pop()!.tag}>`)
      out.push(html.join(''))
      continue
    }
    const para: string[] = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++].trim())
    out.push(`<p>${para.map(inline).join('<br>')}</p>`)
  }
  return out.join('\n')
}

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1c1c1e; background: #fff; font: 10.5pt/1.5 -apple-system, "Segoe UI", system-ui, Helvetica, Arial, sans-serif; overflow-wrap: anywhere; }
h1 { font-size: 20pt; margin: 0 0 4pt; line-height: 1.25; }
.meta { margin: 0 0 14pt; padding: 0 0 8pt; list-style: none; color: #5b5b62; font-size: 9.5pt; border-bottom: 1px solid #d8d8de; }
.meta li { display: inline; margin-right: 14pt; }
section.turn { margin: 0 0 14pt; }
section.turn > h2 { font-size: 10pt; margin: 0 0 4pt; padding: 2pt 8pt; border-radius: 4pt; background: #eef0f6; color: #2b3a67; break-after: avoid; }
section.turn.assistant > h2 { background: #f1efe9; color: #4a3f24; }
section.turn > h2 time { font-weight: 400; opacity: .75; margin-left: 6pt; }
h3, h4, h5, h6 { margin: 10pt 0 4pt; line-height: 1.3; break-after: avoid; }
h3 { font-size: 13pt; } h4 { font-size: 11.5pt; } h5, h6 { font-size: 10.5pt; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
blockquote { margin: 0 0 7pt; padding: 3pt 10pt; border-left: 3px solid #c9cad3; color: #4b4b52; }
blockquote.reasoning, blockquote.tools { font-size: 9pt; color: #5b5b62; background: #f7f7f9; }
blockquote.reasoning > b { display: block; margin-bottom: 2pt; }
code { font: 9pt/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; background: #f1f1f4; padding: 0 3pt; border-radius: 3pt; }
figure.code { margin: 0 0 8pt; border: 1px solid #d8d8de; border-radius: 5pt; background: #f6f6f8; overflow: hidden; }
figure.code figcaption { padding: 2pt 8pt; font: 8pt ui-monospace, Menlo, Consolas, monospace; color: #5b5b62; background: #ececf1; border-bottom: 1px solid #d8d8de; }
figure.code pre { margin: 0; padding: 7pt 9pt; white-space: pre-wrap; overflow-wrap: anywhere; }
figure.code pre code { background: none; padding: 0; font-size: 8.8pt; }
table { border-collapse: collapse; margin: 0 0 8pt; width: 100%; font-size: 9.5pt; }
th, td { border: 1px solid #d0d0d8; padding: 3pt 6pt; vertical-align: top; text-align: left; }
th { background: #eef0f6; }
hr { border: 0; border-top: 1px solid #d8d8de; margin: 10pt 0; }
a { color: #1d4ed8; text-decoration: none; }
.files { color: #5b5b62; font-size: 9.5pt; font-style: italic; }
pre, table, blockquote, figure { break-inside: avoid-page; }
figure.code { break-inside: auto; }
`

/** Documento HTML COMPLETO y estático (sin scripts, con CSP estricta) para imprimir a PDF. */
export function buildConversationHtml(doc: ExportDoc, opts: ExportOptions, lang: 'es' | 'en' = 'es'): ExportResult {
  const red = new Redactor()
  const title = red.r(doc.title).replace(/\s+/g, ' ').trim() || t('conv.export.untitled')
  const body: string[] = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<ul class="meta">${headerMeta(doc, red)
      .map((m) => `<li>${escapeHtml(m)}</li>`)
      .join('')}</ul>`
  ]
  for (const g of prepare(doc, opts, red)) {
    body.push(`<section class="turn ${g.role}"><h2>${escapeHtml(roleLabel(g.role))}<time>${escapeHtml(stamp(g.at))}</time></h2>`)
    for (const b of g.blocks) {
      if (b.kind === 'text') body.push(markdownToSafeHtml(b.text))
      else if (b.kind === 'reasoning')
        body.push(
          `<blockquote class="reasoning"><b>${escapeHtml(t('conv.export.reasoning'))}</b>${markdownToSafeHtml(b.text)}</blockquote>`
        )
      else if (b.kind === 'tools')
        body.push(
          `<blockquote class="tools">${b.text
            .split('\n')
            .map((l) => `<div>${inline(l)}</div>`)
            .join('')}</blockquote>`
        )
      else body.push(`<p class="files">${escapeHtml(b.text)}</p>`)
    }
    body.push('</section>')
  }
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>
${body.join('\n')}
</body></html>`
  return { content: html, redactions: red.count }
}
