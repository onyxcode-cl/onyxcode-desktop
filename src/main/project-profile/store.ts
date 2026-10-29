/**
 * Ficha del proyecto: nivel de acceso de la IA y Bóveda de variables, POR CARPETA. Todo dentro de `userData`:
 *  - `project-profiles.json`: nombre y nivel de acceso por carpeta. Sin secretos.
 *  - `project-vault.bin`: la Bóveda (todas las carpetas), un solo bloque cifrado con el almacén seguro de la app (`safeStorage`).
 *    Sin cifrado disponible NO se guarda nada (no hay respaldo en texto plano).
 * Los valores solo salen de aquí hacia procesos de main (`envFor`); a la pantalla solo llegan los NOMBRES. Sin Electron: el almacén seguro se inyecta.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { SafeStorageLike } from '../remote/devices-store'
import type { LinkedFolderRule } from '@shared/permission-rules'
import { MAX_VARS_PER_PROJECT, NAME_RE, isForbiddenName, parseEnv } from './env-parse'
import { MAX_LINKED_FOLDERS } from './linked'
import { redactSecrets } from './redact'

export const PROFILES_FILE = 'project-profiles.json'
export const VAULT_FILE = 'project-vault.bin'

export type AccessLevel = 'aislado' | 'comandos' | 'total'
export const DEFAULT_ACCESS: AccessLevel = 'comandos'
const LEVELS: readonly AccessLevel[] = ['aislado', 'comandos', 'total']
export const isAccessLevel = (v: unknown): v is AccessLevel => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)

export interface ProjectProfile {
  name: string
  access: AccessLevel
}

export interface VaultSetResult {
  ok: boolean
  /** Nombres guardados o actualizados. */
  saved: string[]
  problems: string[]
  reason?: 'no-encryption' | 'too-many' | 'bad-folder'
}

type VaultData = Record<string, Record<string, string>>

function cleanLinked(v: unknown[]): LinkedFolderRule[] {
  const out: LinkedFolderRule[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.path === 'string' && o.path && (o.mode === 'rw' || o.mode === 'ro') && !out.some((l) => l.path === o.path)) {
      out.push({ path: o.path, mode: o.mode })
    }
  }
  return out.slice(0, MAX_LINKED_FOLDERS)
}

function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, file)
}

/** Clave estable de una carpeta (ruta absoluta normalizada; sin barra final). */
export function folderKey(folder: string): string {
  const r = resolve(folder)
  return r.length > 1 ? r.replace(/[\\/]+$/, '') : r
}

export class ProjectProfileStore {
  private profiles: Record<string, { name?: string; access?: AccessLevel; linked?: LinkedFolderRule[] }> | null = null
  private vault: VaultData | null = null

  constructor(
    private readonly dir: string,
    private readonly safe: SafeStorageLike
  ) {}

  private get profilesFile(): string {
    return join(this.dir, PROFILES_FILE)
  }
  private get vaultFile(): string {
    return join(this.dir, VAULT_FILE)
  }

