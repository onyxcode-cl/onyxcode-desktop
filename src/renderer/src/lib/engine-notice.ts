/**
 * Lógica pura del aviso del motor: qué motor se usa y cuándo avisar de que no es el probado.
 * Sin React ni IPC (se prueba con `engine-notice.test.ts`).
 */
import { DISPLAY_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import type { OpencodeInfo, OpencodeSource } from '@shared/types'

type EngineInfo = Pick<OpencodeInfo, 'found' | 'source' | 'version' | 'sdkVersion' | 'compatible'> & { bundledAvailable?: boolean }

/** Origen del motor con palabras del usuario: «incluido», «tu CLI» o «ruta elegida» (ajustes o `OPENCODE_BIN`). */
export function engineSourceLabel(source: OpencodeSource | null): string | null {
  if (source === 'bundled') return t('notices.engine.bundled')
  if (source === 'cli') return t('notices.engine.cli')
  if (source === 'env' || source === 'settings') return t('notices.engine.custom')
  return null
}

/** «Lazunox Motor 1.19.0 (incluido)» (el propio) u «OpenCode 1.19.0 (tu CLI)» (uno externo), o null si no hay motor. */
export function engineSummary(info: EngineInfo | null): string | null {
  if (!info || !info.found) return null
  const origin = engineSourceLabel(info.source)
  const name = info.source === 'bundled' ? 'Lazunox Motor' : 'OpenCode'
  return `${name}${info.version ? ` ${info.version}` : ''}${origin ? ` (${origin})` : ''}`
}

export type EngineNoticeKind = 'older' | 'newer'

export interface EngineNotice {
  /** `older`: el motor de fuera es anterior al probado; `newer`: es más nuevo. */
  kind: EngineNoticeKind
  version: string
  sdk: string
  /** Se puede volver al motor incluido desde la app (hay uno y ninguna variable de entorno fija el otro). */
  canSwitch: boolean
}

function majorMinor(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** Mayor.menor de `a` frente al de `b`: <0 anterior, >0 más nuevo, 0 igual o no comparable. */
function compareMinor(a: string, b: string): number {
  const x = majorMinor(a)
  const y = majorMinor(b)
  if (!x || !y) return 0
  return x[0] - y[0] || x[1] - y[1]
}

/**
 * Cuándo hay aviso: el motor en uso NO es el incluido, su versión se conoce y difiere de la probada (mayor.menor del SDK,
 * o sea `compatible === false`). El motor incluido es siempre el probado. Un aviso ya cerrado para esa versión no vuelve a salir.
 */
export function engineNotice(info: EngineInfo | null, dismissedVersion: string | null = null): EngineNotice | null {
  if (!info || !info.found || !info.version || info.source === 'bundled' || info.compatible) return null
  if (dismissedVersion === info.version) return null
  const kind: EngineNoticeKind = compareMinor(info.version, info.sdkVersion) > 0 ? 'newer' : 'older'
  const canSwitch = info.bundledAvailable === true && info.source !== 'env'
  return { kind, version: info.version, sdk: info.sdkVersion, canSwitch }
}

/** Texto llano del aviso (también lo usa Ajustes > Acerca de), o null si no hay aviso. */
export function engineNoticeText(info: EngineInfo | null, dismissedVersion: string | null = null): string | null {
  const n = engineNotice(info, dismissedVersion)
  if (!n) return null
  return t(n.kind === 'newer' ? 'notices.engine.newer' : 'notices.engine.older', { version: n.version, app: DISPLAY_NAME, sdk: n.sdk })
}
