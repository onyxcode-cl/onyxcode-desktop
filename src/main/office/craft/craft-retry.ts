/**
 * Reintento automático y silencioso de una instalación de ArtCraft que quedó A MEDIAS (falló, o la app se cerró en mitad de la
 * descarga). Reglas:
 *  - Solo si la persona YA había pedido instalar (hay un intento anotado): nunca descarga ~300 MB por primera vez sin consentimiento.
 *  - No si la persona canceló a propósito (`cancelled`) ni si la plataforma no está soportada.
 *  - Como máximo una vez cada 24 h (el sello se escribe ANTES de intentar, así un cierre a mitad no provoca reintentos en cadena).
 *  - Nunca bloquea el arranque: quien llama lo programa sin `await`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CraftInstallResult } from '@shared/craft'
import type { CraftStatus } from './craft-install'

export const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface CraftAttemptState {
  /** Resultado del último intento hecho por la persona (`started` = la app se cerró antes de terminar). */
  last?: 'started' | 'ok' | 'failed' | 'cancelled'
  /** Instante del último reintento automático (ms). */
  autoAt?: number
}

export function readAttempt(path: string): CraftAttemptState {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as CraftAttemptState
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

export function writeAttempt(path: string, st: CraftAttemptState): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify(st), { mode: 0o600 })
  } catch {
    /* sin disco no hay reintento, pero nada se rompe */
  }
}

export interface RetryDeps {
  statePath: string
  now: () => number
  status: () => CraftStatus
  install: () => Promise<CraftInstallResult>
}

export type RetryOutcome = 'not-needed' | 'not-attempted' | 'cancelled' | 'too-soon' | 'ok' | 'failed'

export async function retryIncompleteInstall(d: RetryDeps): Promise<RetryOutcome> {
  if (d.status().state !== 'missing') return 'not-needed'
  const st = readAttempt(d.statePath)
  if (!st.last || st.last === 'ok') return 'not-attempted'
  if (st.last === 'cancelled') return 'cancelled'
  const at = d.now()
  if (typeof st.autoAt === 'number' && at - st.autoAt < RETRY_INTERVAL_MS && at >= st.autoAt) return 'too-soon'
  writeAttempt(d.statePath, { ...st, autoAt: at })
  const r = await d.install()
  return r.ok ? 'ok' : 'failed'
}
