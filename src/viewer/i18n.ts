/**
 * Diccionario MÍNIMO de la vista aislada del visor (Fase 0): este proceso no puede importar
 * `@shared/i18n` completo (es otro bundle, otra sesión, sin acceso al estado de idioma del host).
 * El idioma llega una sola vez por el fragmento de la URL (`#lang=es|en`) al cargar la página.
 */
export type ViewerLang = 'es' | 'en'

const ES_STRINGS = {
  loading: 'Cargando…',
  errorTitle: 'No se pudo mostrar el documento',
  errorBody: 'Puedes abrirlo con la aplicación del sistema desde el panel.'
} as const

const STRINGS: Record<ViewerLang, Record<keyof typeof ES_STRINGS, string>> = {
  es: ES_STRINGS,
  en: {
    loading: 'Loading…',
    errorTitle: 'Couldn’t show the document',
    errorBody: 'You can open it with the system app from the panel.'
  }
}

export function isViewerLang(v: string | null): v is ViewerLang {
  return v === 'es' || v === 'en'
}

export function tv(lang: ViewerLang, key: keyof typeof ES_STRINGS): string {
  return STRINGS[lang][key]
}
