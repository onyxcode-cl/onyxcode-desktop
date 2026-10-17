/**
 * Catálogo de Personalización (habilidades incluidas y conectores). Es UN archivo JSON versionado dentro de la app:
 * `resources/catalogo/catalogo.json` (esquema en `catalogo.schema.json`; cómo proponer una ficha: `docs/CATALOGO.md`).
 * No hay servidor, cuentas ni descargas: lo que se ve es lo que viaja en la app. Lo importa el código (así viaja dentro del
 * paquete y lo comparten main y renderer) y se valida aquí con `validateCatalog`; la prueba `src/test/catalogo.test.ts` falla
 * si una ficha no cumple el esquema o promete algo sin verificación.
 *
 * El sello «Revisado por Lazunox» es solo de las fichas de este archivo (las revisa el dueño); lo que la persona instale por su
 * cuenta (una carpeta propia) nunca lo lleva.
 */
import raw from '../../resources/catalogo/catalogo.json'
import { SKILL_NAME_RE } from './skill-proposal'

/** Nombre de servidor MCP válido (el mismo que acepta `mcp:save`). */
export const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Íconos permitidos en una ficha (el renderer solo conoce estos; un nombre nuevo exige añadirlo allí y aquí). */
export const CATALOG_ICONS = [
  'book-open',
  'bug',
  'briefcase',
  'calendar',
  'cloud',
  'compass',
  'file-text',
  'file-type',
  'folder',
  'git-branch',
  'list-checks',
  'mail',
  'notebook',
  'plug',
  'presentation',
  'sparkles',
  'table',
  'terminal',
  'users',
  'wallet'
] as const
export type CatalogIcon = (typeof CATALOG_ICONS)[number]

export type McpCatalogAuth = 'oauth' | 'token' | 'none'

export interface McpCatalogInput {
  id: string
  label: string
  /** `secret` se enmascara en pantalla y no se vuelve a mostrar. */
  kind: 'secret' | 'text'
  /** Expresión anclada (`^…$`) que debe cumplir el valor. */
  pattern: string
  maxLength: number
  /** Cabecera HTTP donde se coloca; `template` lleva exactamente un `{value}`. */
  target: { header: string; template: string }
  /** Dónde crear el valor (texto de ayuda). */
  help?: string
}

export interface CatalogGroup {
  id: string
  icon: CatalogIcon
}

/** Habilidad incluida en la app (su carpeta vive en `resources/opencode/skills/<id>`). */
export interface CatalogSkill {
  id: string
  title: string
  publisher: string
  icon: CatalogIcon
  description: string
  /** Lo que la habilidad le permite hacer al agente (se muestra antes de activarla). */
  permissions: string[]
  examples: string[]
  verifiedAt: string
  verification: string
  reviewed: boolean
}

/** Conector remoto (una URL https): añadirlo no ejecuta ningún programa en el equipo. */
export interface CatalogConnector {
  id: string
  /** Nombre sugerido del servidor (cumple `MCP_NAME_RE`); la persona puede cambiarlo. */
  name: string
  title: string
  publisher: string
  group: string
  icon: CatalogIcon
  description: string
  transport: 'remote'
  url: string
  auth: McpCatalogAuth
  inputs: McpCatalogInput[]
  /** Lo que podrá hacer la IA con él. */
  capabilities: string[]
  /** Lo que NO podrá hacer. */
  cannot: string[]
  examples: string[]
  /** `true` si puede crear, cambiar o borrar cosas en el servicio. */
  writes: boolean
  /** Qué datos salen de este equipo hacia el servicio. */
  dataLeaves: string
  docsUrl: string
  /** Fecha (AAAA-MM-DD) en que se verificó contra la documentación y la red. */
  verifiedAt: string
  /** Cómo se verificó (texto corto, legible). */
  verification: string
  reviewed: boolean
}

