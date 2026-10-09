/**
 * Servicio de LibreOffice de la app: estado + instalación bajo demanda (ver `libreoffice.ts`) + variables de entorno para los motores de
 * OpenCode, para que las skills de oficina encuentren `soffice` aunque se instale con la app ya abierta.
 */
import { app } from 'electron'
import { join } from 'node:path'
import type { OfficeInstallResult, OfficeUiSnapshot } from '@shared/office'
import { unpacked } from '../util/asar'
import {
  OfficeError,
  installLibreOffice,
  loadOfficePin,
  officeStatus,
  removeLibreOffice,
  type OfficeDeps,
  type OfficeProgress
} from './libreoffice'

class OfficeService {
  private installing: AbortController | null = null
  private progress: OfficeProgress | undefined
  private error: string | undefined

  private deps(): OfficeDeps {
    return {
      binDir: join(app.getPath('userData'), 'bin'),
      pin: loadOfficePin(unpacked(join(app.getAppPath(), 'resources', 'libreoffice', 'pin.json')))
    }
  }

  snapshot(): OfficeUiSnapshot {
    const s = officeStatus(this.deps())
    const status = s.state === 'installed' ? ({ state: 'installed', source: s.source, version: s.version } as const) : s
    return { status, installing: this.installing !== null, progress: this.installing ? this.progress : undefined, error: this.error }
  }

  async install(): Promise<OfficeInstallResult> {
    if (this.installing) return { ok: false, error: 'busy', message: 'Ya hay una instalación en curso' }
    this.error = undefined
    const ac = new AbortController()
    this.installing = ac
    try {
      await installLibreOffice(this.deps(), (p) => (this.progress = p), ac.signal)
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
    removeLibreOffice(this.deps())
    this.error = undefined
  }

  /** Para el entorno de `opencode serve`: carpeta de binarios (estable) y, si ya está, la ruta de `soffice`. */
  env(): Record<string, string> {
    const d = this.deps()
    const out: Record<string, string> = { LAZUNOX_BIN_DIR: d.binDir }
    const s = officeStatus(d)
    if (s.state === 'installed') out.LAZUNOX_SOFFICE = s.soffice
    return out
  }
}

let instance: OfficeService | null = null
export const officeService = (): OfficeService => (instance ??= new OfficeService())
