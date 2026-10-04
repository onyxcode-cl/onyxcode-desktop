/**
 * Constantes de «Comparar modelos». Se ajustan aquí sin tocar la lógica (los límites reales de OpenCode Go no se
 * conocen: valores conservadores).
 */
export const COMPARE_LIMITS = {
  /** Columnas por comparación. */
  maxColumns: 4,
  /** Sesiones simultáneas por proveedor; los no listados usan `defaultPerProvider`. */
  perProvider: { 'opencode-go': 2, opencode: 2 } as Readonly<Record<string, number>>,
  defaultPerProvider: 4,
  /** Separación mínima entre dos arranques (evita disparar el límite de tokens por minuto). */
  staggerMs: 1500,
  /** Reintento único por cuota: base y jitter (±). */
  retryBaseMs: 20_000,
  retryJitterMs: 5_000,
  /** Reintentos propios del motor (`session.status: retry`) por cuota que se toleran antes de abortar. */
  engineRetryAbortAfter: 2,
  /** Espera máxima a que la sesión quede inactiva tras `session.abort`. */
  abortIdleWaitMs: 10_000,
  abortPollMs: 250,
  /** Sondeo del estado y los mensajes de las columnas en curso. */
  pollMs: 1_000,
  /** Si tras enviar el prompt no hay actividad en este tiempo, la columna falla. */
  noStartTimeoutMs: 60_000,
  /** Fallos seguidos de sondeo antes de dar la columna por perdida. */
  maxPollFailures: 20,
  /** Tope del parche que se devuelve al renderer para mostrarlo. */
  patchDisplayMax: 1024 * 1024,
  /** Tope del diff dentro de la exportación. */
  benchPatchMax: 200 * 1024,
  /** Cada cuánto se persiste el manifiesto por cambios solo de métricas. */
  persistMetricsMs: 3_000
} as const

export type CompareLimits = {
  -readonly [K in keyof typeof COMPARE_LIMITS]: (typeof COMPARE_LIMITS)[K]
}
