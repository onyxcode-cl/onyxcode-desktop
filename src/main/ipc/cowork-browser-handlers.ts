/**
 * Handlers del navegador propio de Cowork (`cowork:browser:*`, Lote C B.10). El estado y la lógica
 * viven en el singleton `browserService`; aquí solo se exponen los canales IPC y se reenvía
 * `cowork:browser:changed` (incluye los cambios que llegan por el diálogo nativo de aprobación,
 * que no pasan por ningún `invoke` del renderer).
 */
import { browserService } from '../browser/service'
import type { CoworkIpcContext, CoworkSubmodule } from './cowork-handle'

export function registerCoworkBrowserHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, send } = ctx

  const onChanged = (state: ReturnType<typeof browserService.state>): void => send('cowork:browser:changed', state)
  browserService.on('changed', onChanged)

  handle('cowork:browser:state', () => browserService.state())
  handle('cowork:browser:set', (req) => browserService.set(req))
  handle('cowork:browser:removeSite', (req) => browserService.removeSite(req))
  handle('cowork:browser:undeny', (req) => browserService.undeny(req))
  handle('cowork:browser:clearData', () => browserService.clearData())

  return {
    dispose: () => {
      browserService.off('changed', onChanged)
    }
  }
}
