/**
 * PRUEBA (rama `exp/craft-office-pruebas`): servicio de DeckCraft de la app. Estado + instalación bajo demanda (`craft-install.ts`) +
 * variable de entorno `LAZUNOX_DECKCRAFT` para los motores de OpenCode, de modo que la skill `pptx` use el diseño «dots» solo si el
 * programa ya está instalado (si no, sigue con `build_pptx.py`). Pendiente: botón/consentimiento en Ajustes y canal IPC para instalar.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { unpacked } from '../../util/asar'
import { craftStatus, installCraft, loadCraftPin, removeCraft, type CraftDeps, type CraftStatus } from './craft-install'

class CraftService {
  private deps(): CraftDeps {
    return {
      binDir: join(app.getPath('userData'), 'bin'),
      pin: loadCraftPin(unpacked(join(app.getAppPath(), 'resources', 'craft', 'pin.json')))
    }
  }
  status(): CraftStatus {
    return craftStatus(this.deps())
  }
  install(onProgress?: Parameters<typeof installCraft>[1], signal?: AbortSignal): Promise<string> {
    return installCraft(this.deps(), onProgress, signal)
  }
  remove(): void {
    removeCraft(this.deps())
  }
  /** Para el entorno de `opencode serve`: la ruta de `deckcraft-cli` si ya está instalado. */
  env(): Record<string, string> {
    const s = this.status()
    return s.state === 'installed' ? { LAZUNOX_DECKCRAFT: s.bin } : {}
  }
}

let instance: CraftService | null = null
export const craftService = (): CraftService => (instance ??= new CraftService())
