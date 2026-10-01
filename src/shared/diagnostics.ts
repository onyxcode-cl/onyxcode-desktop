/** Diagnóstico (Ajustes › Diagnóstico): fuentes de registros que main entrega YA redactadas. */
import { t } from './i18n'

export const DIAG_SOURCES = ['engine', 'engine-file', 'report'] as const
export type DiagSource = (typeof DIAG_SOURCES)[number]

/** Etiquetas visibles de cada fuente, en el idioma activo (getters: se leen al usarse). */
export const DIAG_SOURCE_LABELS: Record<DiagSource, string> = {
  get engine() {
    return t('misc.diag.source.engine')
  },
  get 'engine-file'() {
    return t('misc.diag.source.engine-file')
  },
  get report() {
    return t('misc.diag.source.report')
  }
}

export interface DiagLogs {
  source: DiagSource
  lines: string[]
  /** Hay más líneas de las devueltas (se recortó por `maxLines` o por tamaño). */
  truncated: boolean
  generatedAt: number
}
