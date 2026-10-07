/**
 * Bandera efectiva `computerWin` (Control del PC en Windows, parte de la beta opcional de Tareas). PURA: dependencias inyectadas.
 *
 *   computerWin = win32 && TASKS_WIN_BUILD && tasksWin && helperPresent && !policy.disableWslTasks
 *
 * Sin interruptor propio: la puerta es el consentimiento de la tarjeta (`userData/computer-win-consent.json`) y el MCP responde
 * «sin consentimiento» antes de CADA herramienta. Solo existe con Tareas beta encendida (`tasksWin` efectiva). Todo lo que no
 * sea exactamente `true` cuenta como apagado.
 */
import { existsSync } from 'node:fs'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { unpacked } from '../util/asar'
import { servicePlatformFor, type HelperLocations } from './service-platform'

export interface ComputerWinDeps {
  platform: string
  /** Puerta de compilación. Por defecto la constante real; las pruebas la inyectan. */
  build?: boolean
  /** `tasksWin` efectiva (ya incluye puerta, consentimiento beta y política de Tareas). */
  tasksWin: unknown
  /** ¿Existe `cu-helper.exe`? Ver `computerWinHelperPresent`. */
  helperPresent: unknown
  /** Política de la organización (la misma que apaga Tareas): solo `disableWslTasks === true` estricto bloquea (null = sin política). */
  policy?: { disableWslTasks?: boolean } | null
}

export function resolveComputerWin(deps: ComputerWinDeps): boolean {
  if (deps.platform !== 'win32') return false
  const build: boolean = deps.build ?? TASKS_WIN_BUILD
  if (build !== true) return false
  if (deps.tasksWin !== true) return false
  if (deps.policy?.disableWslTasks === true) return false
  return deps.helperPresent === true
}

/** ¿Existe `cu-helper.exe` donde lo busca `ComputerService`? Misma lista de candidatos que `service-platform.ts` (win32). */
export function computerWinHelperPresent(loc: HelperLocations, exists: (p: string) => boolean = existsSync): boolean {
  return servicePlatformFor('win32')
    .helperCandidates(loc, unpacked)
    .some((p) => exists(p))
}
