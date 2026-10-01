/**
 * Lógica pura del aviso del motor: qué motor se usa y cuándo avisar de que no es el probado.
 * Sin React ni IPC (se prueba con `engine-notice.test.ts`).
 */
import { APP_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import type { OpencodeInfo, OpencodeSource } from '@shared/types'

type EngineInfo = Pick<OpencodeInfo, 'found' | 'source' | 'version' | 'sdkVersion' | 'compatible'>

/** Origen del motor con palabras del usuario: «incluido», «tu CLI» o «ruta elegida» (ajustes o `OPENCODE_BIN`). */
export function engineSourceLabel(source: OpencodeSource | null): string | null {
  if (source === 'bundled') return t('notices.engine.bundled')
  if (source === 'cli') return t('notices.engine.cli')
  if (source === 'env' || source === 'settings') return t('notices.engine.custom')
  return null
}

/** «OpenCode 1.18.33 (incluido)», o null si no hay motor. */
export function engineSummary(info: EngineInfo | null): string | null {
  if (!info || !info.found) return null
  const origin = engineSourceLabel(info.source)
  return `OpenCode${info.version ? ` ${info.version}` : ''}${origin ? ` (${origin})` : ''}`
}

/**
 * El aviso aparece si el motor en uso NO es el incluido, su versión se conoce y difiere de la probada
 * (mayor.menor del SDK, o sea `compatible === false`). El motor incluido es siempre el probado. Un aviso
 * ya cerrado para esa versión no vuelve a salir.
 */
export function engineNoticeText(info: EngineInfo | null, dismissedVersion: string | null = null): string | null {
  if (!info || !info.found || !info.version || info.source === 'bundled' || info.compatible) return null
  if (dismissedVersion === info.version) return null
  return t('notices.engine.mismatch', { version: info.version, app: APP_NAME, sdk: info.sdkVersion })
}
