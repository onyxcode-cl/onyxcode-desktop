/**
 * Guardia de ramas por plataforma (plan W10, sección E del plan de paridad Windows).
 *
 * Cuenta, por archivo de `src/main`, `src/renderer` y `src/shared` (sin pruebas), las apariciones de `'darwin'`, `'win32'`, `isMac`,
 * `/usr/bin/` y `/bin/sh`, y las compara con `platform-branches-allowlist.json`. Un archivo nuevo o una cuenta mayor que la permitida
 * hace fallar la prueba: significa que apareció una rama específica de una plataforma. Antes de regenerar la lista, añade la fila de
 * paridad en `docs/PARIDAD-WINDOWS.json` (estado y evidencia) y la prueba o el texto `.win` que haga falta.
 *
 * Regenerar la lista (solo después de haber añadido la fila): UPDATE_PLATFORM_BRANCHES=1 npx vitest run src/test/platform-branches.test.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const ALLOWLIST = resolve(__dirname, 'platform-branches-allowlist.json')
const DIRS = ['src/main', 'src/renderer', 'src/shared']

const KEYS = ['darwin', 'win32', 'isMac', 'usrBin', 'binSh'] as const
type Key = (typeof KEYS)[number]
type Counts = Partial<Record<Key, number>>

const PATTERNS: Record<Key, RegExp> = {
  darwin: /['"`]darwin['"`]/g,
  win32: /['"`]win32['"`]/g,
  isMac: /\bisMac\b/g,
  usrBin: /\/usr\/bin\//g,
  binSh: /\/bin\/sh\b/g
}

function isTest(rel: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(__tests__|__snapshots__|fixtures)\//.test(rel)
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.[cm]?[jt]sx?$/.test(name)) out.push(p)
  }
}

function countBranches(): Record<string, Counts> {
  const files: string[] = []
  for (const d of DIRS) walk(resolve(ROOT, d), files)
  const result: Record<string, Counts> = {}
  for (const f of files.sort()) {
    const rel = relative(ROOT, f).split('\\').join('/')
    if (isTest(rel)) continue
    const text = readFileSync(f, 'utf8')
    const c: Counts = {}
    for (const k of KEYS) {
      const n = text.match(PATTERNS[k])?.length ?? 0
      if (n > 0) c[k] = n
    }
    if (Object.keys(c).length > 0) result[rel] = c
  }
  return result
}

const HINT =
  'añade la fila de paridad en docs/PARIDAD-WINDOWS.json y regenera la lista (UPDATE_PLATFORM_BRANCHES=1 npx vitest run src/test/platform-branches.test.ts)'

describe('guardia de ramas por plataforma', () => {
  const actual = countBranches()

  if (process.env.UPDATE_PLATFORM_BRANCHES === '1') {
    it('regenera la lista permitida', () => {
      const sorted = Object.fromEntries(Object.entries(actual).sort(([a], [b]) => (a < b ? -1 : 1)))
      writeFileSync(
        ALLOWLIST,
        JSON.stringify(
          {
            _nota:
              'Cuenta permitida de ramas por plataforma por archivo (src/main, src/renderer y src/shared, sin pruebas). Claves: darwin y win32 = literales entre comillas, isMac, usrBin = /usr/bin/, binSh = /bin/sh. Se regenera con UPDATE_PLATFORM_BRANCHES=1 npx vitest run src/test/platform-branches.test.ts, solo después de añadir la fila de paridad en docs/PARIDAD-WINDOWS.json.',
            files: sorted
          },
          null,
          2
        ) + '\n'
      )
      expect(Object.keys(sorted).length).toBeGreaterThan(0)
    })
    return
  }

  const allowed = (JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as { files: Record<string, Counts> }).files

  it('ningún archivo nuevo trae ramas por plataforma sin estar en la lista', () => {
    const nuevos = Object.keys(actual).filter((f) => !(f in allowed))
    expect(nuevos, `Archivos con ramas por plataforma que no están en la lista permitida: ${nuevos.join(', ')}. ${HINT}`).toEqual([])
  })

  it('ninguna cuenta supera la permitida', () => {
    const excesos: string[] = []
    for (const [f, c] of Object.entries(actual)) {
      const a = allowed[f]
      if (!a) continue
      for (const k of KEYS) if ((c[k] ?? 0) > (a[k] ?? 0)) excesos.push(`${f}: ${k} ${c[k]} > ${a[k] ?? 0}`)
    }
    expect(excesos, `Más ramas por plataforma de las permitidas: ${excesos.join('; ')}. ${HINT}`).toEqual([])
  })
})
