/**
 * Instalación AUTOMÁTICA en segundo plano de lo que la app necesita para funcionar al nivel de siempre (ArtCraft, Node.js y uv y, en
 * Windows, el entorno aislado de Overdrive): sin pantalla, sin casillas y sin pedir permiso. Reutiliza `runInstall` (las mismas descargas,
 * con las mismas verificaciones de integridad: no se debilita nada) y solo añade: avance no bloqueante, esperas silenciosas si falla la red y
 * un error claro con «Reintentar» cuando falla de verdad. No toca lo que exige a una persona (permisos de macOS, contraseña, administrador).
 * Sin React ni IPC directo: se prueba con `auto-install.test.ts`.
 */
import { create } from 'zustand'
import { AUTO_RETRY_DELAYS_MS, retryableCode, type PreflightId } from '@shared/preflight'
import { runInstall, type InstallApi } from './preflight-run'

export type AutoPhase =
  /** Nada que hacer (o ya terminó bien). */
  | 'idle'
  /** Descargando / instalando. */
  | 'running'
  /** Falló la red: espera en silencio y reintenta sola. */
  | 'waiting'
  /** Sin conexión: espera a que vuelva internet (no descarga nada). */
  | 'offline'
  /** No hay espacio suficiente: no instala nada. */
  | 'nodisk'
  /** Falló de verdad: error claro y «Reintentar». */
  | 'failed'

export interface AutoState {
  phase: AutoPhase
  /** Piezas de la tanda y las ya listas. */
  ids: PreflightId[]
  done: PreflightId[]
  /** % de la pieza en curso (0–100) si se conoce. */
  pct: number | null
  /** Motivo de cada pieza que falló de verdad. */
  failed: Partial<Record<PreflightId, string>>
  /** Detalle redactado para «Copiar detalle» (Diagnóstico). */
  details: Partial<Record<PreflightId, string>>
}

const INITIAL: AutoState = { phase: 'idle', ids: [], done: [], pct: null, failed: {}, details: {} }

export const useAutoInstall = create<AutoState>(() => ({ ...INITIAL }))
/** Piezas que ya se intentaron en esta sesión: una instalación «correcta» que la revisión sigue viendo como faltante NO se repite en bucle. */
const attempted = new Set<PreflightId>()
export const autoAttempted = (): ReadonlySet<PreflightId> => attempted

const set = (p: Partial<AutoState>): void => useAutoInstall.setState(p)

/** Vuelve al estado inicial (pruebas y «Revisar de nuevo»). */
export function resetAutoInstall(): void {
  attempted.clear()
  set({ ...INITIAL })
}

/** Avance general 0–100 de la tanda (piezas listas + % de la actual). */
export function autoPercent(s: Pick<AutoState, 'ids' | 'done' | 'pct'>): number {
  if (s.ids.length === 0) return 0
  return Math.min(100, Math.round(((s.done.length + (s.pct ?? 0) / 100) / s.ids.length) * 100))
}

/** ¿Hay una instalación automática que aún no terminó (descargando o esperando para reintentar)? */
export function autoBusy(s: Pick<AutoState, 'phase'>): boolean {
  return s.phase === 'running' || s.phase === 'waiting'
}

export interface AutoDeps {
  api: InstallApi
  online: () => boolean
  /** Espera entre reintentos (separada de `api.sleep` para poder cortarla en pruebas). */
  wait: (ms: number) => Promise<void>
  delays?: readonly number[]
}

let running: Promise<void> | null = null

/**
 * Instala `ids` en segundo plano y reintenta en silencio los fallos de red (esperas de `AUTO_RETRY_DELAYS_MS`). Una sola tanda a la vez:
 * una segunda llamada mientras hay una en curso no hace nada. Termina en `idle` (todo listo) o en `failed` (con el motivo de cada pieza).
 */
export function startAutoInstall(ids: readonly PreflightId[], deps: AutoDeps): Promise<void> {
  if (running || ids.length === 0) return running ?? Promise.resolve()
  running = (async () => {
    const delays = deps.delays ?? AUTO_RETRY_DELAYS_MS
    for (const id of ids) attempted.add(id)
    set({ phase: 'running', ids: [...ids], done: [], pct: null, failed: {}, details: {} })
    let pending: PreflightId[] = [...ids]
    const lastFail: Partial<Record<PreflightId, { code?: string; message?: string }>> = {}
    const finalFailed: Partial<Record<PreflightId, string>> = {}
    // Los fallos de una pasada no se anotan en el registro de problemas hasta ser definitivos (sin ruido por cada reintento).
    const api: InstallApi = {
      ...deps.api,
      fail: async (id, code, message) => {
        lastFail[id] = { code, message }
        return null
      }
    }
    for (let attempt = 0; pending.length > 0 && api.alive(); attempt++) {
      if (!deps.online()) {
        set({ phase: 'offline' })
        break
      }
      set({ phase: 'running', pct: null })
      const outcomes = await runInstall(pending, api, {
        onRuntime: (id, rt) => {
          if (rt === null) {
            useAutoInstall.setState((s) => ({ done: s.done.includes(id) ? s.done : [...s.done, id], pct: null }))
          } else if (rt.state === 'downloading') set({ pct: rt.pct ?? null })
        },
        onDetail: () => undefined
      })
      const bad = outcomes.filter((o) => !o.ok && o.code !== 'cancelled')
      pending = bad.filter((o) => retryableCode(o.code)).map((o) => o.id)
      for (const o of bad) if (!retryableCode(o.code)) finalFailed[o.id] = o.code ?? 'generic'
      if (pending.length === 0) break
      if (attempt >= delays.length) {
        for (const o of bad) if (pending.includes(o.id)) finalFailed[o.id] = o.code ?? 'download'
        pending = []
        break
      }
      set({ phase: 'waiting', pct: null })
      await deps.wait(delays[attempt])
    }
    if (Object.keys(finalFailed).length > 0) {
      const details: Partial<Record<PreflightId, string>> = {}
      for (const id of Object.keys(finalFailed) as PreflightId[]) {
        const f = lastFail[id]
        const d = await deps.api.fail(id, finalFailed[id] ?? f?.code, f?.message).catch(() => null)
        if (d) details[id] = d.detail
      }
      set({ phase: 'failed', failed: finalFailed, details, pct: null })
    } else if (useAutoInstall.getState().phase !== 'offline') set({ phase: 'idle', pct: null })
  })().finally(() => {
    running = null
  })
  return running
}

/** Sin conexión sin empezar (o sin espacio): se anota el estado para el aviso; no se descarga nada. */
export function markAutoBlocked(phase: 'offline' | 'nodisk', ids: readonly PreflightId[]): void {
  if (running) return
  set({ phase, ids: [...ids], done: [], pct: null, failed: {}, details: {} })
}

/** El plan ya no tiene nada pendiente: se limpia el aviso (salvo un fallo real, que se queda hasta «Reintentar»). */
export function clearAutoIfIdle(): void {
  if (running) return
  const s = useAutoInstall.getState()
  if (s.phase === 'offline' || s.phase === 'nodisk') set({ ...INITIAL })
}

/** Estado actual sin suscribirse (para decidir si arrancar). */
export function autoPhase(): AutoPhase {
  return useAutoInstall.getState().phase
}
