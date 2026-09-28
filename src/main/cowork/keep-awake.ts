/**
 * "Mantener el Mac despierto mientras corren tareas de Cowork": un `powerSaveBlocker` de
 * Electron (tipo `prevent-app-suspension`, no mantiene la pantalla encendida) que se activa
 * cuando el ajuste está en on Y el renderer avisa que hay al menos una tarea en curso.
 *
 * El ajuste se persiste en `userData/cowork-keep-awake.json`. El estado "activo ahora mismo"
 * vive solo en memoria de este proceso.
 */
import { powerSaveBlocker, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KeepAwakeState } from '@shared/ipc-cowork'

interface Persisted {
  enabled: boolean
}

const DEFAULT: Persisted = { enabled: true }

export class KeepAwakeService {
  private blockerId: number | null = null
  private wantActive = false
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
    const shouldBlock = enabled && this.wantActive
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

  /** El renderer llama esto cada vez que cambia si hay tareas corriendo/esperando en cualquier carpeta. */
  setActive(active: boolean): KeepAwakeState {
    this.wantActive = active
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
