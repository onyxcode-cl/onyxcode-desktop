import { memo, useEffect, useMemo, useState } from 'react'
import { createTwoFilesPatch } from 'diff'
import hljs from 'highlight.js/lib/common'
import { t } from '@shared/i18n'
import { useLang } from '../lib/i18n'

type LineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'file' | 'meta'

interface DiffLine {
  kind: LineKind
  text: string
  oldNo?: number
  newNo?: number
}

/** Parsea texto de diff unificado (uno o varios archivos) a líneas con numeración. */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('diff --git ') || raw.startsWith('Index: ')) {
      inHunk = false
      out.push({ kind: 'file', text: raw.replace(/^diff --git a\/(.*) b\/.*$/, '$1').replace(/^Index: /, '') })
      continue
    }
    if (
      !inHunk &&
      (raw.startsWith('--- ') ||
        raw.startsWith('+++ ') ||
        raw.startsWith('===') ||
        /^(index|new file|deleted file|old mode|new mode|similarity|rename|Binary)/.test(raw))
    ) {
      if (raw.startsWith('Binary')) out.push({ kind: 'meta', text: t('common.diff.binary') })
      else if (raw.startsWith('new file')) out.push({ kind: 'meta', text: t('common.diff.newFile') })
      else if (raw.startsWith('deleted file')) out.push({ kind: 'meta', text: t('common.diff.deletedFile') })
      continue
    }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (m) {
      inHunk = true
      oldNo = Number(m[1])
      newNo = Number(m[2])
      out.push({ kind: 'hunk', text: raw })
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1), newNo: newNo++ })
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++ })
    else if (raw.startsWith('\\')) out.push({ kind: 'meta', text: raw.slice(2) })
    else if (raw.startsWith(' ') || raw === '') {
      if (raw === '') continue
      out.push({ kind: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return out
}

/** Crea un diff unificado a partir de dos textos. */
export function makePatch(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, undefined, undefined, { context: 3 })
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

/**
 * Recorre las líneas de `patch` sin trocear ni crear objetos (un diff de 64 MB no asigna un array de líneas).
 * `visit(kind)` recibe 'add' | 'del' con la misma semántica que `parseUnifiedDiff`; si devuelve `true` se detiene.
 */
function scanChanges(patch: string, visit: (kind: 'add' | 'del') => boolean | void): void {
  let inHunk = false
  let start = 0
  const len = patch.length
  while (start <= len) {
    let end = patch.indexOf('\n', start)
    if (end === -1) end = len
    const c = patch.charCodeAt(start) // NaN en la línea vacía
    if (inHunk && c === 43 /* + */) {
      if (visit('add') === true) return
    } else if (inHunk && c === 45 /* - */) {
      if (visit('del') === true) return
    } else if (c === 100 /* d */ || c === 73 /* I */) {
      if (patch.startsWith('diff --git ', start) || patch.startsWith('Index: ', start)) inHunk = false
    } else if (c === 64 /* @ */ && patch.startsWith('@@ ', start)) {
      if (HUNK_RE.test(patch.slice(start, Math.min(end, start + 80)))) inHunk = true
    }
    start = end + 1
  }
}

/** Cifras +N −M exactas, contando sin parsear el diff completo (barato también para diffs enormes). */
export function diffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  scanChanges(patch, (k) => {
    if (k === 'add') additions++
    else deletions++
  })
  return { additions, deletions }
}

/** ¿Hay alguna línea añadida o borrada? Se detiene en la primera. */
export function hasDiffChanges(patch: string): boolean {
  let found = false
  scanChanges(patch, () => (found = true))
  return found
}

/** Lenguaje de highlight.js a partir de la extensión (o `null`). */
export function languageFor(path: string | undefined): string | null {
  if (!path) return null
  const name = path.split(/[/\\]/).pop() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  const alias: Record<string, string> = {
    mjs: 'javascript',
    cjs: 'javascript',
    mts: 'typescript',
    cts: 'typescript',
    vue: 'xml',
    svelte: 'xml',
    zsh: 'bash',
    toml: 'ini'
  }
  const lang = alias[ext] ?? ext
  return lang && hljs.getLanguage(lang) ? lang : null
}

export function highlightLine(text: string, lang: string | null): string | null {
  if (!lang || text.length > 2000) return null
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

const ROW: Record<LineKind, string> = {
  add: 'bg-[color-mix(in_srgb,var(--success)_13%,transparent)]',
  del: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]',
  ctx: '',
  hunk: 'bg-accent-soft/60 text-muted',
  file: 'bg-hover font-semibold text-fg',
  meta: 'text-subtle italic'
}

const SIGN: Record<LineKind, string> = { add: '+', del: '-', ctx: ' ', hunk: '', file: '', meta: '' }

interface Props {
  patch: string
  className?: string
  /** Oculta la cabecera por archivo (útil cuando ya se muestra el nombre fuera). */
  hideFileHeaders?: boolean
  /** Ruta del archivo (para el resaltado de sintaxis si el diff no trae cabecera). */
  path?: string
}

/** Tope de líneas y de bytes de un diff antes de ofrecer «Mostrar todo» (git admite hasta 64 MB). */
export const DIFF_MAX_LINES = 2000
export const DIFF_MAX_CHARS = 300_000
/** Líneas que se resaltan por trozo (entre trozos se cede el hilo para no crear tareas largas). */
const HL_CHUNK = 150

/** Recorta `patch` a ~`maxLines` líneas / `maxChars` caracteres (en límite de línea). `total` = líneas totales. */
export function clipPatch(
  patch: string,
  maxLines = DIFF_MAX_LINES,
  maxChars = DIFF_MAX_CHARS
): { text: string; total: number; shown: number; clipped: boolean } {
  let total = 1
  let cut = -1
  let pos = -1
  while ((pos = patch.indexOf('\n', pos + 1)) !== -1) {
    total++
    if (cut === -1 && (total > maxLines || pos > maxChars)) cut = pos
  }
  if (cut === -1 && patch.length > maxChars) cut = patch.lastIndexOf('\n', maxChars)
  if (cut === -1) return { text: patch, total, shown: total, clipped: false }
  const text = patch.slice(0, Math.max(cut, 0))
  return { text, total, shown: text.split('\n').length, clipped: true }
}

export const DiffView = memo(function DiffView({ patch, className = '', hideFileHeaders, path }: Props): React.JSX.Element {
  const lang = useLang((s) => s.lang)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [patch])
  const clip = useMemo(() => clipPatch(patch), [patch])
  const limited = clip.clipped && !showAll
  const parsed = useMemo(() => {
    void lang // los textos meta salen en el idioma activo: recalcular al cambiarlo
    return parseUnifiedDiff(limited ? clip.text : patch)
  }, [patch, clip, limited, lang])
  // Resaltado por trozos entre frames: primero se pinta texto plano y luego se colorea sin bloquear el hilo.
  // Sobre el umbral («Mostrar todo» de un diff grande) no se resalta.
  const [html, setHtml] = useState<{ key: unknown; rows: (string | null)[] }>({ key: null, rows: [] })
  const highlight = !clip.clipped
  useEffect(() => {
    if (!highlight) return
    const rows: (string | null)[] = new Array(parsed.length).fill(null)
    let cancelled = false
    let handle = 0
    let i = 0
    let hl = languageFor(path)
    const step = (): void => {
      if (cancelled) return
      const end = Math.min(i + HL_CHUNK, parsed.length)
      for (; i < end; i++) {
        const l = parsed[i]!
        if (l.kind === 'file') hl = languageFor(l.text) ?? languageFor(path)
        else if (l.kind === 'add' || l.kind === 'del' || l.kind === 'ctx') rows[i] = highlightLine(l.text, hl)
      }
      setHtml({ key: parsed, rows: rows.slice() })
      if (i < parsed.length) handle = window.setTimeout(step, 0)
    }
    handle = window.setTimeout(step, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [parsed, path, highlight])
  const lines = useMemo(
    () => parsed.map((l, i) => ({ ...l, html: highlight && html.key === parsed ? (html.rows[i] ?? null) : null })),
    [parsed, html, highlight]
  )
  if (lines.length === 0) {
    return <div className={`px-3 py-2 text-xs text-subtle ${className}`}>{t('common.diff.empty')}</div>
  }
  return (
    <div className={`overflow-auto font-mono text-[12px] leading-[1.55] ${className}`}>
      {limited && (
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-elevated px-3 py-2 font-sans text-xs text-muted">
          <span>{t('common.diff.truncated', { shown: clip.shown, total: clip.total })}</span>
          <button type="button" onClick={() => setShowAll(true)} className="rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover">
            {t('common.diff.showAll')}
          </button>
        </div>
      )}
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => {
            if (l.kind === 'file') {
              if (hideFileHeaders) return null
              return (
                <tr key={i} className={ROW.file}>
                  <td colSpan={4} className="sticky top-0 px-3 py-1 font-sans text-xs">
                    {l.text}
                  </td>
                </tr>
              )
            }
            if (l.kind === 'hunk' || l.kind === 'meta') {
              return (
                <tr key={i} className={ROW[l.kind]}>
                  <td colSpan={4} className="px-3 py-0.5 whitespace-pre">
                    {l.text}
                  </td>
                </tr>
              )
            }
            return (
              <tr key={i} className={ROW[l.kind]}>
                <td className="w-10 pr-2 text-right align-top text-subtle/70 select-none">{l.oldNo ?? ''}</td>
                <td className="w-10 pr-2 text-right align-top text-subtle/70 select-none">{l.newNo ?? ''}</td>
                <td
                  className={`w-4 align-top select-none ${l.kind === 'add' ? 'text-success' : l.kind === 'del' ? 'text-danger' : 'text-subtle'}`}
                >
                  {SIGN[l.kind]}
                </td>
                {l.html !== null ? (
                  <td className="pr-3 whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: l.html }} />
                ) : (
                  <td className="pr-3 whitespace-pre-wrap break-all">{l.text}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
