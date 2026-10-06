import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_NAME_ALLOWLIST, type LegacyException } from './legacy-name-allowlist'

/**
 * Guardia del renombre total a «Lazunox»: el nombre anterior no puede reaparecer en el repositorio (contenido de texto ni rutas)
 * salvo en las excepciones documentadas de `legacy-name-allowlist.ts`. Falla también si una excepción ya no cubre nada.
 */
const ROOT = resolve(__dirname, '../..')
const LEGACY = /onyx/i
const SKIP_EXT = new Set([
  '.png',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.dmg',
  '.pdf',
  '.node',
  '.wasm',
  '.tsbuildinfo'
])
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', 'coverage', 'test-results'])
const MAX_BYTES = 4 * 1024 * 1024

/** Archivos del repo (rutas con `/`): `git ls-files` (incluye los nuevos sin añadir) o, sin git, un recorrido del árbol. */
function listFiles(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024
    })
    return out.toString('utf8').split('\0').filter(Boolean)
  } catch {
    const acc: string[] = []
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(r)
        else acc.push(r)
      }
    }
    walk('')
    return acc
  }
}

function globToRegExp(glob: string): RegExp {
  const re = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('.*')
  return new RegExp(`^${re}$`)
}
const pathMatches = (e: LegacyException, file: string): boolean =>
  typeof e.path === 'string' ? globToRegExp(e.path).test(file) : e.path.test(file)

interface Finding {
  file: string
  line: number
  text: string
}

/** Quita lo cubierto por las excepciones que aplican al archivo; devuelve lo que queda con el nombre viejo y marca las usadas. */
function uncovered(file: string, text: string, used: Set<LegacyException>): boolean {
  let rest = text
  for (const e of LEGACY_NAME_ALLOWLIST) {
    if (!pathMatches(e, file)) continue
    if (!e.token) {
      used.add(e)
      return false
    }
    const g = new RegExp(e.token.source, e.token.flags.includes('g') ? e.token.flags : `${e.token.flags}g`)
    const next = rest.replace(g, '')
    if (next !== rest) used.add(e)
    rest = next
  }
  return LEGACY.test(rest)
}

function isText(abs: string, file: string): string | null {
  const dot = file.lastIndexOf('.')
  if (dot >= 0 && SKIP_EXT.has(file.slice(dot).toLowerCase())) return null
  let st
  try {
    st = lstatSync(abs)
  } catch {
    return null // borrado en el árbol de trabajo
  }
  if (!st.isFile() || st.size > MAX_BYTES) return null
  const buf = readFileSync(abs)
  if (buf.subarray(0, 8000).includes(0)) return null // binario
  return buf.toString('utf8')
}

describe('el nombre anterior no reaparece (identidad única Lazunox)', () => {
  const used = new Set<LegacyException>()
  const bad: Finding[] = []
  for (const file of listFiles()) {
    if (LEGACY.test(file) && uncovered(file, file, used)) bad.push({ file, line: 0, text: '(ruta)' })
    const text = isText(join(ROOT, file), file)
    if (text === null || !LEGACY.test(text)) continue
    text.split('\n').forEach((l, i) => {
      if (LEGACY.test(l) && uncovered(file, l, used)) bad.push({ file, line: i + 1, text: l.trim().slice(0, 140) })
    })
  }

  it('toda coincidencia está cubierta por una excepción de legacy-name-allowlist.ts', () => {
    const msg = bad.map((b) => `${b.file}${b.line ? `:${b.line}` : ''}  ${b.text}`)
    expect(
      msg,
      `Nombre anterior sin excepción: añade una excepción con motivo en src/test/legacy-name-allowlist.ts o renombra.\n${msg.join('\n')}`
    ).toEqual([])
  })

  it('ninguna excepción está obsoleta (todas cubren algo)', () => {
    const stale = LEGACY_NAME_ALLOWLIST.filter((e) => !used.has(e)).map(
      (e) => `${String(e.path)}${e.token ? ` ${String(e.token)}` : ''}: ${e.reason}`
    )
    expect(stale, 'Excepciones que ya no cubren nada: bórralas de src/test/legacy-name-allowlist.ts').toEqual([])
  })

  it('cada excepción explica su motivo', () => {
    for (const e of LEGACY_NAME_ALLOWLIST) expect(e.reason.length, String(e.path)).toBeGreaterThan(10)
  })
})
