/**
 * Servicio de DeckCraft de la app (presentaciones con diseño premium, OPCIONAL). Estado + instalación bajo demanda (`craft-install.ts`;
 * el botón de Ajustes ES el consentimiento) + variable de entorno `LAZUNOX_DECKCRAFT` para los motores de OpenCode, de modo que la
 * skill `pptx` use el diseño «dots» solo si el programa ya está instalado (si no, sigue con `build_pptx.py`).
 */
import { app } from 'electron'
import { join } from 'node:path'
import type { CraftInstallResult, CraftUiSnapshot } from '@shared/craft'
import { unpacked } from '../../util/asar'
import { OfficeError } from '../libreoffice'
import { craftStatus, installCraft, loadCraftPin, removeCraft, type CraftDeps, type CraftStatus } from './craft-install'

type Progress = NonNullable<CraftUiSnapshot['progress']>

class CraftService {
  private installing: AbortController | null = null
  private progress: Progress | undefined
  private error: string | undefined

  private deps(): CraftDeps {
    return {
      binDir: join(app.getPath('userData'), 'bin'),
      pin: loadCraftPin(unpacked(join(app.getAppPath(), 'resources', 'craft', 'pin.json')))
    }
  }

  status(): CraftStatus {
    return craftStatus(this.deps())
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
    try {
      await installCraft(this.deps(), (p) => (this.progress = p), ac.signal)
      return { ok: true }
    } catch (e) {
      const code = e instanceof OfficeError ? e.code : 'download'
      this.error = code
      return { ok: false, error: code, message: e instanceof Error ? e.message : String(e) }
    } finally {
      this.installing = null
      this.progress = undefined
    }
  }

  cancel(): void {
    this.installing?.abort()
  }

  remove(): void {
    removeCraft(this.deps())
    this.error = undefined
  }

  /** Para el entorno de `opencode serve`: la ruta de `deckcraft-cli` si ya está instalado. */
  env(): Record<string, string> {
    const s = this.status()
    return s.state === 'installed' ? { LAZUNOX_DECKCRAFT: s.bin } : {}
  }
}

let instance: CraftService | null = null
export const craftService = (): CraftService => (instance ??= new CraftService())
