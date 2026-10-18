import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import raw from '../../resources/catalogo/catalogo.json'
import schema from '../../resources/catalogo/catalogo.schema.json'
import { CATALOG, CATALOG_ERRORS, CATALOG_ICONS, validateCatalog } from '../shared/catalogo'
import { DICTIONARIES } from '../shared/i18n'
import { es } from '../shared/i18n/es'
import { en } from '../shared/i18n/en'

/**
 * El catálogo empaquetado (`resources/catalogo/catalogo.json`) es lo ÚNICO que ofrece Personalización: esta prueba falla si una ficha
 * no cumple el esquema o promete algo sin verificación (ver `docs/CATALOGO.md`).
 */
const ROOT = resolve(__dirname, '../..')
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(raw)) // eslint-disable-line @typescript-eslint/no-explicit-any

describe('catálogo de Personalización: archivo empaquetado', () => {
  it('cumple el esquema (sin ningún problema)', () => {
    expect(validateCatalog(raw)).toEqual([])
    expect(CATALOG_ERRORS).toEqual([])
    expect(CATALOG.connectors.length).toBeGreaterThan(0)
    expect(CATALOG.skills.length).toBeGreaterThan(0)
  })

  it('toda ficha está revisada y trae cómo se verificó (nada se promete sin verificar)', () => {
    for (const f of [...CATALOG.skills, ...CATALOG.connectors]) {
      expect(f.reviewed, f.id).toBe(true)
      expect(f.verification.length, f.id).toBeGreaterThanOrEqual(20)
      expect(Date.parse(f.verifiedAt), f.id).toBeLessThanOrEqual(Date.now())
      expect(f.verifiedAt <= CATALOG.updatedAt, f.id).toBe(true)
    }
  })

  it('cada habilidad del catálogo existe de verdad en la app y su SKILL.md se llama igual', () => {
    for (const s of CATALOG.skills) {
      const file = resolve(ROOT, 'resources/opencode/skills', s.id, 'SKILL.md')
      expect(existsSync(file), `falta ${file}`).toBe(true)
      const head = readFileSync(file, 'utf8').split('---')[1] ?? ''
      expect(head, s.id).toMatch(new RegExp(`^name:\\s*${s.id}\\s*$`, 'm'))
    }
  })

  it('los conectores son los de la lista verificada de Ajustes (nada más) y llevan su dominio', () => {
    const ids = CATALOG.connectors.map((c) => c.id).sort()
    expect(ids).toEqual(['atlassian', 'cloudflare-docs', 'context7', 'github', 'linear', 'notion', 'sentry'])
  })

  it('los grupos vacíos existen en el archivo pero ninguna ficha usa uno no declarado', () => {
    const declared = new Set(CATALOG.groups.map((g) => g.id))
    for (const c of CATALOG.connectors) expect(declared.has(c.group), c.id).toBe(true)
  })

  it('el esquema JSON y el validador comparten la lista de íconos', () => {
    expect([...schema.$defs.icon.enum].sort()).toEqual([...CATALOG_ICONS].sort())
  })

  it('sin secretos literales en el catálogo (las claves solo se describen con patrones)', () => {
    const text = JSON.stringify(raw)
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/)
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
    expect(text).not.toMatch(/Bearer [A-Za-z0-9._-]{12,}/)
  })
})

describe('catálogo de Personalización: el validador rechaza lo que no cumple', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bad = (mut: (c: Record<string, any>) => void): string[] => {
    const c = clone()
    mut(c)
    return validateCatalog(c)
  }

  it('no es un objeto / versión incorrecta', () => {
    expect(validateCatalog(null)).not.toEqual([])
    expect(bad((c) => (c.schemaVersion = 2)).join()).toMatch(/schemaVersion/)
  })

  it('clave desconocida en la raíz o en una ficha', () => {
    expect(bad((c) => (c.extra = 1)).join()).toMatch(/clave desconocida/)
    expect(bad((c) => (c.connectors[0].extra = 1)).join()).toMatch(/clave desconocida/)
  })

  it('ficha sin verificación o sin revisar', () => {
    expect(bad((c) => (c.connectors[0].verification = '')).join()).toMatch(/verification/)
    expect(bad((c) => delete c.skills[0].verification).join()).toMatch(/verification/)
    expect(bad((c) => (c.connectors[1].reviewed = false)).join()).toMatch(/revisada/)
  })

  it('ficha que promete algo que no existe («próximamente», «beta»)', () => {
    expect(bad((c) => (c.connectors[0].description = 'Pronto podrás conectar tu correo con esto')).join()).toMatch(/promete/)
    expect(bad((c) => c.connectors[0].examples.push('Disponible próximamente en beta')).join()).toMatch(/promete/)
    expect(bad((c) => (c.skills[0].title = 'Beta de Word')).join()).toMatch(/promete/)
  })

  it('conector local, sin https, con credenciales en la URL o con grupo no declarado', () => {
    expect(bad((c) => (c.connectors[0].transport = 'local')).join()).toMatch(/remotos/)
    expect(bad((c) => (c.connectors[0].url = 'http://mcp.example.com/mcp')).join()).toMatch(/https/)
    expect(bad((c) => (c.connectors[0].url = 'https://u:p@mcp.example.com/mcp')).join()).toMatch(/https/)
    expect(bad((c) => (c.connectors[0].group = 'inventado')).join()).toMatch(/group/)
  })

  it('«auth» y «inputs» incoherentes, patrón sin anclar, plantilla sin {value}', () => {
    expect(bad((c) => c.connectors.find((x: { id: string }) => x.id === 'github').inputs.pop()).join()).toMatch(/inputs/)
    expect(bad((c) => (c.connectors[0].auth = 'token')).join()).toMatch(/inputs/)
    expect(bad((c) => (c.connectors.find((x: { id: string }) => x.id === 'github').inputs[0].pattern = 'ghp_.*')).join()).toMatch(/anclado/)
    expect(bad((c) => (c.connectors.find((x: { id: string }) => x.id === 'github').inputs[0].target.template = 'Bearer')).join()).toMatch(
      /target/
    )
  })

  it('ficha sin «lo que NO podrá hacer», ejemplos o permisos', () => {
    expect(bad((c) => (c.connectors[0].cannot = [])).join()).toMatch(/cannot/)
    expect(bad((c) => (c.connectors[0].examples = [])).join()).toMatch(/examples/)
    expect(bad((c) => (c.skills[0].permissions = [])).join()).toMatch(/permissions/)
  })

  it('ids repetidos, nombre de habilidad inválido, ícono fuera de la lista, fecha posterior al catálogo', () => {
    expect(bad((c) => (c.connectors[1].id = c.connectors[0].id)).join()).toMatch(/repetido/)
    expect(bad((c) => (c.skills[0].id = 'Mala Habilidad')).join()).toMatch(/id/)
    expect(bad((c) => (c.skills[0].icon = 'bomba')).join()).toMatch(/icon/)
    expect(bad((c) => (c.skills[0].verifiedAt = '2099-01-01')).join()).toMatch(/posterior/)
  })
})

