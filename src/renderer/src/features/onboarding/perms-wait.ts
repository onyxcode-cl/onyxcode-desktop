/**
 * Espera a que la persona active Accesibilidad y Grabación de pantalla en Ajustes del Sistema. Lógica sin React ni IPC directo
 * (se prueba con `perms-wait.test.ts`); la bienvenida y el asistente le pasan sus llamadas.
 *
 * - En cuanto Accesibilidad está concedida y Pantalla no, avisa YA (`onRestart`): macOS solo aplica Grabación de pantalla al
 *   reabrir la app. Además abre el panel de Pantalla una sola vez (nunca los dos paneles a la vez).
 * - Si pasa el tiempo y siguen faltando permisos, lo reporta a main (registro de problemas) y devuelve `timeout`.
 */
import { permsStage, type PermsStage } from '@shared/mac-permissions'

export interface PermsWaitDeps {
  status: () => Promise<{ accessibility: boolean; screenRecording: boolean } | null>
  /** Abre el siguiente panel de Ajustes que falte (main decide cuál). */
  request: () => Promise<void>
  /** Anota en el registro de problemas que, tras esperar, siguen faltando permisos. */
  report: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  alive: () => boolean
  /** Se llama cada vez que cambia la etapa (`restart` = hay que reiniciar para Pantalla). */
  onStage: (stage: PermsStage) => void
}

export const PERMS_POLL_MS = 2000
export const PERMS_POLL_TRIES = 45

export async function waitForMacPerms(d: PermsWaitDeps): Promise<'ready' | 'timeout'> {
  let openedScreen = false
  let last: PermsStage | null = null
  for (let i = 0; i < PERMS_POLL_TRIES && d.alive(); i++) {
    const c = await d.status()
    if (c) {
      const stage = permsStage(c)
      if (stage !== last) {
        last = stage
        d.onStage(stage)
      }
      if (stage === 'ready') return 'ready'
      if (stage === 'restart' && !openedScreen) {
        openedScreen = true
        await d.request().catch(() => undefined)
      }
    }
    await d.sleep(PERMS_POLL_MS)
  }
  if (d.alive()) await d.report().catch(() => undefined)
  return 'timeout'
}
