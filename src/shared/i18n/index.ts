/**
 * Internacionalización sin dependencias. El español es la base (`es/*.ts`, `as const`); el inglés
 * (`en/*.ts`) debe tener exactamente las mismas claves (`satisfies Messages<typeof es.x>`).
 *
 * Las claves son planas y con prefijo de área (`settings.general.title`). Un mensaje es una cadena con
 * marcadores `{nombre}` o un plural `{one, other}` que se elige con `params.count` (Intl.PluralRules).
 * El idioma activo vive en este módulo (`setLang`/`getLang`): en el renderer lo gobierna el store
 * `useLang` (que además re-renderiza), en main `src/main/i18n.ts`.
 */
import { en } from './en'
import { es } from './es'

export type Lang = 'es' | 'en'
export type LangPref = 'system' | Lang

export const LANGS: readonly Lang[] = ['es', 'en']
export const LANG_PREFS: readonly LangPref[] = ['system', 'es', 'en']

/** Plural: se elige con `params.count`. */
export interface PluralMsg {
  one: string
  other: string
}
export type Msg = string | PluralMsg
/** Mismas claves que el diccionario base, con cadena o plural según corresponda. */
export type Messages<T> = { [K in keyof T]: T[K] extends string ? string : PluralMsg }
export type Params = Record<string, string | number>

export type MsgKey = keyof typeof es

export const DICTIONARIES: Record<Lang, Record<string, Msg>> = { es, en: en as unknown as Record<string, Msg> }

export function isLang(v: unknown): v is Lang {
  return v === 'es' || v === 'en'
}

export function isLangPref(v: unknown): v is LangPref {
  return v === 'system' || isLang(v)
}

/**
 * Idioma efectivo. `system` mira los idiomas preferidos del sistema por orden: el primero que sea
 * inglés (`en-*`) o español (`es-*`) decide; si no hay ninguno de los dos, español.
 */
export function resolveLang(pref: LangPref, preferred: readonly string[] = []): Lang {
  if (isLang(pref)) return pref
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0]
    if (base === 'en') return 'en'
    if (base === 'es') return 'es'
  }
  return 'es'
}

/**
 * Idioma guardado a partir de un settings.json leído del disco: una instalación existente (ya pasó el
 * asistente) sin `language` sigue en español; las nuevas siguen al sistema.
 */
export function migrateLanguage(loaded: { language?: unknown; onboarded?: unknown }): LangPref {
  if (isLangPref(loaded.language)) return loaded.language
  return loaded.onboarded === true ? 'es' : 'system'
}

/** Sustituye `{nombre}` por su valor; un marcador sin valor se deja tal cual. */
export function format(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

const pluralRules: Record<Lang, Intl.PluralRules> = { es: new Intl.PluralRules('es'), en: new Intl.PluralRules('en') }

/**
 * Plataforma para las variantes de texto: en `win32`, una clave `x` se sustituye por `x.win` si existe
 * (p. ej. «Mostrar en Finder» → «Mostrar en el Explorador»). Se fija una vez al arrancar (main y renderer);
 * vacía (por defecto, también en las pruebas) no cambia ningún texto.
 */
let platform = ''

export function setI18nPlatform(p: string): void {
  platform = p
}

export function getI18nPlatform(): string {
  return platform
}

/** Clave efectiva: la variante `.win` en Windows si el diccionario base la define. */
export function platformKey(key: string, plat: string = platform): string {
  return plat === 'win32' && `${key}.win` in DICTIONARIES.es ? `${key}.win` : key
}

/** Resuelve un mensaje (con su plural) en un idioma concreto. */
export function translate(lang: Lang, key: string, params?: Params): string {
  const k = platformKey(key)
  const raw = DICTIONARIES[lang][k] ?? DICTIONARIES.es[k]
  if (raw === undefined) return key
  if (typeof raw === 'string') return format(raw, params)
  const count = typeof params?.count === 'number' ? params.count : Number(params?.count ?? 0)
  const form = pluralRules[lang].select(count) === 'one' ? raw.one : raw.other
  return format(form, params)
}

let current: Lang = 'es'
const listeners = new Set<(lang: Lang) => void>()

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  for (const l of listeners) l(lang)
}

export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Traduce con el idioma activo. */
export function t(key: MsgKey, params?: Params): string {
  return translate(current, key, params)
}

/** Etiqueta BCP 47 para `toLocaleString` y similares. */
export function localeTag(lang: Lang = current): string {
  return lang === 'en' ? 'en-US' : 'es'
}
