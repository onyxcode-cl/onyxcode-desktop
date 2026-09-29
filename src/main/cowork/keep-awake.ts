/**
 * "Mantener el Mac despierto mientras corren tareas de Cowork": un `powerSaveBlocker` de
 * Electron (tipo `prevent-app-suspension`, no mantiene la pantalla encendida) que se activa
 * cuando el ajuste está en on Y el renderer o el monitor de main avisan que hay al menos una tarea
 * en curso (OR de ambas señales).
 *
 * El ajuste se persiste en `userData/cowork-keep-awake.json`. El estado "activo ahora mismo"
 * vive solo en memoria de este proceso.
 */
import { powerSaveBlocker, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KeepAwakeState } from '@shared/ipc-cowork'

/** Quién avisa de que hay trabajo en curso: la ventana (carpeta actual) o el monitor de main (todas). */
export type KeepAwakeSource = 'renderer' | 'monitor'

interface Persisted {
  enabled: boolean
}

const DEFAULT: Persisted = { enabled: true }

export class KeepAwakeService {
  private blockerId: number | null = null
  /** Señal de cada origen; el Mac se mantiene despierto si CUALQUIERA está activa (OR). */
  private sources: Record<KeepAwakeSource, boolean> = { renderer: false, monitor: false }
  private cache: Persisted | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'cowork-keep-awake.json')
  }

  private load(): Persisted {
    if (this.cache) return this.cache
    let loaded: Partial<Persisted> = {}
    try {
      if (existsSync(this.file)) loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
    } catch (err) {
      console.error('[cowork] cowork-keep-awake.json inválido, usando valores por defecto:', err)
    }
    this.cache = { enabled: typeof loaded.enabled === 'boolean' ? loaded.enabled : DEFAULT.enabled }
    return this.cache
  }

  private save(next: Persisted): void {
    this.cache = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  private apply(): void {
    const enabled = this.load().enabled
    const shouldBlock = enabled && (this.sources.renderer || this.sources.monitor)
    if (shouldBlock && this.blockerId === null) {
      this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!shouldBlock && this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
    }
  }

  state(): KeepAwakeState {
    return { enabled: this.load().enabled, active: this.blockerId !== null }
  }

  setEnabled(enabled: boolean): KeepAwakeState {
    this.save({ enabled })
    this.apply()
    return this.state()
  }

  /**
   * Cada origen informa si hay tareas corriendo/esperando. `renderer` = la carpeta que mira la
   * ventana; `monitor` = todos los servidores vivos (sondeo en main). El resultado es el OR de ambos.
   */
  setActive(active: boolean, source: KeepAwakeSource = 'renderer'): KeepAwakeState {
    this.sources[source] = active
    this.apply()
    return this.state()
  }

  dispose(): void {
    if (this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
    }
  }
}
