/**
 * Almacenamiento en disco de Control del PC en Windows (C4): el consentimiento de la app y el registro auditable. Son las
 * implementaciones con `node:fs` de las interfaces puras de `policy/consent-win.ts` y `policy/audit.ts`; sin Electron.
 *
 * El consentimiento NO va en `settings.json`: ese archivo se puede escribir desde el renderer (`settings:set`) y un
 * consentimiento que el propio renderer pudiera fabricar no valdría nada. Este archivo solo lo escribe `main`, por el canal
 * `computer:winConsent` (que exige la casilla y los 600 ms de armado, ver `ConsentController`).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AUDIT_FILE, AUDIT_FILES, parseAuditLines, type AuditEntry, type AuditFs } from './policy/audit'
import type { ConsentStore, WinConsent } from './policy/consent-win'

export const CONSENT_FILE = 'computer-win-consent.json'

/** Lectura que falla cerrado: archivo ausente o ilegible = `null` (sin consentimiento). Escritura atómica. */
export function createFileConsentStore(file: string): ConsentStore {
  return {
    read: () => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    write: (value: WinConsent | null) => {
      if (value === null) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, file)
    }
  }
}

export const nodeAuditFs: AuditFs = {
  size: (p) => {
    try {
      return statSync(p).size
    } catch {
      return 0
    }
  },
  append: (p, data) => appendFileSync(p, data, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  remove: (p) => rmSync(p, { force: true }),
  mkdirp: (d) => mkdirSync(d, { recursive: true })
}

/** Últimas `limit` entradas del registro, la más reciente primero (lee el archivo vigente y los rotados). */
export function readAuditEntries(dir: string, limit = 200): AuditEntry[] {
  const out: AuditEntry[] = []
  for (let i = 0; i < AUDIT_FILES && out.length < limit; i++) {
    const p = join(dir, i === 0 ? AUDIT_FILE : `${AUDIT_FILE}.${i}`)
    if (!existsSync(p)) continue
    try {
      out.push(...parseAuditLines(readFileSync(p, 'utf8')).reverse())
    } catch {
      /* archivo ilegible: se omite */
    }
  }
  return out.slice(0, limit)
}
