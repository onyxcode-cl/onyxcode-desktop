/**
 * Entorno de los motores de OpenCode para las skills de oficina: carpeta de binarios opcionales (`LAZUNOX_BIN_DIR`) y las variables de
 * ArtCraft (ver `craft/service.ts`). La instalación y el estado de ArtCraft viven en `craft/*`.
 *
 * El nombre `officeService()` se conserva a propósito: `src/main/tasks/opencode-config.ts` (zona protegida) lo importa y renombrarlo
 * sería tocar esa zona.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { runtimesService } from '../runtimes/service'
import { craftService } from './craft/service'

class OfficeService {
  /** Para el entorno de `opencode serve`: carpeta de binarios (estable) y las variables de ArtCraft si ya está instalado. */
  env(): Record<string, string> {
    // `LAZUNOX_NODE`: el Node incluido de la app (si ya se instaló), para el motor de presentaciones del Chat que usa la skill `pptx`
    // (`build_chat_deck.py`). Sin él la skill busca `node` en el PATH y, si tampoco hay, sigue con `build_pptx.py`.
    let node: string | null = null
    try {
      node = runtimesService().bins().node
    } catch {
      node = null
    }
    return { LAZUNOX_BIN_DIR: join(app.getPath('userData'), 'bin'), ...(node ? { LAZUNOX_NODE: node } : {}), ...craftService().env() }
  }
}

let instance: OfficeService | null = null
export const officeService = (): OfficeService => (instance ??= new OfficeService())
