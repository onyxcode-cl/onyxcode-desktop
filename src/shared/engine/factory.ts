/**
 * Fábrica de clientes del motor: el ÚNICO punto por el que main, renderer y PWA obtienen un
 * `EngineClient`. Elige el adaptador según `engine` (por defecto el motor 1 fijado).
 *
 * La bandera real que decidirá el motor (`feature-flags.ts`) llegará en una etapa posterior; hoy
 * el valor por defecto es `'1'` y `'2'` devuelve un esqueleto cuyos métodos fallan con `unsupported`.
 */
import type { EngineClient, EngineConnection } from './client'
import { Engine1Adapter } from './adapters/engine1'
import { Engine2Adapter } from './adapters/engine2'

/** `'1'` = OpenCode 1.19 (cliente `@opencode-ai/sdk/v2/client`), `'2'` = OpenCode 2.x (sin implementar). */
export type EngineVersion = '1' | '2'

export interface CreateEngineClientOptions extends EngineConnection {
  /** Motor al que hablar. Por defecto `'1'`. */
  engine?: EngineVersion
}

export function createEngineClient(options: CreateEngineClientOptions): EngineClient {
  const { engine = '1', ...conn } = options
  return engine === '2' ? new Engine2Adapter() : new Engine1Adapter(conn)
}
