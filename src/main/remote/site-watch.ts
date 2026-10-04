/**
 * Vigilancia del sitio del control remoto («También fuera de casa»). Al activar el modo nube y cada 6 h, el Mac descarga
 * `site-manifest.json` y su firma, verifica la firma Ed25519 con `SITE_PUBLIC_KEY` (la clave del dueño, que no está en CI ni en
 * Cloudflare) y compara el sha256 de cada archivo del arranque y la CSP de `index.html` con lo firmado.
 *
 *  - `ok`: todo cuadra.
 *  - `mismatch`: la firma no verifica, el manifiesto retrocede o cambia de clave, falta o difiere un archivo del arranque, o la CSP
 *    no es la firmada. El modo nube se PAUSA (rechaza conexiones por la nube; la red local sigue) hasta que vuelva a cuadrar.
 *  - `unknown`: no hay clave configurada (`SITE_PUBLIC_KEY` vacía) o no se pudo comprobar (sin red): el modo nube funciona y
 *    Ajustes avisa «sin verificar». Un fallo de red NO pausa nada (no es una prueba de manipulación) y se reintenta pronto.
 *
 * Alcance honesto: detecta una manipulación no dirigida del sitio. No detecta una versión distinta servida solo al celular (quien
 * controle el borde de Cloudflare podría hacerlo) ni protege de un arranque malicioso: ver docs/SEGURIDAD.md.
 * `fetch` y los relojes se inyectan: las pruebas nunca tocan la red.
 */
import { createHash } from 'node:crypto'
import { CLOUD_ORIGIN } from '@shared/remote/cloud'
import {
  SITE_FILE_MAX_BYTES,
  SITE_MANIFEST_MAX_BYTES,
  SITE_MANIFEST_PATH,
  SITE_SIGNATURE_PATH,
  parseSiteManifest,
  type SiteManifest
} from '@shared/remote/site-manifest'
import { verifyEd25519 } from '../update/signature'

export type SiteState = 'ok' | 'mismatch' | 'unknown'

export interface SiteResponse {
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}
export type SiteFetch = (
  url: string,
  init: { redirect: 'error'; cache: 'no-store'; credentials: 'omit'; signal?: AbortSignal }
) => Promise<SiteResponse>

export interface SiteWatchOptions {
  /** Origen del sitio (por defecto el oficial; las pruebas lo cambian). */
  origin?: string
  /** `SITE_PUBLIC_KEY` de brand.ts (vacía = `unknown`, sin red). */
  publicKey: string
  /** `SITE_KEY_ID` de brand.ts: el manifiesto debe nombrar esta clave. */
  keyId: string
  fetch: SiteFetch
  /** Último `seq` aceptado (persistido): un manifiesto con uno menor es un retroceso. */
  getMinSeq: () => number
  setMinSeq: (seq: number) => void
  /** Cambió el estado (para refrescar Ajustes y reabrir/cerrar el enlace con el servicio). */
  onChange?: (state: SiteState, prev: SiteState) => void
  /** Auditoría sin secretos (`site-mismatch`/`site-restored`, con un motivo fijo). */
  audit?: (e: { kind: 'site-mismatch' | 'site-restored'; why?: string }) => void
  timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
  /** Cada cuánto se vuelve a comprobar con todo en orden (6 h). */
  intervalMs?: number
  /** Cada cuánto se reintenta tras un fallo de red o un desajuste (15 min). */
  retryMs?: number
  timeoutMs?: number
}

export const SITE_CHECK_EVERY_MS = 6 * 60 * 60_000
export const SITE_RETRY_MS = 15 * 60_000

const REAL_TIMERS = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
}
const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

class Mismatch extends Error {
  constructor(readonly why: string) {
    super(why)
  }
}
class Unreachable extends Error {}

export class SiteWatch {
  private st: SiteState = 'unknown'
  private timer: unknown = null
  private running = false
  private inFlight: Promise<SiteState> | null = null
  private readonly timers: NonNullable<SiteWatchOptions['timers']>

  constructor(private readonly o: SiteWatchOptions) {
    this.timers = o.timers ?? REAL_TIMERS
  }

  state(): SiteState {
    return this.st
  }

  /** `true` = el sitio no coincide con lo firmado: el modo nube rechaza conexiones. */
  paused(): boolean {
    return this.st === 'mismatch'
  }

