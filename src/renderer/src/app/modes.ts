import { modeAvailable } from '@shared/platform-caps'
import { currentPlatform } from '../lib/platform'
import type { ModeId } from '@shared/types'
import type { ModeDefinition } from './types'
import { chatMode } from '../features/chat'
import { codeMode } from '../features/code'
import { tasksMode } from '../features/tasks'
import { routinesMode } from '../features/routines'

/** Registro de modos (orden = orden en el selector). Agregar un modo = una línea. */
const ALL_MODES: ModeDefinition[] = [chatMode, codeMode, tasksMode, routinesMode]

/** Los modos visibles en esta plataforma: sin Tareas en Windows (selector, paleta y atajos salen de aquí). */
export const MODES: ModeDefinition[] = ALL_MODES.filter((m) => modeAvailable(m.id, currentPlatform()))

/** Todos los modos por id (también los no disponibles, para que una búsqueda nunca devuelva `undefined`). */
export const MODES_BY_ID = Object.fromEntries(ALL_MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDefinition>