export interface Catalog {
  schemaVersion: 1
  catalogVersion: number
  updatedAt: string
  groups: CatalogGroup[]
  skills: CatalogSkill[]
  connectors: CatalogConnector[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Palabras que delatan una promesa sin verificar («próximamente», «beta»…). */
const PROMISE_RE = /pr[oó]ximamente|\bpronto\b|\bbeta\b|\bcoming soon\b|\bplanned\b|en desarrollo|por llegar/i

const SKILL_KEYS = ['id', 'title', 'publisher', 'icon', 'description', 'permissions', 'examples', 'verifiedAt', 'verification', 'reviewed']
const CONNECTOR_KEYS = [
  'id',
  'name',
  'title',
  'publisher',
  'group',
  'icon',
  'description',
  'transport',
  'url',
  'auth',
  'inputs',
  'capabilities',
  'cannot',
  'examples',
  'writes',
  'dataLeaves',
  'docsUrl',
  'verifiedAt',
  'verification',
  'reviewed'
]
const INPUT_KEYS = ['id', 'label', 'kind', 'pattern', 'maxLength', 'target', 'help']

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown, min = 1, max = 400): v is string => typeof v === 'string' && v.trim().length >= min && v.length <= max
const isStrList = (v: unknown, min: number, max: number, maxLen = 300): v is string[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((s) => isStr(s, 1, maxLen))

function strictKeys(o: Rec, allowed: string[], where: string, errs: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(`${where}: clave desconocida «${k}»`)
}

function httpsUrl(v: unknown): boolean {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
  } catch {
    return false
  }
}

function checkCommon(o: Rec, where: string, updatedAt: string, errs: string[]): void {
  if (!isStr(o.title, 1, 80)) errs.push(`${where}: falta «title» (1-80)`)
  if (!isStr(o.publisher, 1, 60)) errs.push(`${where}: falta «publisher»`)
  if (!CATALOG_ICONS.includes(o.icon as CatalogIcon)) errs.push(`${where}: «icon» no permitido`)
  if (!isStr(o.description, 10, 200)) errs.push(`${where}: «description» debe tener 10-200 caracteres`)
  if (!isStrList(o.examples, 1, 4, 140)) errs.push(`${where}: «examples» necesita 1-4 ejemplos de hasta 140 caracteres`)
  if (typeof o.verifiedAt !== 'string' || !DATE_RE.test(o.verifiedAt) || Number.isNaN(Date.parse(o.verifiedAt))) {
    errs.push(`${where}: «verifiedAt» debe ser AAAA-MM-DD`)
  } else if (o.verifiedAt > updatedAt) errs.push(`${where}: «verifiedAt» es posterior a «updatedAt» del catálogo`)
  if (!isStr(o.verification, 20, 500)) errs.push(`${where}: «verification» debe explicar cómo se verificó (20-500 caracteres)`)
  if (o.reviewed !== true) errs.push(`${where}: toda ficha empaquetada debe estar revisada («reviewed»: true)`)
  for (const [k, v] of Object.entries(o)) {
    const texts = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    if (k !== 'verification' && texts.some((s) => PROMISE_RE.test(s))) errs.push(`${where}: «${k}» promete algo sin verificar`)
  }
}

/** Devuelve la lista de problemas del catálogo (vacía = válido). Estricto: una clave desconocida también es un problema. */
export function validateCatalog(input: unknown): string[] {
  const errs: string[] = []
  if (!isRec(input)) return ['el catálogo no es un objeto']
  strictKeys(input, ['$schema', 'schemaVersion', 'catalogVersion', 'updatedAt', 'groups', 'skills', 'connectors'], 'catálogo', errs)
  if (input.schemaVersion !== 1) errs.push('schemaVersion debe ser 1')
  if (!Number.isInteger(input.catalogVersion) || (input.catalogVersion as number) < 1)
    errs.push('catalogVersion debe ser un entero positivo')
  const updatedAt = typeof input.updatedAt === 'string' && DATE_RE.test(input.updatedAt) ? input.updatedAt : ''
  if (!updatedAt) errs.push('updatedAt debe ser AAAA-MM-DD')

  const groupIds = new Set<string>()
  if (!Array.isArray(input.groups)) errs.push('groups debe ser una lista')
  else
    for (const [i, g] of input.groups.entries()) {
      const where = `groups[${i}]`
      if (!isRec(g)) {
        errs.push(`${where}: no es un objeto`)
        continue
      }
      strictKeys(g, ['id', 'icon'], where, errs)
      if (typeof g.id !== 'string' || !ID_RE.test(g.id)) errs.push(`${where}: «id» inválido`)
      else if (groupIds.has(g.id)) errs.push(`${where}: id repetido «${g.id}»`)
      else groupIds.add(g.id)
      if (!CATALOG_ICONS.includes(g.icon as CatalogIcon)) errs.push(`${where}: «icon» no permitido`)
    }

  const seenSkills = new Set<string>()
  if (!Array.isArray(input.skills)) errs.push('skills debe ser una lista')
  else
    for (const [i, s] of input.skills.entries()) {
      if (!isRec(s)) {
        errs.push(`skills[${i}]: no es un objeto`)
        continue
      }
      const where = `skills[${String(s.id ?? i)}]`
      strictKeys(s, SKILL_KEYS, where, errs)
      if (typeof s.id !== 'string' || !SKILL_NAME_RE.test(s.id) || s.id.length > 64) errs.push(`${where}: «id» inválido`)
      else if (seenSkills.has(s.id)) errs.push(`${where}: id repetido`)
      else seenSkills.add(s.id)
      if (!isStrList(s.permissions, 1, 6, 220)) errs.push(`${where}: «permissions» necesita 1-6 frases`)
      checkCommon(s, where, updatedAt, errs)
    }

  const seenConn = new Set<string>()
  const seenNames = new Set<string>()
  if (!Array.isArray(input.connectors)) errs.push('connectors debe ser una lista')
  else
    for (const [i, c] of input.connectors.entries()) {
      if (!isRec(c)) {
        errs.push(`connectors[${i}]: no es un objeto`)
        continue
      }
      const where = `connectors[${String(c.id ?? i)}]`
      strictKeys(c, CONNECTOR_KEYS, where, errs)
      if (typeof c.id !== 'string' || !ID_RE.test(c.id) || c.id.length > 64) errs.push(`${where}: «id» inválido`)
      else if (seenConn.has(c.id)) errs.push(`${where}: id repetido`)
      else seenConn.add(c.id)
      if (typeof c.name !== 'string' || !MCP_NAME_RE.test(c.name)) errs.push(`${where}: «name» inválido`)
      else if (seenNames.has(c.name)) errs.push(`${where}: name repetido`)
      else seenNames.add(c.name)
      if (typeof c.group !== 'string' || !groupIds.has(c.group)) errs.push(`${where}: «group» no está declarado en groups`)
      if (c.transport !== 'remote') errs.push(`${where}: solo se admiten conectores remotos («transport»: "remote")`)
      if (!httpsUrl(c.url)) errs.push(`${where}: «url» debe ser https, sin credenciales, consulta ni fragmento`)
      if (!httpsUrl(c.docsUrl)) errs.push(`${where}: «docsUrl» debe ser https`)
      if (c.auth !== 'oauth' && c.auth !== 'token' && c.auth !== 'none') errs.push(`${where}: «auth» inválido`)
      if (typeof c.writes !== 'boolean') errs.push(`${where}: «writes» debe ser verdadero o falso`)
      if (!isStrList(c.capabilities, 1, 6, 200)) errs.push(`${where}: «capabilities» necesita 1-6 frases`)
      if (!isStrList(c.cannot, 1, 6, 200)) errs.push(`${where}: «cannot» necesita 1-6 frases (lo que NO podrá hacer)`)
      if (!isStr(c.dataLeaves, 10, 400)) errs.push(`${where}: «dataLeaves» debe decir qué datos salen del equipo`)
      if (!Array.isArray(c.inputs)) errs.push(`${where}: «inputs» debe ser una lista`)
      else {
        const expected = c.auth === 'token' ? 1 : 0
        if (c.inputs.length < expected || (c.auth !== 'token' && c.inputs.length > 0))
          errs.push(`${where}: «inputs» no corresponde a «auth» (${String(c.auth)})`)
        for (const [j, inp] of c.inputs.entries()) {
          const w = `${where}.inputs[${j}]`
          if (!isRec(inp)) {
            errs.push(`${w}: no es un objeto`)
            continue
          }
          strictKeys(inp, INPUT_KEYS, w, errs)
          if (typeof inp.id !== 'string' || !ID_RE.test(inp.id)) errs.push(`${w}: «id» inválido`)
          if (!isStr(inp.label, 1, 80)) errs.push(`${w}: falta «label»`)
          if (inp.kind !== 'secret' && inp.kind !== 'text') errs.push(`${w}: «kind» inválido`)
          if (!Number.isInteger(inp.maxLength) || (inp.maxLength as number) < 1 || (inp.maxLength as number) > 4096)
            errs.push(`${w}: «maxLength» inválido`)
          try {
            if (typeof inp.pattern !== 'string' || !inp.pattern.startsWith('^') || !inp.pattern.endsWith('$'))
              errs.push(`${w}: «pattern» debe estar anclado (^…$)`)
            else new RegExp(inp.pattern)
          } catch {
            errs.push(`${w}: «pattern» no compila`)
          }
          const tg = inp.target
          if (
            !isRec(tg) ||
            typeof tg.header !== 'string' ||
            !/^[A-Za-z0-9-]+$/.test(tg.header) ||
            typeof tg.template !== 'string' ||
            tg.template.split('{value}').length !== 2
          ) {
            errs.push(`${w}: «target» inválido (cabecera y plantilla con un único {value})`)
          }
        }
      }
      checkCommon(c, where, updatedAt, errs)
    }
  return errs
}

const EMPTY: Catalog = { schemaVersion: 1, catalogVersion: 1, updatedAt: '1970-01-01', groups: [], skills: [], connectors: [] }

/** Problemas del archivo empaquetado (vacío = bien). Si hay alguno, el catálogo queda vacío y la pantalla muestra el aviso de error. */
export const CATALOG_ERRORS: string[] = validateCatalog(raw)

export const CATALOG: Catalog = CATALOG_ERRORS.length === 0 ? (raw as unknown as Catalog) : EMPTY

/** Sube cuando cambia el contenido del catálogo (queda anotada en la procedencia de cada instalación). */
export const CATALOG_VERSION = CATALOG.catalogVersion
