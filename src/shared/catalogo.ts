/**
 * Catálogo de Personalización (habilidades incluidas y conectores). Es UN archivo JSON versionado dentro de la app:
 * `resources/catalogo/catalogo.json` (esquema en `catalogo.schema.json`; cómo proponer una ficha: `docs/CATALOGO.md`).
 * No hay servidor, cuentas ni descargas: lo que se ve es lo que viaja en la app. Lo importa el código (así viaja dentro del
 * paquete y lo comparten main y renderer) y se valida aquí con `validateCatalog`; la prueba `src/test/catalogo.test.ts` falla
 * si una ficha no cumple el esquema o promete algo sin verificación.
 *
 * El sello «Revisado por Lazunox» es solo de las fichas de este archivo (las revisa el dueño); lo que la persona instale por su
 * cuenta (una carpeta propia) nunca lo lleva.
 *
 * Esquema 2 / catálogo 3 (F8-B186): además de los conectores REMOTOS (una URL https; añadirlos no ejecuta nada), admite
 * conectores LOCALES (`transport: "local"`): programas de terceros que la app descarga e instala EN EL EQUIPO de la persona. Eso
 * cambia a propósito el contrato «añadir no ejecuta nada», y por eso la ficha local lleva un bloque `runtime` muy cerrado: gestor
 * (`uv` o `npm`), paquete y versión EXACTOS, archivos de bloqueo con su SHA-256 (cada paquete lleva además su propio hash dentro
 * del archivo de bloqueo, que el gestor comprueba al instalar), argumentos fijos con `--read-only` OBLIGATORIO, variables de
 * entorno fijas (nunca texto de la persona) y la lista exacta de herramientas que se pueden usar y de las que se bloquean. Sin
 * shell: se ejecuta un binario con una lista de argumentos. Ver `docs/CATALOGO.md` y `docs/SEGURIDAD.md` §3 (F8-B186).
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

/**
 * `account` = el propio programa local pide entrar a la cuenta (en el navegador, con su flujo): ni la app ni el motor ven la
 * contraseña ni los tokens. Solo lo usan los conectores locales.
 */
export type McpCatalogAuth = 'oauth' | 'token' | 'none' | 'account'

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

/** Campos comunes de toda ficha de conector (remota o local). */
interface CatalogConnectorBase {
  id: string
  /** Nombre sugerido del servidor (cumple `MCP_NAME_RE`); la persona puede cambiarlo. */
  name: string
  title: string
  publisher: string
  group: string
  icon: CatalogIcon
  description: string
  auth: McpCatalogAuth
  inputs: McpCatalogInput[]
  /** Lo que podrá hacer la IA con él. */
  capabilities: string[]
  /** Lo que NO podrá hacer. */
  cannot: string[]
  examples: string[]
  /** `true` si puede crear, cambiar o borrar cosas en el servicio. Los conectores locales son siempre `false` (solo consulta). */
  writes: boolean
  /** Qué datos salen de este equipo hacia el servicio. */
  dataLeaves: string
  docsUrl: string
  /** `false` = nadie lo ha probado todavía con una cuenta real: la pantalla lo dice. Ausente = no se afirma nada. */
  accountTested?: boolean
  /** Fecha (AAAA-MM-DD) en que se verificó contra la documentación y la red. */
  verifiedAt: string
  /** Cómo se verificó (texto corto, legible). */
  verification: string
  reviewed: boolean
}

/** Conector remoto (una URL https): añadirlo no ejecuta ningún programa en el equipo. */
export interface CatalogRemoteConnector extends CatalogConnectorBase {
  transport: 'remote'
  url: string
  auth: 'oauth' | 'token' | 'none'
}

export type LocalManager = 'uv' | 'npm'

/** Archivo de bloqueo que viaja con la app y se copia, verificado, a la carpeta del conector antes de instalar. */
export interface LocalRuntimeFile {
  name: string
  sha256: string
}