  /** Empieza a vigilar (comprueba ya y luego cada 6 h). Solo se llama con el modo nube en marcha: en la red local no se usa. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.cycle()
  }

  stop(): void {
    this.running = false
    if (this.timer) this.timers.clear(this.timer)
    this.timer = null
    // Apagado el modo nube, no queda estado que mostrar ni pausa que aplicar.
    this.setState('unknown', null)
  }

  private async cycle(): Promise<void> {
    const s = await this.check()
    if (!this.running) return
    this.timer = this.timers.set(
      () => void this.cycle(),
      s === 'ok' || (s === 'unknown' && !this.o.publicKey) ? (this.o.intervalMs ?? SITE_CHECK_EVERY_MS) : (this.o.retryMs ?? SITE_RETRY_MS)
    )
  }

  /** Una comprobación. Nunca lanza. */
  check(): Promise<SiteState> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(): Promise<SiteState> {
    if (!this.o.publicKey) {
      this.setState('unknown', null)
      return 'unknown'
    }
    try {
      await this.verify()
      this.setState('ok', null)
    } catch (e) {
      if (e instanceof Mismatch) this.setState('mismatch', e.why)
      else this.setState('unknown', null) // sin red o respuesta rara del servidor: no es una prueba de manipulación
    }
    return this.st
  }

  private setState(next: SiteState, why: string | null): void {
    const prev = this.st
    if (next === prev) return
    this.st = next
    if (next === 'mismatch') this.o.audit?.({ kind: 'site-mismatch', ...(why ? { why } : {}) })
    else if (prev === 'mismatch' && next === 'ok') this.o.audit?.({ kind: 'site-restored' })
    this.o.onChange?.(next, prev)
  }

  private async get(path: string, max: number): Promise<{ bytes: Uint8Array; res: SiteResponse }> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? this.timers.set(() => ctl.abort(), this.o.timeoutMs ?? 15_000) : null
    try {
      // La página se pide en la raíz (el sitio redirige `/index.html` a `/` y aquí no se siguen redirecciones).
      const res = await this.o.fetch(`${this.o.origin ?? CLOUD_ORIGIN}/${path === 'index.html' ? '' : path.replace(/^\//, '')}`, {
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        ...(ctl ? { signal: ctl.signal } : {})
      })
      // 404 de un archivo que el manifiesto firmado pide = el sitio no es el firmado; el resto de fallos, sin pruebas.
      if (res.status === 404) throw new Mismatch('file-missing')
      if (res.status !== 200) throw new Unreachable()
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length > max) throw new Mismatch('file-too-large')
      return { bytes: buf, res }
    } catch (e) {
      if (e instanceof Mismatch) throw e
      throw new Unreachable()
    } finally {
      if (timer) this.timers.clear(timer)
    }
  }

  private async verify(): Promise<void> {
    const man = await this.get(SITE_MANIFEST_PATH, SITE_MANIFEST_MAX_BYTES).catch((e) => {
      // Sin manifiesto (404) con clave configurada: el sitio no está firmado.
      throw e instanceof Mismatch ? new Mismatch('no-manifest') : e
    })
    const sig = await this.get(SITE_SIGNATURE_PATH, 1024).catch((e) => {
      throw e instanceof Mismatch ? new Mismatch('no-signature') : e
    })
    // La firma manda: se verifica sobre los bytes exactos ANTES de interpretar el JSON.
    if (!verifyEd25519(man.bytes, new TextDecoder().decode(sig.bytes), this.o.publicKey)) throw new Mismatch('bad-signature')
    const m: SiteManifest | null = parseSiteManifest(new TextDecoder().decode(man.bytes))
    if (!m) throw new Mismatch('manifest-shape')
    if (m.keyId !== this.o.keyId) throw new Mismatch('key-id')
    if (m.seq < this.o.getMinSeq()) throw new Mismatch('rollback')
    const want = new Map(m.files.map((f) => [f.p, f.sha256]))
    for (const p of m.startup) {
      const { bytes, res } = await this.get(p, SITE_FILE_MAX_BYTES)
      if (sha256Hex(bytes) !== want.get(p)) throw new Mismatch('file-hash')
      // La CSP que sirve el sitio en la página (no en el manifiesto) tiene que ser la firmada.
      if (p === 'index.html' && res.headers.get('content-security-policy') !== m.csp) throw new Mismatch('csp')
    }
    if (m.seq > this.o.getMinSeq()) this.o.setMinSeq(m.seq)
  }
}
