import type { ModeId } from '@shared/types'
import type { ModeDefinition } from './types'
import { chatMode } from '../features/chat'
import { codeMode } from '../features/code'
import { coworkMode } from '../features/cowork'
import { routinesMode } from '../features/routines'

/** Registro de modos (orden = orden en el selector). Agregar un modo = una línea. */
export const MODES: ModeDefinition[] = [chatMode, codeMode, coworkMode, routinesMode]

export const MODES_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDefinition>