/**
 * Cómo se instala y se lanza un conector local. TODO es fijo y viene de este archivo: nada de lo que escriba la persona entra
 * en un comando, un argumento ni una variable de entorno.
 */
export interface LocalRuntime {
  manager: LocalManager
  /** Nombre del paquete en PyPI (`uv`) o npm (`npm`). */
  package: string
  /** Versión EXACTA (sin rangos). */
  version: string
  /** Versión de Python que usa el entorno (solo `uv`). */
  python?: string
  /** Carpeta dentro de `resources/catalogo/conectores-locales/` donde viven los archivos de bloqueo. */
  dir: string
  /** Archivos de bloqueo: SHA-256 comprobado antes de usarlos. Cada paquete lleva su propio hash dentro de ellos. */
  files: LocalRuntimeFile[]
  /** Programa o script a lanzar, relativo a la carpeta del conector (nunca absoluto ni con «..»). */
  entry: string
  /** Argumentos fijos. Obligatoriamente incluyen `--read-only`. */
  args: string[]
  /** Variables de entorno fijas del programa. `{dir}` = carpeta del conector. Sin secretos. */
  env: Record<string, string>
  /** Archivo con el acceso del cliente OAuth propio de la persona (se elige con el diálogo del sistema; main lo copia sin pasarlo por la pantalla). */
  clientFile?: { env: string; file: string; /** Página donde la persona crea su cliente (https). */ helpUrl: string }
  author: string
  license: string
  sourceUrl: string
  /** Sitios de los que se descarga (solo nombres de dominio). */
  downloadFrom: string[]
  /** Tamaño aproximado de lo que se instala, en MB. */
  approxMB: number
  /** Carpeta (dentro de la del conector) donde el programa guarda lo que necesita para volver a entrar a tu cuenta. */
  tokenDir: string
  platforms: string[]
  tools: {
    /** Herramientas que se pueden usar (todas de consulta, más las de entrar a la cuenta). */
    allowed: string[]
    /** Herramientas del programa que cambian algo (o escriben archivos): el motor las tiene en «denegar». */
    blocked: string[]
    /** Subconjunto de `allowed` que no consulta datos: sirven para entrar a la cuenta. */
    auth: string[]
  }
}

/** Conector local: un programa de un tercero que se instala y se ejecuta en el equipo (F8-B186). */
export interface CatalogLocalConnector extends CatalogConnectorBase {
  transport: 'local'
  auth: 'account'
  writes: false
  runtime: LocalRuntime
}

export type CatalogConnector = CatalogRemoteConnector | CatalogLocalConnector

