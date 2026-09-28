import { memo, useMemo } from 'react'
import { createTwoFilesPatch } from 'diff'

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
    if (!inHunk && (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('===') || /^(index|new file|deleted file|old mode|new mode|similarity|rename|Binary)/.test(raw))) {
      if (raw.startsWith('Binary')) out.push({ kind: 'meta', text: 'Archivo binario' })
      else if (raw.startsWith('new file')) out.push({ kind: 'meta', text: 'Archivo nuevo' })
      else if (raw.startsWith('deleted file')) out.push({ kind: 'meta', text: 'Archivo eliminado' })
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

export function diffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const l of parseUnifiedDiff(patch)) {
    if (l.kind === 'add') additions++
    else if (l.kind === 'del') deletions++
  }
  return { additions, deletions }
}

const ROW: Record<LineKind, string> = {
  add: 'bg-[color-mix(in_srgb,#22c55e_14%,transparent)]',
  del: 'bg-[color-mix(in_srgb,#ef4444_14%,transparent)]',
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
}

export const DiffView = memo(function DiffView({ patch, className = '', hideFileHeaders }: Props): React.JSX.Element {
  const lines = useMemo(() => parseUnifiedDiff(patch), [patch])
  if (lines.length === 0) {
    return <div className={`px-3 py-2 text-xs text-subtle ${className}`}>Sin diferencias.</div>
  }
  return (
    <div className={`overflow-auto font-mono text-[12px] leading-[1.55] ${className}`}>
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
                <td className="w-10 pr-2 text-right align-top text-subtle select-none">{l.oldNo ?? ''}</td>
                <td className="w-10 pr-2 text-right align-top text-subtle select-none">{l.newNo ?? ''}</td>
                <td
                  className={`w-4 align-top select-none ${l.kind === 'add' ? 'text-[#16a34a]' : l.kind === 'del' ? 'text-danger' : 'text-subtle'}`}
                >
                  {SIGN[l.kind]}
                </td>
                <td className="pr-3 whitespace-pre-wrap break-all">{l.text}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
