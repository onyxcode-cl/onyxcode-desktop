import { describe, expect, it } from 'vitest'
import { AREAS as ES_AREAS, es } from './es'
import { AREAS as EN_AREAS, en } from './en'
import { DICTIONARIES, format, getLang, migrateLanguage, resolveLang, setLang, t, translate, type Msg } from './index'

const placeholders = (m: Msg): string[] => {
  const parts = typeof m === 'string' ? [m] : [m.one, m.other]
  return parts.map((p) => [...p.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((x) => x[1]).sort().join(',')).sort()
}

describe('diccionarios es/en', () => {
  it('tienen exactamente las mismas claves, por área y en total', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
    for (const area of Object.keys(ES_AREAS) as (keyof typeof ES_AREAS)[]) {
      expect(Object.keys(EN_AREAS[area]).sort(), `área ${area}`).toEqual(Object.keys(ES_AREAS[area]).sort())
    }
  })

  it('ninguna clave se repite entre áreas (el índice las mezcla con spread)', () => {
    const total = Object.values(ES_AREAS).reduce((n, a) => n + Object.keys(a).length, 0)
    expect(Object.keys(es).length).toBe(total)
  })

  it('no hay mensajes vacíos', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const [key, msg] of Object.entries(DICTIONARIES[lang])) {
        const parts = typeof msg === 'string' ? [msg] : [msg.one, msg.other]
        for (const p of parts) expect(p.trim().length, `${lang}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('mismo tipo (cadena o plural) y mismos marcadores en los dos idiomas', () => {
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      const a = DICTIONARIES.es[key]
      const b = DICTIONARIES.en[key]
      expect(typeof b, key).toBe(typeof a)
      expect(placeholders(b), key).toEqual(placeholders(a))
    }
  })
})

describe('resolveLang', () => {
  it.each([
    ['es', ['en-US'], 'es'],
    ['en', ['es-CL'], 'en'],
    ['system', ['en-US'], 'en'],
    ['system', ['en'], 'en'],
    ['system', ['en_GB'], 'en'],
    ['system', ['es-CL'], 'es'],
    ['system', ['fr-FR'], 'es'],
    ['system', ['fr-FR', 'en-US'], 'en'],
    ['system', ['de', 'es-ES', 'en'], 'es'],
    ['system', [], 'es']
  ] as const)('%s con %j -> %s', (pref, preferred, expected) => {
    expect(resolveLang(pref, [...preferred])).toBe(expected)
  })
})

describe('migrateLanguage', () => {
  it('instalación existente (ya pasó el asistente) sin idioma: español', () => {
    expect(migrateLanguage({ onboarded: true })).toBe('es')
  })
  it('instalación nueva sin idioma: sigue al sistema', () => {
    expect(migrateLanguage({ onboarded: false })).toBe('system')
    expect(migrateLanguage({})).toBe('system')
  })
  it('respeta un valor válido y descarta uno inválido', () => {
    expect(migrateLanguage({ language: 'en', onboarded: true })).toBe('en')
    expect(migrateLanguage({ language: 'system', onboarded: true })).toBe('system')
    expect(migrateLanguage({ language: 'fr', onboarded: true })).toBe('es')
  })
})

describe('format y plurales', () => {
  it('sustituye marcadores y deja los que faltan', () => {
    expect(format('Hola {name}, {n}', { name: 'Ana' })).toBe('Hola Ana, {n}')
    expect(format('sin marcadores')).toBe('sin marcadores')
  })

  it('elige la forma con Intl.PluralRules', () => {
    const key = '__plural__'
    DICTIONARIES.es[key] = { one: '{count} archivo', other: '{count} archivos' }
    DICTIONARIES.en[key] = { one: '{count} file', other: '{count} files' }
    try {
      expect(translate('es', key, { count: 1 })).toBe('1 archivo')
      expect(translate('es', key, { count: 0 })).toBe('0 archivos')
      expect(translate('en', key, { count: 1 })).toBe('1 file')
      expect(translate('en', key, { count: 2 })).toBe('2 files')
    } finally {
      delete DICTIONARIES.es[key]
      delete DICTIONARIES.en[key]
    }
  })

  it('una clave desconocida devuelve la clave (nunca rompe la interfaz)', () => {
    expect(translate('en', 'no.existe')).toBe('no.existe')
  })
})

describe('idioma activo', () => {
  it('t() usa el idioma activo y los tests parten en español', () => {
    expect(getLang()).toBe('es')
    expect(t('labels.mode.tasks')).toBe('Tareas')
    setLang('en')
    try {
      expect(t('labels.mode.tasks')).toBe('Tasks')
    } finally {
      setLang('es')
    }
  })
})
