/** Diagnóstico (Ajustes › Diagnóstico): fuentes de registros que main entrega YA redactadas. */
export const DIAG_SOURCES = ['engine', 'engine-file', 'report'] as const
export type DiagSource = (typeof DIAG_SOURCES)[number]

export const DIAG_SOURCE_LABELS: Record<DiagSource, string> = {
  engine: 'Motor (en vivo)',
  'engine-file': 'Motor (archivo)',
  report: 'Informe de diagnóstico'
}

export interface DiagLogs {
  source: DiagSource
  lines: string[]
  /** Hay más líneas de las devueltas (se recortó por `maxLines` o por tamaño). */
  truncated: boolean
  generatedAt: number
}
