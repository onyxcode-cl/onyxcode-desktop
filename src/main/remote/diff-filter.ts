/**
 * Filtro de diffs por nombre de archivo (hallazgo 1 de la auditoría del remoto): un diff trae el CONTENIDO del archivo, así que
 * `.env`, claves y demás archivos sensibles (`path-guard.ts`) no pueden salir en `GET /vcs/diff`, `/vcs/diff/raw`,
 * `/session/{id}/diff`, `/file/status`, `git:diff`, `summary.diffs` ni en el evento `session.diff`, aunque el motor los devuelva.
 * Funciones puras (salvo el `realpath` del nombre para ver enlaces); ante un nombre que no se puede interpretar, se descarta.
 */
import { resolve } from 'node:path'
import { isSensitiveEither, realpathLoose } from './path-guard'

/** ¿El archivo `rel` (relativo a `dir`, o absoluto) es sensible por su nombre léxico o real? */
export function sensitiveRel(dir: string, rel: string): boolean {
  if (typeof rel !== 'string' || rel.includes('\0')) return true
  const abs = resolve(dir, rel)
  return isSensitiveEither(abs, realpathLoose(abs))
}

const nameOf = (e: unknown): string | null => {
  const o = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : null
  if (!o) return null
  if (typeof o.file === 'string') return o.file
  if (typeof o.path === 'string') return o.path
  return null
}

/** Quita de una lista de `{file}` / `{path}` las entradas sensibles. Un elemento sin nombre que no sea objeto se conserva. */
export function dropSensitiveEntries(list: unknown[], dir: string): unknown[] {
  return list.filter((e) => {
    const n = nameOf(e)
    return n === null ? !(typeof e === 'object' && e !== null) : !sensitiveRel(dir, n)
  })
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)

/** Nombres que un bloque de diff dice tocar (cabecera, `---`/`+++`, renombrados y copias). `null` = cabecera ilegible. */
function blockNames(lines: string[]): string[] | null {
  const head = lines[0] ?? ''
  const out: string[] = []
  if (head.startsWith('diff --git ')) {
    const rest = head.slice('diff --git '.length)
    let found = false
    for (let i = 0; i < rest.length; i++) {
      if (!rest.startsWith(' b/', i) && !rest.startsWith(' "b/', i)) continue
      const a = unquote(rest.slice(0, i))
      const b = unquote(rest.slice(i + 1))
      if (a.startsWith('a/') && b.startsWith('b/')) {
        out.push(a.slice(2), b.slice(2))
        found = true
      }
    }
    if (!found) return null
  } else if (head.startsWith('diff --cc ') || head.startsWith('diff --combined ')) {
    out.push(unquote(head.slice(head.indexOf(' ', 7) + 1)))
  } else return null
  for (const l of lines.slice(1, 40)) {
    const m = /^(?:--- a\/|\+\+\+ b\/|rename from |rename to |copy from |copy to )(.+)$/.exec(l)
    if (m?.[1]) out.push(unquote(m[1]))
  }
  return out
}

/** Quita de un diff unificado (texto) los bloques de archivos sensibles. Un bloque con cabecera ilegible se descarta. */
export function filterRawDiff(text: string, dir: string): string {
  if (text === '') return text
  const lines = text.split('\n')
  const out: string[] = []
  let block: string[] | null = null
  const flush = (): void => {
    if (!block) return
    const names = blockNames(block)
    if (names !== null && !names.some((n) => sensitiveRel(dir, n))) out.push(...block)
    block = null
  }
  for (const l of lines) {
    if (l.startsWith('diff ')) {
      flush()
      block = [l]
    } else if (block) block.push(l)
    else out.push(l)
  }
  flush()
  return out.join('\n')
}

/**
 * Recorre un valor (mensaje, evento) y quita de las listas `diffs`/`diff` los archivos sensibles (`summary.diffs`,
 * `session.diff`). Devuelve una copia; no toca el original.
 */
export function scrubDiffLists(v: unknown, dir: string, depth = 0): unknown {
  if (depth > 8) return v
  if (Array.isArray(v)) return v.map((x) => scrubDiffLists(x, dir, depth + 1))
  if (v === null || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    out[k] = (k === 'diffs' || k === 'diff') && Array.isArray(x) ? dropSensitiveEntries(x, dir).map((y) => scrubDiffLists(y, dir, depth + 1)) : scrubDiffLists(x, dir, depth + 1)
  }
  return out
}
