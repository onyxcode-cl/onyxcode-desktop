// Utilidades SOLO para tests de migraciones: userData sembrado en directorios temporales reales (nunca el real).
import { cpSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const FIXTURE = resolve(__dirname, '../../../e2e/fixtures/legacy-userdata')

const made: string[] = []

/** Directorio temporal nuevo (se limpia con `cleanTmp`). */
export function tmpDir(prefix = 'onyx-mig-'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(d)
  return d
}

/** userData tmp con el fixture de datos viejos copiado. */
export function seededUserData(): string {
  const d = tmpDir()
  cpSync(FIXTURE, d, { recursive: true })
  return d
}

export function cleanTmp(rm: (p: string) => void): void {
  for (const d of made.splice(0)) rm(d)
}

/** Foto exacta del árbol: ruta relativa → contenido (hex) o 'dir'. Permite excluir prefijos. */
export function snapshot(root: string, exclude: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name
      if (exclude.includes(r)) continue
      const st = lstatSync(join(root, r))
      if (st.isDirectory()) {
        out[r] = 'dir'
        walk(r)
      } else out[r] = readFileSync(join(root, r)).toString('hex')
    }
  }
  walk('')
  return out
}

export const readJson = (root: string, rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>
