import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardia definitiva del renombrado: el nombre antiguo del modo Tareas no puede reaparecer en el
 * árbol PUBLICABLE, ni en el CONTENIDO de los ficheros ni en los NOMBRES de fichero/carpeta.
 * Los únicos sitios donde sigue existiendo están en `ALLOWLIST`, cada uno con su motivo.
 * (No se incluyen aquí otros alias de identidad: eso es del paso final «rellenar alias».)
 */

const ROOT = resolve(__dirname, '../..')
const TERM = /cowork/i

/** Directorios publicables que se recorren enteros (contenido y nombres). */
const PUBLISHED_DIRS = ['src', 'e2e', 'resources', 'scripts']

/** Ficheros sueltos de la raíz (patrones simples con `*`). */
const PUBLISHED_ROOT_FILES = [
  'package.json',
  'electron-builder.js',
  'electron.vite.config.ts',
  'vitest*.config.ts',
  'tsconfig*.json',
  'eslint.config.mjs',
  '.gitignore',
  'README.md',
  'DESIGN.md'
]

/** `package-lock.json` se trata aparte: solo sus campos propios, no las dependencias. */
const LOCK_FILE = 'package-lock.json'

/** Docs publicados. Los demás docs son proceso interno y no se publican. */
const PUBLISHED_DOCS = ['docs/SEGURIDAD.md', 'docs/VERIFICACION.md', 'docs/DISTRIBUCION.md']

/** Generados o de terceros: ni se publican ni los escribimos nosotros. */
const SKIPPED_DIRS = new Set(['node_modules', 'out', 'dist', '.git', '.artifacts'])

interface Allowed {
  /** Ruta relativa al repo; `**` al final = todo el subárbol; `*` = cualquier cosa sin `/` */
  path: string
  reason: string
}

const ALLOWLIST: Allowed[] = [
  {
    path: 'src/main/migrations/**',
    reason: 'Migraciones de userData: leen y transforman los nombres antiguos que dejó la versión anterior.'
  },
  {
    path: 'src/renderer/src/migrations/**',
    reason: 'Migración de localStorage: lee las claves antiguas del renderer.'
  },
  {
    path: 'e2e/fixtures/legacy-userdata/**',
    reason: 'Fixture de un userData de la versión anterior (nombres de fichero y contenido antiguos a propósito).'
  },
  {
    path: 'e2e/specs/legacy-data.e2e.ts',
    reason: 'E2E que siembra ese fixture y comprueba que la migración lo convierte.'
  },
  {
    path: 'src/main/tasks/legacy-cleanup*',
    reason: 'Borra una carpeta antigua del userData que dejó el navegador eliminado; debe nombrarla.'
  },
  {
    path: 'src/test/legacy-terms.test.ts',
    reason: 'Este test: contiene el término que busca.'
  }
]

function globToRe(glob: string): RegExp {
  const re = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('.*')
  return new RegExp('^' + re + '$')
}
const ALLOW_RES = ALLOWLIST.map((a) => globToRe(a.path))
const isAllowed = (rel: string): boolean => ALLOW_RES.some((re) => re.test(rel))

function isBinary(abs: string): boolean {
  const fd = openSync(abs, 'r')
  try {
    const buf = Buffer.alloc(8000)
    const n = readSync(fd, buf, 0, 8000, 0)
    return buf.subarray(0, n).includes(0)
  } finally {
    closeSync(fd)
  }
}

function walk(absDir: string, out: string[]): void {
  for (const name of readdirSync(absDir)) {
    if (SKIPPED_DIRS.has(name)) continue
    if (name === 'bin' && absDir.includes(`${join(ROOT, 'resources')}`)) continue // binarios compilados (gitignored)
    const abs = join(absDir, name)
    const st = statSync(abs)
    out.push(abs)
    if (st.isDirectory()) walk(abs, out)
  }
}

/** Todas las rutas (ficheros y carpetas) del árbol publicable. */
function publishedPaths(): string[] {
  const all: string[] = []
  for (const d of PUBLISHED_DIRS) walk(join(ROOT, d), all)
  const rootFiles = readdirSync(ROOT).filter((n) => PUBLISHED_ROOT_FILES.some((p) => globToRe(p).test(n)))
  for (const n of rootFiles) all.push(join(ROOT, n))
  for (const d of PUBLISHED_DOCS) all.push(join(ROOT, d))
  return all
}

function scanLock(): string[] {
  const lock = JSON.parse(readFileSync(join(ROOT, LOCK_FILE), 'utf8')) as {
    name?: string
    packages?: Record<string, { name?: string }>
  }
  const own = [
    ['name', lock.name ?? ''],
    ['packages[""].name', lock.packages?.['']?.name ?? '']
  ]
  return own.filter(([, v]) => TERM.test(v)).map(([k, v]) => `${LOCK_FILE} ${k}: ${v}`)
}

function scan(): string[] {
  const failures: string[] = []
  for (const abs of publishedPaths().sort()) {
    const rel = relative(ROOT, abs)
    if (isAllowed(rel)) continue
    if (TERM.test(rel)) {
      failures.push(`${rel}  [nombre de fichero o carpeta]`)
      continue
    }
    if (statSync(abs).isDirectory() || isBinary(abs)) continue
    readFileSync(abs, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (TERM.test(line)) failures.push(`${rel}:${i + 1} ${line.trim().slice(0, 120)}`)
      })
  }
  return [...failures, ...scanLock()]
}

describe('guardia de términos antiguos (renombrado a Tareas)', () => {
  it('el árbol publicable no contiene el nombre antiguo del modo, ni en contenido ni en nombres', () => {
    const failures = scan()
    expect(
      failures.join('\n'),
      'Usa `tasks`/«Tareas». Si el término es imprescindible (datos antiguos), agrégalo a ALLOWLIST con motivo.'
    ).toBe('')
  })

  it('la lista blanca solo apunta a rutas que existen', () => {
    for (const a of ALLOWLIST) {
      const base = a.path.replace(/\*.*$/, '')
      const dir = base.endsWith('/') ? base.slice(0, -1) : base.slice(0, base.lastIndexOf('/'))
      expect(() => statSync(join(ROOT, dir)), a.path).not.toThrow()
    }
  })
})
