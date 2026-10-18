/**
 * Servicio de DeckCraft de la app (presentaciones con diseño premium, OPCIONAL). Estado + instalación bajo demanda (`craft-install.ts`;
 * el botón de Ajustes ES el consentimiento) + variable de entorno `LAZUNOX_DECKCRAFT` para los motores de OpenCode, de modo que la
 * skill `pptx` use el diseño «dots» solo si el programa ya está instalado (si no, sigue con `build_pptx.py`).
 */
import { app, net } from 'electron'
import { join } from 'node:path'
import type { CraftInstallResult, CraftUiSnapshot } from '@shared/craft'
import { unpacked } from '../../util/asar'
import { createManualFetch, type NetLike } from '../../remote/tunnel/manual-fetch'
import { toOfficeError } from '../download'
import { recordCraftProblem } from './craft-problems'
import { readAttempt, retryIncompleteInstall, writeAttempt, type RetryOutcome } from './craft-retry'
import {
  clearCraftCheckCache,
  craftInspect,
  craftStatus,
  craftWebDir,
  installCraft,
  loadCraftPin,
  removeCraft,
  type CraftDeps,
  type CraftStatus
} from './craft-install'
import type { CraftCheck } from '../../preflight/service'

type Progress = NonNullable<CraftUiSnapshot['progress']>

class CraftService {
  private installing: AbortController | null = null
  private progress: Progress | undefined
  private error: string | undefined

  private deps(): CraftDeps {
    return {
      binDir: join(app.getPath('userData'), 'bin'),
      pin: loadCraftPin(unpacked(join(app.getAppPath(), 'resources', 'craft', 'pin.json'))),
      // La pila de red de Electron (proxy del sistema, certificados del Llavero); el `fetch` de Node las ignora. Cada salto de
      // redirección lo valida `downloadVerified` (https, tamaño, SHA-256), igual que antes.
      fetch: createManualFetch(net as unknown as NetLike)
    }
  }

  private statePath(): string {
    return join(app.getPath('userData'), 'bin', 'craft-intento.json')
  }

  private mark(last: 'started' | 'ok' | 'failed' | 'cancelled'): void {
    writeAttempt(this.statePath(), { ...readAttempt(this.statePath()), last })
  }

  status(): CraftStatus {
    return craftStatus(this.deps())
  }

  /** Revisión de arranque: estado + pieza a pieza (3 CLI y las webs) sin caché del recorrido de las webs. Solo disco. */
  check(): CraftCheck {
    clearCraftCheckCache()
    const s = this.status()
    const parts = craftInspect(this.deps())
    if (s.state === 'unsupported') return { state: 'unsupported', parts }
    if (s.state === 'missing') return { state: 'missing', version: s.version, sizeBytes: s.sizeBytes, parts }
    return { state: 'installed', version: s.version, parts }
  }

  snapshot(): CraftUiSnapshot {
    const s = this.status()
    const status = s.state === 'installed' ? ({ state: 'installed', version: s.version } as const) : s
    return { status, installing: this.installing !== null, progress: this.installing ? this.progress : undefined, error: this.error }
  }

  async installNow(): Promise<CraftInstallResult> {
    if (this.installing) return { ok: false, error: 'busy', message: 'Ya hay una instalación en curso' }
    this.error = undefined
    const ac = new AbortController()
    this.installing = ac
    this.mark('started')
    try {
      await installCraft(this.deps(), (p) => (this.progress = p), ac.signal)
      this.mark('ok')
      return { ok: true }
    } catch (e) {
      const code = toOfficeError(e).code
      this.error = code
      this.mark(code === 'cancelled' ? 'cancelled' : 'failed')
      recordCraftProblem('instalación', e)
      return { ok: false, error: code, message: e instanceof Error ? e.message : String(e) }
    } finally {
      this.installing = null
      this.progress = undefined
    }
  }

  /** Al arrancar: reintenta en silencio una instalación incompleta (máx. una vez cada 24 h; ver `craft-retry.ts`). Nunca lanza. */
  async retryIncomplete(): Promise<RetryOutcome | 'error'> {
    try {
      return await retryIncompleteInstall({
        statePath: this.statePath(),
        now: Date.now,
        status: () => this.status(),
        install: () => this.installNow()
      })
    } catch (e) {
      recordCraftProblem('reintento automático', e)
      return 'error'
    }
  }

  cancel(): void {
    this.installing?.abort()
  }

  remove(): void {
    removeCraft(this.deps())
    this.error = undefined
  }

  /** Carpeta de la versión web (sitio estático) de un programa (`gridcraft`, `deckcraft`, `wordcraft`), o `null` si no está instalada. */
  webDir(programa: string): string | null {
    return craftWebDir(this.deps(), programa)
  }

  /** Para el entorno de `opencode serve`: la ruta de `deckcraft-cli` si ya está instalado. */
  env(): Record<string, string> {
    const s = this.status()
    if (s.state !== 'installed') return {}
    const out: Record<string, string> = {}
    if (s.bins.deckcraft) out.LAZUNOX_DECKCRAFT = s.bins.deckcraft
    if (s.bins.wordcraft) out.LAZUNOX_WORDCRAFT = s.bins.wordcraft
    if (s.bins.gridcraft) out.LAZUNOX_GRIDCRAFT = s.bins.gridcraft
    return out
  }
}

let instance: CraftService | null = null
export const craftService = (): CraftService => (instance ??= new CraftService())
