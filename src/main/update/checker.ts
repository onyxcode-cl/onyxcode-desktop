import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_NAME } from '@shared/brand'
import {
  compareSemver,
  isNewerRelease,
  nextCheckDue,
  parseReleaseJson,
  parseRetryAfter,
  parseSemver,
  releasesApiUrl,
  safeReleaseUrl,
  type Semver,
  type UpdateState
} from '@shared/update-check'
import type { UpdateConfig } from './config'

const HOUR_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 256 * 1024

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface UpdateCheckerDeps {
  fetch: FetchLike
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  currentVersion: string
  config: UpdateConfig
  isEnabled: () => boolean
  stateFile: string
  onState: (state: UpdateState) => void
}

interface Persisted {
  lastCheck: number | null
  retryAfter: number | null
  dismissed: string | null
}

function fmt(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre.join('.')}` : ''}`
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Lee el cuerpo con tope de tamaño (corta la lectura al pasarse). */
async function readLimited(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    return Buffer.byteLength(text) > MAX_BODY_BYTES ? null : text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Aviso NO bloqueante de versión nueva: una petición GET sin autenticar a la API pública de
 * GitHub como mucho cada 24 h. No descarga ni instala nada.
 */
export class UpdateChecker {
  private saved: Persisted
  private latest: { version: string; url: string } | null = null
  private inflight: Promise<UpdateState> | null = null

  constructor(private readonly d: UpdateCheckerDeps) {
    this.saved = this.load()
  }

  /** Programa la comprobación automática tras `startDelayMs` (no hace nada si no está configurado). */
  start(): void {
    if (!this.d.config.configured) return
    this.d.setTimeout(() => void this.check(false), this.d.config.startDelayMs)
  }

  getState(): UpdateState {
    const enabled = this.d.isEnabled()
    const configured = this.d.config.configured
    const latest = configured && enabled ? this.latest : null
    let hidden = false
    if (latest && this.saved.dismissed) {
      const l = parseSemver(latest.version)
      const x = parseSemver(this.saved.dismissed)
      hidden = !!l && !!x && compareSemver(l, x) <= 0
    }
    return {
      available: latest !== null && !hidden,
      configured,
      enabled,
      current: this.d.currentVersion,
      latest,
      dismissed: this.saved.dismissed,
      lastCheck: this.saved.lastCheck,
      checking: this.inflight !== null
    }
  }

  /** Reemite el estado actual (p.ej. al cambiar el ajuste). */
  refresh(): void {
    this.d.onState(this.getState())
  }

  dismiss(version: string): UpdateState {
    const v = parseSemver(version)
    if (v) {
      this.saved = { ...this.saved, dismissed: fmt(v) }
      this.persist()
      this.refresh()
    }
    return this.getState()
  }

  check(manual: boolean): Promise<UpdateState> {
    if (this.inflight) return this.inflight
    if (!this.d.config.configured || !this.d.isEnabled()) return Promise.resolve(this.getState())
    if (!nextCheckDue({ now: this.d.now(), lastCheck: this.saved.lastCheck, retryAfter: this.saved.retryAfter, manual })) {
      return Promise.resolve(this.getState())
    }
    const p = this.run().then(() => {
      this.inflight = null
      this.refresh()
      return this.getState()
    })
    this.inflight = p
    this.refresh()
    return p
  }

  private async run(): Promise<UpdateState> {
    const { config } = this.d
    try {
      const res = await this.d.fetch(releasesApiUrl(config.repo, config.apiBase), {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `${APP_NAME}/${this.d.currentVersion}`
        },
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      // Ajuste apagado mientras volaba la petición: el resultado se descarta.
      if (!this.d.isEnabled()) return this.getState()
      const now = this.d.now()
      if (res.status === 200) {
        const body = await readLimited(res)
        if (!this.d.isEnabled()) return this.getState()
        const rel = body === null ? null : parseReleaseJson(JSON.parse(body))
        if (!rel) {
          this.fail(now, 'respuesta inválida')
          return this.getState()
        }
        const newer = isNewerRelease({ tag: rel.tag, prerelease: rel.prerelease, draft: rel.draft }, this.d.currentVersion)
        const parsed = parseSemver(rel.tag)
        this.latest = newer && parsed ? { version: fmt(parsed), url: safeReleaseUrl(rel.url, config.repo, rel.tag) } : null
        this.saved = { ...this.saved, lastCheck: now, retryAfter: null }
        this.persist()
      } else if (res.status === 404) {
        // Sin releases publicadas todavía.
        this.latest = null
        this.saved = { ...this.saved, lastCheck: now, retryAfter: null }
        this.persist()
      } else if (res.status === 403 || res.status === 429) {
        console.warn(`[update] GitHub respondió ${res.status}`)
        this.saved = { ...this.saved, retryAfter: parseRetryAfter(res.headers, now) }
        this.persist()
      } else {
        this.fail(now, `HTTP ${res.status}`)
      }
    } catch {
      if (this.d.isEnabled()) this.fail(this.d.now(), 'sin conexión')
    }
    return this.getState()
  }

  private fail(now: number, why: string): void {
    console.warn(`[update] no se pudo comprobar (${why})`)
    this.saved = { ...this.saved, retryAfter: now + HOUR_MS }
    this.persist()
  }

  private load(): Persisted {
    const empty: Persisted = { lastCheck: null, retryAfter: null, dismissed: null }
    try {
      if (!existsSync(this.d.stateFile)) return empty
      const raw = JSON.parse(readFileSync(this.d.stateFile, 'utf8')) as Record<string, unknown>
      const dismissed = typeof raw.dismissed === 'string' && parseSemver(raw.dismissed) ? raw.dismissed : null
      return { lastCheck: numOrNull(raw.lastCheck), retryAfter: numOrNull(raw.retryAfter), dismissed }
    } catch {
      return empty
    }
  }

  private persist(): void {
    try {
      const file = this.d.stateFile
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.saved, null, 2), 'utf8')
      renameSync(tmp, file)
    } catch {
      console.warn('[update] no se pudo guardar el estado')
    }
  }
}
