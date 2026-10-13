/**
 * Entorno de los motores de OpenCode para las skills de oficina: carpeta de binarios opcionales (`LAZUNOX_BIN_DIR`) y las variables de
 * ArtCraft (ver `craft/service.ts`). La instalación y el estado de ArtCraft viven en `craft/*`.
 *
 * El nombre `officeService()` se conserva a propósito: `src/main/tasks/opencode-config.ts` (zona protegida) lo importa y renombrarlo
 * sería tocar esa zona.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { craftService } from './craft/service'

class OfficeService {
  /** Para el entorno de `opencode serve`: carpeta de binarios (estable) y las variables de ArtCraft si ya está instalado. */
  env(): Record<string, string> {
    return { LAZUNOX_BIN_DIR: join(app.getPath('userData'), 'bin'), ...craftService().env() }
  }
}

let instance: OfficeService | null = null
export const officeService = (): OfficeService => (instance ??= new OfficeService())