  secureAvailable(): boolean {
    try {
      return this.safe.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  // ───────────── Perfil (nombre y acceso) ─────────────

  private loadProfiles(): Record<string, { name?: string; access?: AccessLevel; linked?: LinkedFolderRule[] }> {
    if (this.profiles) return this.profiles
    const out: Record<string, { name?: string; access?: AccessLevel; linked?: LinkedFolderRule[] }> = {}
    try {
      if (existsSync(this.profilesFile)) {
        const raw = JSON.parse(readFileSync(this.profilesFile, 'utf8')) as { profiles?: Record<string, unknown> }
        for (const [k, v] of Object.entries(raw.profiles ?? {})) {
          if (!v || typeof v !== 'object') continue
          const o = v as Record<string, unknown>
          out[k] = {
            ...(typeof o.name === 'string' ? { name: o.name.slice(0, 80) } : {}),
            ...(isAccessLevel(o.access) ? { access: o.access } : {}),
            ...(Array.isArray(o.linked) ? { linked: cleanLinked(o.linked) } : {})
          }
        }
      }
    } catch {
      // archivo ilegible: se parte de cero (el nivel por defecto es el de hoy)
    }
    this.profiles = out
    return out
  }

  private saveProfiles(): void {
    writeAtomic(this.profilesFile, JSON.stringify({ v: 1, profiles: this.loadProfiles() }, null, 2))
  }

  getProfile(folder: string): ProjectProfile {
    const p = this.loadProfiles()[folderKey(folder)]
    return { name: p?.name ?? '', access: p?.access ?? DEFAULT_ACCESS }
  }

  accessOf(folder: string): AccessLevel {
    return this.getProfile(folder).access
  }

  setAccess(folder: string, access: AccessLevel): boolean {
    if (!isAccessLevel(access)) return false
    const all = this.loadProfiles()
    const k = folderKey(folder)
    all[k] = { ...all[k], access }
    this.saveProfiles()
    return true
  }

  setName(folder: string, name: string): void {
    const all = this.loadProfiles()
    const k = folderKey(folder)
    const clean = String(name ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 80)
    all[k] = { ...all[k], ...(clean ? { name: clean } : {}) }
    if (!clean) delete all[k].name
    this.saveProfiles()
  }

  /** Carpetas añadidas al proyecto (la validación de la ruta la hace quien llama, `checkLinkedFolder`). */
  linkedOf(folder: string): LinkedFolderRule[] {
    return [...(this.loadProfiles()[folderKey(folder)]?.linked ?? [])]
  }

  addLinked(folder: string, path: string, mode: 'rw' | 'ro'): 'ok' | 'too-many' | 'duplicate' {
    const all = this.loadProfiles()
    const k = folderKey(folder)
    const cur = all[k]?.linked ?? []
    if (cur.some((l) => l.path === path)) return 'duplicate'
    if (cur.length >= MAX_LINKED_FOLDERS) return 'too-many'
    all[k] = { ...all[k], linked: [...cur, { path, mode }] }
    this.saveProfiles()
    return 'ok'
  }

  removeLinked(folder: string, path: string): boolean {
    const all = this.loadProfiles()
    const k = folderKey(folder)
    const cur = all[k]?.linked ?? []
    if (!cur.some((l) => l.path === path)) return false
    all[k] = { ...all[k], linked: cur.filter((l) => l.path !== path) }
    this.saveProfiles()
    return true
  }

  // ───────────── Bóveda ─────────────

  private loadVault(): VaultData {
    if (this.vault) return this.vault
    let data: VaultData = {}
    try {
      if (existsSync(this.vaultFile) && this.secureAvailable()) {
        const parsed = JSON.parse(this.safe.decryptString(readFileSync(this.vaultFile))) as unknown
        if (parsed && typeof parsed === 'object') {
          for (const [k, vars] of Object.entries(parsed as Record<string, unknown>)) {
            if (!vars || typeof vars !== 'object') continue
            const clean: Record<string, string> = {}
            for (const [n, v] of Object.entries(vars as Record<string, unknown>)) {
              if (NAME_RE.test(n) && !isForbiddenName(n) && typeof v === 'string') clean[n] = v
            }
            data[k] = clean
          }
        }
      }
    } catch {
      data = {} // bloque dañado o de otro equipo: no se descifra nada
    }
    this.vault = data
    return data
  }

  private saveVault(): boolean {
    if (!this.secureAvailable()) return false
    try {
      writeAtomic(this.vaultFile, this.safe.encryptString(JSON.stringify(this.loadVault())))
      return true
    } catch {
      return false
    }
  }

  /** Solo los NOMBRES (la pantalla nunca recibe valores). */
  vaultNames(folder: string): string[] {
    return Object.keys(this.loadVault()[folderKey(folder)] ?? {}).sort()
  }

  /** Agrega o actualiza variables desde texto en formato `.env`. Lo ya guardado se conserva. */
  vaultSet(folder: string, envText: string): VaultSetResult {
    if (typeof folder !== 'string' || folder.trim() === '') return { ok: false, saved: [], problems: [], reason: 'bad-folder' }
    if (!this.secureAvailable()) return { ok: false, saved: [], problems: [], reason: 'no-encryption' }
    const { vars, problems } = parseEnv(envText)
    const all = this.loadVault()
    const k = folderKey(folder)
    const merged = { ...(all[k] ?? {}), ...vars }
    if (Object.keys(merged).length > MAX_VARS_PER_PROJECT) return { ok: false, saved: [], problems, reason: 'too-many' }
    if (Object.keys(vars).length === 0) return { ok: true, saved: [], problems }
    const before = all[k]
    all[k] = merged
    if (!this.saveVault()) {
      if (before) all[k] = before
      else delete all[k]
      return { ok: false, saved: [], problems, reason: 'no-encryption' }
    }
    return { ok: true, saved: Object.keys(vars).sort(), problems }
  }

  vaultDelete(folder: string, name: string): boolean {
    const all = this.loadVault()
    const k = folderKey(folder)
    if (!all[k] || !(name in all[k])) return false
    delete all[k][name]
    if (Object.keys(all[k]).length === 0) delete all[k]
    return this.saveVault()
  }

  // ───────────── Uso interno de main ─────────────

  /** Variables de la carpeta para un proceso de main (comando aprobado, sesión de Code). NUNCA se devuelven a la pantalla ni a la IA. */
  envFor(folder: string): Record<string, string> {
    return { ...(this.loadVault()[folderKey(folder)] ?? {}) }
  }

  /** Tapa los valores de la Bóveda de esa carpeta en `text`. */
  redact(folder: string, text: string): string {
    return redactSecrets(text, this.loadVault()[folderKey(folder)] ?? {})
  }
}