describe('catálogo de Personalización: «aún sin probar con una cuenta real»', () => {
  it('toda ficha cuya verificación admite que no se probó con una cuenta real lo declara (y viceversa)', () => {
    for (const c of CATALOG.connectors) {
      const admits = /no se probó con una cuenta real/i.test(c.verification)
      expect(c.accountTested === false, c.id).toBe(admits)
    }
    expect(CATALOG.connectors.some((c) => c.accountTested === false)).toBe(true)
  })

  it('«accountTested» solo puede ser verdadero o falso', () => {
    const c = clone()
    c.connectors[0].accountTested = 'no'
    expect(validateCatalog(c).join()).toMatch(/accountTested/)
  })

  it('el aviso existe en español e inglés', () => {
    const E = es as unknown as Record<string, string>
    const N = en as unknown as Record<string, string>
    for (const k of ['pers.note.untested', 'pers.note.untestedLong']) {
      expect(E[k], k).toBeTruthy()
      expect(N[k], k).toBeTruthy()
    }
  })
})

describe('catálogo de Personalización: textos por idioma', () => {
  const E = es as unknown as Record<string, string>
  const N = en as unknown as Record<string, string>

  it('la copia en español del diccionario coincide con el archivo y el inglés tiene todas las claves', () => {
    for (const s of CATALOG.skills) {
      const p = `pers.cat.skill.${s.id}`
      expect(E[`${p}.title`], p).toBe(s.title)
      expect(E[`${p}.description`], p).toBe(s.description)
      s.permissions.forEach((x, i) => expect(E[`${p}.perm${i + 1}`], p).toBe(x))
      s.examples.forEach((x, i) => expect(E[`${p}.ex${i + 1}`], p).toBe(x))
      expect(N[`${p}.title`], p).toBeTruthy()
      expect(N[`${p}.description`], p).not.toBe(s.description)
      s.permissions.forEach((_, i) => expect(N[`${p}.perm${i + 1}`], p).toBeTruthy())
      s.examples.forEach((_, i) => expect(N[`${p}.ex${i + 1}`], p).toBeTruthy())
    }
    for (const c of CATALOG.connectors) {
      const p = `pers.cat.conn.${c.id}`
      c.cannot.forEach((x, i) => {
        expect(E[`${p}.cannot${i + 1}`], p).toBe(x)
        expect(N[`${p}.cannot${i + 1}`], p).toBeTruthy()
      })
      c.examples.forEach((x, i) => {
        expect(E[`${p}.ex${i + 1}`], p).toBe(x)
        expect(N[`${p}.ex${i + 1}`], p).toBeTruthy()
      })
    }
  })

  it('cada grupo tiene su nombre en los dos idiomas', () => {
    for (const g of CATALOG.groups) {
      expect(E[`pers.group.${g.id}`], g.id).toBeTruthy()
      expect(N[`pers.group.${g.id}`], g.id).toBeTruthy()
    }
  })

  it('los diccionarios exponen las mismas claves de Personalización', () => {
    const keys = (d: Record<string, unknown>): string[] =>
      Object.keys(d)
        .filter((k) => k.startsWith('pers.') || k.startsWith('merr.pers.'))
        .sort()
    expect(keys(DICTIONARIES.en as Record<string, unknown>)).toEqual(keys(DICTIONARIES.es as Record<string, unknown>))
  })
})
