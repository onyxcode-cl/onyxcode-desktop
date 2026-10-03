/**
 * Ámbito del celular y conocimiento que el proxy necesita para alimentar a `policy.ts` (F0-T4).
 *
 * - `ScopeProvider`: carpetas permitidas (Code recientes + Tareas aprobadas), de Chat y con Control total, siempre ya con
 *   `realpath` (la política es léxica: comparar rutas reales es lo que cierra el escape por enlace simbólico). Se vuelve a
 *   leer pasados unos segundos; `snapshot()` es síncrono para los eventos.
 * - `EngineKnowledge`: sesión → directorio real, permiso → tipo y modelos de `provider.list`, aprendidos de respuestas y
 *   eventos que YA pasaron el filtro. Lo desconocido se rechaza (la política trata un permiso desconocido como peligroso).
 */
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isInsideReal, realDirs, realpathLoose } from './path-guard'

export interface ScopeData {
  allowedDirs: readonly string[]
  chatDirs: readonly string[]
  fullAccessDirs: readonly string[]
}

export interface ScopeSnapshot {
  allowed: string[]
  chat: string[]
  full: string[]
}

export class ScopeProvider {
  private snap: ScopeSnapshot = { allowed: [], chat: [], full: [] }
  private at = -Infinity
  private loading: Promise<void> | null = null

  constructor(
    private readonly load: () => Promise<ScopeData>,
    private readonly ttlMs = 3_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Vuelve a leer si hace falta (o `force`). Nunca lanza: si falla se conserva lo último conocido. */
  refresh(force = false): Promise<void> {
    if (!force && this.now() - this.at < this.ttlMs) return Promise.resolve()
    this.loading ??= this.load()
      .then((d) => {
        this.snap = { allowed: realDirs(d.allowedDirs), chat: realDirs(d.chatDirs), full: realDirs(d.fullAccessDirs) }
        this.at = this.now()
      })
      .catch(() => {
        /* se conserva la lectura anterior */
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  async get(): Promise<ScopeSnapshot> {
    await this.refresh()
    return this.snap
  }

  /** Última lectura (síncrona; para los eventos). Dispara una relectura en segundo plano si caducó. */
  snapshot(): ScopeSnapshot {
    if (this.now() - this.at >= this.ttlMs) void this.refresh()
    return this.snap
  }

  /** ¿`real` (ruta ya resuelta) está en alguna carpeta de Code/Tareas o de Chat? */
  inScope(real: string, opts: { chat?: boolean } = {}): boolean {
    const s = this.snapshot()
    const dirs = opts.chat === false ? s.allowed : [...s.allowed, ...s.chat]
    return dirs.some((d) => isInsideReal(d, real))
  }

  /** Como `inScope` pero resolviendo enlaces simbólicos de `p` (ruta absoluta cualquiera). */
  pathInScope(p: unknown, opts: { chat?: boolean } = {}): boolean {
    if (typeof p !== 'string' || !isAbsolute(p)) return false
    const real = realpathLoose(p)
    return real !== null && this.inScope(real, opts)
  }
}

const MAX_SESSIONS = 4_000
const MAX_PERMS = 2_000
const MODELS_TTL_MS = 60_000

/** Conocimiento aprendido del motor (solo de datos ya filtrados por ámbito). */
export class EngineKnowledge {
  private readonly sessions = new Map<string, string>()
  private readonly perms = new Map<string, string>()
  private models: { set: Set<string>; at: number } | null = null

  constructor(private readonly now: () => number = Date.now) {}

  learnSession(id: unknown, realDir: string): void {
    if (typeof id !== 'string' || id === '') return
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(id)) this.sessions.delete(this.sessions.keys().next().value as string)
    this.sessions.set(id, realDir)
  }

  forgetSession(id: string): void {
    this.sessions.delete(id)
  }

  sessionDir(id: string): string | undefined {
    return this.sessions.get(id)
  }

  learnPermission(id: unknown, kind: unknown): void {
    if (typeof id !== 'string' || id === '' || typeof kind !== 'string') return
    if (this.perms.size >= MAX_PERMS && !this.perms.has(id)) this.perms.delete(this.perms.keys().next().value as string)
    this.perms.set(id, kind)
  }

  permissionKind(id: string): string | undefined {
    return this.perms.get(id)
  }

  setModels(set: Set<string>): void {
    this.models = { set, at: this.now() }
  }

  modelsFresh(): boolean {
    return !!this.models && this.now() - this.models.at < MODELS_TTL_MS
  }

  knownModels(): ReadonlySet<string> | undefined {
    return this.models?.set
  }
}

/** `providerID/modelID` de las respuestas de `provider.list` (solo proveedores conectados). */
export function modelsFromProviderList(data: unknown): Set<string> {
  const out = new Set<string>()
  const o = (typeof data === 'object' && data !== null ? data : {}) as { all?: unknown; connected?: unknown }
  const connected = new Set(Array.isArray(o.connected) ? o.connected.filter((x): x is string => typeof x === 'string') : [])
  for (const p of Array.isArray(o.all) ? o.all : []) {
    const pr = (typeof p === 'object' && p !== null ? p : {}) as { id?: unknown; models?: unknown }
    if (typeof pr.id !== 'string' || !connected.has(pr.id)) continue
    if (typeof pr.models === 'object' && pr.models !== null) for (const m of Object.keys(pr.models)) out.add(`${pr.id}/${m}`)
  }
  return out
}

/** ¿Es una carpeta existente? (`undefined` = no se sabe). */
export function isDirectorySync(abs: string): boolean | undefined {
  const real = realpathLoose(abs)
  if (!real) return undefined
  try {
    return statSync(real).isDirectory()
  } catch {
    return undefined
  }
}
