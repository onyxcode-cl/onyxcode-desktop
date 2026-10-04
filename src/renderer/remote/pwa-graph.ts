/**
 * Ayuda de pruebas (no se incluye en ninguna build): recorre el grafo de importaciones ESTÁTICAS que ve la PWA completa desde
 * `main.tsx`, aplicando los SWAPS como hace `pwa/vite.full.config.ts`, y extrae las claves de i18n que ese código puede pedir.
 * Los `import()` no se siguen (son los trozos perezosos); se devuelven aparte para recorrerlos por separado.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { SWAPS } from './swaps'

export const REPO = resolve(__dirname, '../../..')
const REMOTE = resolve(__dirname)
const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function resolveFile(base: string): string | null {
  for (const e of EXTS) {
    const f = base + e
    if (existsSync(f) && /\.(tsx?)$/.test(f)) return f
  }
  return null
}

export function rel(file: string): string {
  return relative(REPO, file).split(sep).join('/')
}

function target(importer: string, spec: string): string | null {
  const swapped = SWAPS[rel(importer)]?.[spec]
  if (swapped) return resolve(REMOTE, swapped)
  if (spec.startsWith('@renderer/')) return resolveFile(resolve(REPO, 'src/renderer/src', spec.slice(10)))
  if (spec.startsWith('@shared/')) return resolveFile(resolve(REPO, 'src/shared', spec.slice(8)))
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(importer), spec))
  return null // paquete
}

const STATIC_RE = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'"\n;]*?\sfrom\s*)?['"]([^'"]+)['"]/g
const MULTI_RE = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[\w$*{][^'";]*?\sfrom\s*['"]([^'"]+)['"]/g
const DYN_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g

export interface Graph {
  files: Set<string>
  dynamic: Set<string>
}

/** Cierre de importaciones estáticas desde `entries` (rutas absolutas). */
export function walk(entries: string[]): Graph {
  const files = new Set<string>()
  const dynamic = new Set<string>()
  const queue = [...entries]
  while (queue.length) {
    const f = queue.pop()!
    if (files.has(f)) continue
    files.add(f)
    const src = readFileSync(f, 'utf8')
    for (const re of [STATIC_RE, MULTI_RE]) {
      for (const m of src.matchAll(re)) {
        const t = target(f, m[1])
        if (t && !files.has(t)) queue.push(t)
      }
    }
    for (const m of src.matchAll(DYN_RE)) {
      const t = target(f, m[1])
      if (t) dynamic.add(t)
    }
  }
  return { files, dynamic }
}

const KEY_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/

/** Claves (y prefijos de claves dinámicas) que un archivo puede pedir. `all` = todas las claves del diccionario base. */
export function keysIn(src: string, all: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(/['"]([^'"\n]+)['"]/g)) if (KEY_RE.test(m[1]) && all.has(m[1])) out.add(m[1])
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    const body = m[1]
    if (KEY_RE.test(body) && all.has(body)) out.add(body)
  }
  const prefixes = new Set<string>()
  for (const m of src.matchAll(/`([a-z][A-Za-z0-9.-]*\.)\$\{/g)) prefixes.add(m[1])
  for (const m of src.matchAll(/['"]([a-z][A-Za-z0-9.-]*\.)['"]\s*\+/g)) prefixes.add(m[1])
  for (const p of prefixes) for (const k of all) if (k.startsWith(p)) out.add(k)
  return out
}
