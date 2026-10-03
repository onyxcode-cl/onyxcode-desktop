/**
 * Diccionario inglés vacío que `@shared/i18n` importa como `./en`: el real (~50 KB gzip) va en su propio trozo
 * (`en-dict.ts`) y solo se baja si el idioma efectivo es inglés. Mientras no esté, `translate` cae al español.
 */
export const en: Record<string, unknown> = {}