export interface Catalog {
  schemaVersion: 2
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
  'runtime',
  'auth',
  'inputs',
  'capabilities',
  'cannot',
  'examples',
  'writes',
  'dataLeaves',
  'docsUrl',
  'accountTested',
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

// ---- conectores locales (F8-B186) ----

const SEMVER_EXACT_RE = /^\d+\.\d+\.\d+$/
const SHA256_RE = /^[0-9a-f]{64}$/
const PACKAGE_RE = /^(@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9._-]*$/
const TOOL_RE = /^[A-Za-z0-9_-]{1,100}$/
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ENTRY_RE = /^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
/** Argumentos: solo caracteres inocuos (nada de espacios, comillas, `$`, `;`, `|`, `&`, comillas invertidas…). */
const ARG_RE = /^-{0,2}[A-Za-z0-9][A-Za-z0-9._,:=@+/-]*$/
/** Opciones que convertirían el programa en un intérprete de texto: prohibidas en `args` aunque no haya shell. */
const FORBIDDEN_ARGS = new Set([
  '-c',
  '-e',
  '-p',
  '-m',
  '-r',
  '--eval',
  '--print',
  '--exec',
  '--command',
  '--shell',
  '--require',
  '--import',
  '--loader'
])
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/
/** Variables que cambian cómo se carga un programa o dónde busca código: la ficha no puede tocarlas. */
const FORBIDDEN_ENV_RE =
  /^(PATH|HOME|SHELL|IFS|ENV|BASH_ENV|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_[A-Z_]*|DYLD_[A-Z_]*|PYTHON[A-Z_]*|PIP_[A-Z_]*|UV_[A-Z_]*|NPM_[A-Z_]*|OPENCODE_[A-Z_]*|LAZUNOX_[A-Z_]*)$/
const ENV_VALUE_RE = /^[A-Za-z0-9._:/@=,-]*$/
const KNOWN_PLATFORMS = ['darwin', 'win32', 'linux']
const RUNTIME_KEYS = [
  'manager',
  'package',
  'version',
  'python',
  'dir',
  'files',
  'entry',
  'args',
  'env',
  'clientFile',
  'author',
  'license',
  'sourceUrl',
  'downloadFrom',
  'approxMB',
  'tokenDir',
  'platforms',
  'tools'
]
/** Archivos de bloqueo que exige cada gestor (nombres exactos). */
export const LOCAL_LOCK_FILES: Record<LocalManager, string[]> = { uv: ['requirements.lock'], npm: ['package.json', 'package-lock.json'] }

/** Valor de una variable fija sin su marcador `{dir}`: lo que queda tiene que ser inocuo. */
const envValueOk = (v: string): boolean => ENV_VALUE_RE.test(v.split('{dir}').join('')) && v.length <= 300

function checkLocal(c: Rec, where: string, errs: string[]): void {
  if (c.url !== undefined) errs.push(`${where}: un conector local no lleva «url»`)
  if (c.writes !== false) errs.push(`${where}: en esta versión todo conector local es de solo consulta («writes»: false)`)
  if (Array.isArray(c.inputs) && c.inputs.length > 0)
    errs.push(`${where}: un conector local no pide «inputs» (nada que escriba la persona entra en un comando)`)
  const r = c.runtime
  if (!isRec(r)) {
    errs.push(`${where}: falta «runtime»`)
    return
  }
  const w = `${where}.runtime`
  strictKeys(r, RUNTIME_KEYS, w, errs)
  const manager = r.manager === 'uv' || r.manager === 'npm' ? r.manager : null
  if (!manager) errs.push(`${w}: «manager» debe ser "uv" o "npm"`)
  if (typeof r.package !== 'string' || !PACKAGE_RE.test(r.package) || r.package.length > 100) errs.push(`${w}: «package» inválido`)
  if (typeof r.version !== 'string' || !SEMVER_EXACT_RE.test(r.version))
    errs.push(`${w}: «version» debe ser EXACTA (por ejemplo 1.2.3, sin rangos ni «latest»)`)
  if (manager === 'uv') {
    if (typeof r.python !== 'string' || !/^3\.\d{1,2}$/.test(r.python)) errs.push(`${w}: «python» debe ser una versión como 3.12`)
  } else if (r.python !== undefined) errs.push(`${w}: «python» solo se usa con "uv"`)
  if (typeof r.dir !== 'string' || !ID_RE.test(r.dir)) errs.push(`${w}: «dir» inválido`)
  if (!Array.isArray(r.files) || r.files.length === 0) errs.push(`${w}: faltan los archivos de bloqueo («files»)`)
  else {
    const names: string[] = []
    for (const [i, f] of r.files.entries()) {
      if (!isRec(f)) {
        errs.push(`${w}.files[${i}]: no es un objeto`)
        continue
      }
      strictKeys(f, ['name', 'sha256'], `${w}.files[${i}]`, errs)
      if (typeof f.name !== 'string' || !FILE_NAME_RE.test(f.name)) errs.push(`${w}.files[${i}]: «name» inválido`)
      else names.push(f.name)
      if (typeof f.sha256 !== 'string' || !SHA256_RE.test(f.sha256))
        errs.push(`${w}.files[${i}]: «sha256» debe ser un hash SHA-256 en minúsculas (64 caracteres hex)`)
    }
    if (manager) {
      const need = LOCAL_LOCK_FILES[manager]
      if (names.length !== need.length || need.some((n) => !names.includes(n)))
        errs.push(`${w}: con "${manager}" los archivos de bloqueo son exactamente ${need.join(' y ')}`)
    }
  }
  if (typeof r.entry !== 'string' || !ENTRY_RE.test(r.entry) || r.entry.split('/').some((p) => p === '..' || p === '.'))
    errs.push(`${w}: «entry» debe ser una ruta relativa dentro de la carpeta del conector`)
  if (!Array.isArray(r.args) || r.args.length === 0 || r.args.length > 24) errs.push(`${w}: «args» necesita 1-24 argumentos fijos`)
  else {
    for (const a of r.args)
      if (typeof a !== 'string' || a.length > 80 || !ARG_RE.test(a) || FORBIDDEN_ARGS.has(a))
        errs.push(`${w}: argumento no permitido «${String(a)}» (solo caracteres simples y nada que convierta el programa en intérprete)`)
    if (!r.args.includes('--read-only')) errs.push(`${w}: «args» debe incluir --read-only (todo conector local es de solo consulta)`)
  }
  if (!isRec(r.env)) errs.push(`${w}: «env» debe ser un objeto`)
  else
    for (const [k, v] of Object.entries(r.env)) {
      if (!ENV_KEY_RE.test(k) || FORBIDDEN_ENV_RE.test(k)) errs.push(`${w}.env: variable no permitida «${k}»`)
      else if (typeof v !== 'string' || !envValueOk(v))
        errs.push(`${w}.env.${k}: valor no permitido (solo caracteres simples y el marcador {dir})`)
    }
  if (r.clientFile !== undefined) {
    const cf = r.clientFile
    if (!isRec(cf)) errs.push(`${w}: «clientFile» inválido`)
    else {
      strictKeys(cf, ['env', 'file', 'helpUrl'], `${w}.clientFile`, errs)
      if (!httpsUrl(cf.helpUrl)) errs.push(`${w}.clientFile: «helpUrl» debe ser https`)
      if (typeof cf.env !== 'string' || !ENV_KEY_RE.test(cf.env) || FORBIDDEN_ENV_RE.test(cf.env))
        errs.push(`${w}.clientFile: «env» inválido`)
      if (typeof cf.file !== 'string' || !FILE_NAME_RE.test(cf.file)) errs.push(`${w}.clientFile: «file» inválido`)
      if (isRec(r.env) && typeof cf.env === 'string' && cf.env in r.env)
        errs.push(`${w}.clientFile: «${cf.env}» no puede estar también en «env»`)
    }
  }
  if (!isStr(r.author, 1, 80)) errs.push(`${w}: falta «author»`)
  if (!isStr(r.license, 1, 40)) errs.push(`${w}: falta «license»`)
  if (!httpsUrl(r.sourceUrl)) errs.push(`${w}: «sourceUrl» debe ser https`)
  if (
    !Array.isArray(r.downloadFrom) ||
    r.downloadFrom.length === 0 ||
    r.downloadFrom.length > 8 ||
    !r.downloadFrom.every((h) => typeof h === 'string' && HOST_RE.test(h))
  )
    errs.push(`${w}: «downloadFrom» necesita 1-8 dominios`)
  if (!Number.isInteger(r.approxMB) || (r.approxMB as number) < 1 || (r.approxMB as number) > 2000)
    errs.push(`${w}: «approxMB» debe estar entre 1 y 2000`)
  if (typeof r.tokenDir !== 'string' || !FILE_NAME_RE.test(r.tokenDir)) errs.push(`${w}: «tokenDir» inválido`)
  if (
    !Array.isArray(r.platforms) ||
    r.platforms.length === 0 ||
    !r.platforms.every((p) => typeof p === 'string' && KNOWN_PLATFORMS.includes(p))
  )
    errs.push(`${w}: «platforms» inválido`)
  const tools = r.tools
  if (!isRec(tools)) errs.push(`${w}: falta «tools»`)
  else {
    strictKeys(tools, ['allowed', 'blocked', 'auth'], `${w}.tools`, errs)
    const okList = (v: unknown): v is string[] =>
      Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every((x) => typeof x === 'string' && TOOL_RE.test(x))
    if (!okList(tools.allowed)) errs.push(`${w}.tools: «allowed» inválido`)
    if (!okList(tools.blocked)) errs.push(`${w}.tools: «blocked» inválido`)
    if (!Array.isArray(tools.auth) || !tools.auth.every((x) => typeof x === 'string' && TOOL_RE.test(x)))
      errs.push(`${w}.tools: «auth» inválido`)
    if (okList(tools.allowed) && okList(tools.blocked)) {
      const dup = tools.allowed.filter((x) => (tools.blocked as string[]).includes(x))
      if (dup.length) errs.push(`${w}.tools: herramientas a la vez permitidas y bloqueadas: ${dup.join(', ')}`)
      if (new Set(tools.allowed).size !== tools.allowed.length || new Set(tools.blocked).size !== tools.blocked.length)
        errs.push(`${w}.tools: nombres repetidos`)
      if (Array.isArray(tools.auth) && tools.auth.some((x) => !(tools.allowed as string[]).includes(x as string)))
        errs.push(`${w}.tools: «auth» debe ser un subconjunto de «allowed»`)
    }
  }
}

/** Devuelve la lista de problemas del catálogo (vacía = válido). Estricto: una clave desconocida también es un problema. */
export function validateCatalog(input: unknown): string[] {
  const errs: string[] = []
  if (!isRec(input)) return ['el catálogo no es un objeto']
  strictKeys(input, ['$schema', 'schemaVersion', 'catalogVersion', 'updatedAt', 'groups', 'skills', 'connectors'], 'catálogo', errs)
  if (input.schemaVersion !== 2) errs.push('schemaVersion debe ser 2')
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
      if (c.transport === 'local') checkLocal(c, where, errs)
      else if (c.transport === 'remote') {
        if (!httpsUrl(c.url)) errs.push(`${where}: «url» debe ser https, sin credenciales, consulta ni fragmento`)
        if (c.runtime !== undefined) errs.push(`${where}: «runtime» solo existe en conectores locales`)
      } else errs.push(`${where}: «transport» debe ser "remote" o "local"`)
      if (!httpsUrl(c.docsUrl)) errs.push(`${where}: «docsUrl» debe ser https`)
      if (c.auth !== 'oauth' && c.auth !== 'token' && c.auth !== 'none' && c.auth !== 'account') errs.push(`${where}: «auth» inválido`)
      else if ((c.auth === 'account') !== (c.transport === 'local'))
        errs.push(`${where}: «auth» "account" es solo de los conectores locales (y ellos solo lo usan)`)
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
      if (c.accountTested !== undefined && typeof c.accountTested !== 'boolean')
        errs.push(`${where}: «accountTested» debe ser verdadero o falso`)
      checkCommon(c, where, updatedAt, errs)
    }
  return errs
}

const EMPTY: Catalog = { schemaVersion: 2, catalogVersion: 1, updatedAt: '1970-01-01', groups: [], skills: [], connectors: [] }

/** Problemas del archivo empaquetado (vacío = bien). Si hay alguno, el catálogo queda vacío y la pantalla muestra el aviso de error. */
export const CATALOG_ERRORS: string[] = validateCatalog(raw)

export const CATALOG: Catalog = CATALOG_ERRORS.length === 0 ? (raw as unknown as Catalog) : EMPTY

/** Sube cuando cambia el contenido del catálogo (queda anotada en la procedencia de cada instalación). */
export const CATALOG_VERSION = CATALOG.catalogVersion
