import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { compareSemver, parseSemver } from '@shared/update-check'

/** Carpeta de trabajo del actualizador dentro de userData. */
export function updateDir(userData: string): string {
  return join(userData, 'update')
}

/**
 * Marcadores de arranque que lee swap.sh: `booting-<ver>` (PID de esta app) al empezar y `boot-ok-<ver>`
 * cuando la ventana principal cargó Y el renderer lo confirmó. Sin el lock de instancia única no se
 * escribe nada. En un build de prueba, `failBoot` impide escribir `boot-ok` (rollback forzado).
 */
export class BootMarkers {
  private isLoaded = false
  private isConfirmed = false
  private written = false

  constructor(
    private readonly dir: string,
    private readonly version: string,
    private readonly pid: number,
    private readonly failBoot = false
  ) {}

  begin(): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      writeFileSync(join(this.dir, `booting-${this.version}`), `${this.pid}\n`, { mode: 0o600 })
    } catch (err) {
      console.warn('[update] no se pudo escribir el marcador de arranque:', err)
    }
  }

  loaded(): void {
    this.isLoaded = true
    this.maybeWrite()
  }

  confirmed(): void {
    this.isConfirmed = true
    this.maybeWrite()
  }

  private maybeWrite(): void {
    if (this.written || !this.isLoaded || !this.isConfirmed) return
    if (this.failBoot) return
    this.written = true
    try {
      writeFileSync(join(this.dir, `boot-ok-${this.version}`), `${this.pid}\n`, { mode: 0o600 })
    } catch (err) {
      console.warn('[update] no se pudo escribir boot-ok:', err)
    }
  }
}

export interface SwapResult {
  version: string
  ok: boolean
  rolledBack: boolean
  error: string
}

/** Lee (y valida) el resultado que dejó swap.sh; null si no hay o no es válido. */
export function readSwapResult(dir: string): SwapResult | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as Record<string, unknown>
    if (typeof raw.version !== 'string' || raw.version.length > 64 || typeof raw.ok !== 'boolean' || typeof raw.rolledBack !== 'boolean')
      return null
    const error = typeof raw.error === 'string' ? raw.error.slice(0, 64) : ''
    return { version: raw.version, ok: raw.ok, rolledBack: raw.rolledBack, error }
  } catch {
    return null
  }
}

export function clearSwapResult(dir: string): void {
  rmSync(join(dir, 'result.json'), { force: true })
}

/**
 * Limpieza al iniciar. Si esta versión YA había arrancado bien en una sesión anterior (existe su
 * `boot-ok`), se borran las copias de seguridad y restos de intentos fallidos junto a la .app, los
 * marcadores de otras versiones, los stagings antiguos y los scripts copiados. Nunca lanza.
 */
export function cleanupAfterBoot(o: { dir: string; appPath: string | null; version: string }): { removed: string[] } {
  const removed: string[] = []
  const rm = (p: string): void => {
    try {
      rmSync(p, { recursive: true, force: true })
      removed.push(p)
    } catch {
      /* se reintenta en el próximo inicio */
    }
  }
  try {
    if (!existsSync(join(o.dir, `boot-ok-${o.version}`))) return { removed }
    if (o.appPath && basename(o.appPath) === 'OnyxCode.app') {
      const parent = dirname(o.appPath)
      for (const n of readdirSync(parent)) {
        if (/^\.OnyxCode\.app\.(bak|failed)-[0-9A-Za-z.+-]{1,64}$/.test(n)) rm(join(parent, n))
      }
    }
    for (const n of readdirSync(o.dir)) {
      const m = /^(booting|boot-ok)-(.+)$/.exec(n)
      if (m && m[2] !== o.version) rm(join(o.dir, n))
    }
    const cur = parseSemver(o.version)
    const staging = join(o.dir, 'staging')
    if (existsSync(staging)) {
      for (const n of readdirSync(staging)) {
        const v = parseSemver(n)
        if (!cur || !v || compareSemver(v, cur) <= 0) rm(join(staging, n))
      }
    }
    const run = join(o.dir, 'run')
    if (existsSync(run)) for (const n of readdirSync(run)) rm(join(run, n))
  } catch {
    /* sin limpieza esta vez */
  }
  return { removed }
}
