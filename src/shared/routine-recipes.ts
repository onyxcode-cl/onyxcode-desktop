/**
 * Recetas de Rutinas (F8-B188). Es UN archivo de datos versionado dentro de la app: `resources/rutinas/recetas.json`.
 * No hay servidor ni descargas: lo que se ve es lo que viaja en el paquete. Una receta NO crea ni ejecuta nada: solo rellena el
 * formulario de «Nueva rutina» (`buildRecipeInput`); la persona lo revisa, lo edita y lo guarda ella (con las mismas reglas de
 * siempre: términos de Rutinas, carpeta aprobada, límites, resultado a la bandeja).
 *
 * Reglas que `validateRecipes` hace cumplir (la prueba `routine-recipes.test.ts` falla si una receta no las cumple):
 *  - Textos en español e inglés, ambos presentes y no copiados.
 *  - Nada se promete sin respaldo: lo que la receta «hace» no puede ser mover, borrar, enviar, comprar ni publicar; usar la web
 *    solo en modo Chat (el único con ese permiso garantizado); y toda receta con carpeta declara qué NO hace.
 *  - Una receta con carpeta pide solo lectura: la lista de «permitir sin preguntar» solo admite lecturas y comandos de
 *    lectura de git, nunca editar ni borrar, y `onAsk` es siempre «rechazar» (nadie mira mientras corre).
 *  - El texto de la instrucción repite que no modifica nada y deja el resultado en la respuesta (que va a la bandeja).
 */
import raw from '../../resources/rutinas/recetas.json'
import type { Lang } from './i18n'
import type { RoutineAllowRule, RoutineInput, RoutineMode, RoutineSchedule } from './ipc-tasks'
import type { ModelRef } from './types'

export interface Bi {
  es: string
  en: string
}

/** Íconos permitidos (el renderer solo conoce estos; un nombre nuevo exige añadirlo allí y aquí). */
export const RECIPE_ICONS = [
  'newspaper',
  'folder-open',
  'files',
  'inbox',
  'wallet',
  'shopping-cart',
  'graduation-cap',
  'telescope',
  'dumbbell',
  'git-branch',
  'scroll-text',
  'list-checks'
] as const
export type RecipeIcon = (typeof RECIPE_ICONS)[number]

export type RecipeAudience = 'everyone' | 'technical'
export type RecipeAccessLevel = 'none' | 'read-folder' | 'read-project'

export interface RecipeFolderQuestion {
  id: string
  kind: 'folder'
  label: Bi
  help: Bi
}
export interface RecipeTextQuestion {
  id: string
  kind: 'text'
  label: Bi
  help?: Bi
  placeholder: Bi
  default?: Bi
  required: boolean
  maxLength: number
}
export type RecipeQuestion = RecipeFolderQuestion | RecipeTextQuestion

export interface RoutineRecipe {
  id: string
  icon: RecipeIcon
  audience: RecipeAudience
  title: Bi
  description: Bi
  /** Lo que hace (verdades comprobables; nunca cambiar, enviar, comprar ni publicar). */
  does: Bi[]
  /** Lo que NO hace. */
  doesNot: Bi[]
  mode: RoutineMode
  access: { level: RecipeAccessLevel; text: Bi }
  usesWeb: boolean
  /** Qué datos salen de este equipo hacia el servicio de IA. */
  dataNote: Bi
  /** Para el disparador por archivo, `folder` va vacío: lo completa el formulario con la carpeta elegida. */
  schedule: RoutineSchedule
  questions: RecipeQuestion[]
  name: Bi
  /** Admite `{{ask:id}}` (respuesta de una pregunta de texto) y, con disparador por archivo, `{{archivos}}`. */
  prompt: Bi
  sessionMode: 'fresh' | 'continue'
  onAsk: 'reject' | 'wait'
  allow: RoutineAllowRule[]
  verifiedAt: string
  verification: string
}

export interface RecipeCatalog {
  schema: 1
  updatedAt: string
  recipes: RoutineRecipe[]
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
const ASK_RE = /\{\{ask:([a-z0-9-]+)\}\}/g
/** Variables que el disparador por archivo sustituye al ejecutar (`buildFilePrompt`). */
const FILE_VARS_RE = /\{\{\s*(archivo|archivos|carpeta|file|files|folder)\s*\}\}/gi

/** Lecturas que una receta puede dejar «sin preguntar». Cualquier otra regla (editar, escribir, borrar, mover…) se rechaza. */
export const SAFE_READ_PERMISSIONS: readonly string[] = ['read', 'list', 'glob', 'grep']
export const SAFE_BASH_PATTERNS: readonly string[] = [
  'ls*',
  'git log*',
  'git show*',
  'git diff*',
  'git status*',
  'git shortlog*',
  'git blame*'
]

/** Verbos que una receta no puede presentar como cosa que HACE (solo como lo que NO hace). */
const PROMISE_ES =
  /(?<!\p{L})(mueve|mover|borra|borrar|elimina|eliminar|envía|enviar|manda|mandar|publica|publicar|compra|comprar|paga|pagar|instala|instalar|renombra|renombrar)(?!\p{L})/iu
const PROMISE_EN =
  /(?<!\p{L})(moves?|deletes?|removes?|sends?|emails?|posts?|publish(es)?|buys?|purchases?|pays?|installs?|renames?)(?!\p{L})/iu
const WEB_ES = /(?<!\p{L})(web|internet|en línea)(?!\p{L})/iu
const WEB_EN = /(?<!\p{L})(web|internet|online)(?!\p{L})/iu
/** Cláusula obligatoria en la instrucción de las recetas con carpeta: no modifica nada. */
const NO_CHANGE_ES = /no (modifiques|cambies|muevas|borres|renombres)/i
const NO_CHANGE_EN = /do not (modify|change|move|delete|rename)/i

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

function strictKeys(o: Rec, allowed: readonly string[], where: string, errs: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(`${where}: clave desconocida «${k}»`)
}

function checkBi(v: unknown, where: string, errs: string[], opts: { max: number; min?: number; sameOk?: boolean }): v is Bi {
  if (!isRec(v)) {
    errs.push(`${where}: debe llevar «es» y «en»`)
    return false
  }
  strictKeys(v, ['es', 'en'], where, errs)
  let ok = true
  for (const l of ['es', 'en'] as const) {
    const s = v[l]
    if (typeof s !== 'string' || s.trim().length < (opts.min ?? 1)) {
      errs.push(`${where}.${l}: falta el texto`)
      ok = false
    } else if (s.length > opts.max) {
      errs.push(`${where}.${l}: demasiado largo (${s.length} > ${opts.max})`)
      ok = false
    } else if (s !== s.trim()) {
      errs.push(`${where}.${l}: espacios sobrantes`)
      ok = false
    }
  }
  if (ok && !opts.sameOk && (v.es as string).length > 24 && v.es === v.en) {
    errs.push(`${where}: el texto en inglés es idéntico al español (¿sin traducir?)`)
    ok = false
  }
  return ok
}

function checkSchedule(s: unknown, where: string, errs: string[]): void {
  if (!isRec(s)) {
    errs.push(`${where}: debe ser un objeto`)
    return
  }
  if (s.kind === 'daily') {
    strictKeys(s, ['kind', 'time'], where, errs)
    if (typeof s.time !== 'string' || !HHMM_RE.test(s.time)) errs.push(`${where}: «time» debe ser HH:MM`)
  } else if (s.kind === 'weekly') {
    strictKeys(s, ['kind', 'day', 'time'], where, errs)
    if (!Number.isInteger(s.day) || (s.day as number) < 0 || (s.day as number) > 6) errs.push(`${where}: «day» debe ser 0 a 6`)
    if (typeof s.time !== 'string' || !HHMM_RE.test(s.time)) errs.push(`${where}: «time» debe ser HH:MM`)
  } else if (s.kind === 'file') {
    strictKeys(s, ['kind', 'folder', 'patterns', 'on', 'settleSec', 'maxPerHour'], where, errs)
    if (s.folder !== '') errs.push(`${where}: «folder» debe ir vacío (lo elige la persona)`)
    if (!Array.isArray(s.patterns) || s.patterns.some((p) => typeof p !== 'string' || /[\\/]/.test(p)))
      errs.push(`${where}: «patterns» inválido`)
    if (s.on !== 'create') errs.push(`${where}: una receta solo reacciona a archivos nuevos («create»)`)
    if (!Number.isInteger(s.settleSec) || (s.settleSec as number) < 1 || (s.settleSec as number) > 120)
      errs.push(`${where}: «settleSec» fuera de rango`)
    // Tope bajo a propósito: cada disparo es una ejecución con la IA.
    if (!Number.isInteger(s.maxPerHour) || (s.maxPerHour as number) < 1 || (s.maxPerHour as number) > 10)
      errs.push(`${where}: «maxPerHour» debe ser de 1 a 10`)
  } else {
    errs.push(`${where}: «kind» debe ser daily, weekly o file (las recetas no usan intervalos ni cron)`)
  }
}

function checkRecipe(r: unknown, i: number, errs: string[]): string | null {
  const where = `recipes[${i}]`
  if (!isRec(r)) {
    errs.push(`${where}: no es un objeto`)
    return null
  }
  strictKeys(
    r,
    [
      'id',
      'icon',
      'audience',
      'title',
      'description',
      'does',
      'doesNot',
      'mode',
      'access',
      'usesWeb',
      'dataNote',
      'schedule',
      'questions',
      'name',
      'prompt',
      'sessionMode',
      'onAsk',
      'allow',
      'verifiedAt',
      'verification'
    ],
    where,
    errs
  )
  const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : null
  if (!id) errs.push(`${where}: «id» inválido`)
  const tag = id ? `receta «${id}»` : where
  if (!RECIPE_ICONS.includes(r.icon as RecipeIcon)) errs.push(`${tag}: «icon» no permitido`)
  if (r.audience !== 'everyone' && r.audience !== 'technical') errs.push(`${tag}: «audience» inválido`)
  checkBi(r.title, `${tag}.title`, errs, { max: 60, min: 8 })
  checkBi(r.description, `${tag}.description`, errs, { max: 200, min: 30 })
  checkBi(r.name, `${tag}.name`, errs, { max: 80, min: 4 })
  checkBi(r.dataNote, `${tag}.dataNote`, errs, { max: 220, min: 20 })

  const mode = r.mode
  if (mode !== 'chat' && mode !== 'tasks' && mode !== 'code') errs.push(`${tag}: «mode» inválido`)
  const hasFolder = mode === 'tasks' || mode === 'code'

  for (const key of ['does', 'doesNot'] as const) {
    const list = r[key]
    if (!Array.isArray(list) || list.length < (key === 'does' ? 1 : 1) || list.length > 5) {
      errs.push(`${tag}.${key}: debe tener de 1 a 5 elementos`)
      continue
    }
    for (const [j, b] of list.entries()) {
      if (!checkBi(b, `${tag}.${key}[${j}]`, errs, { max: 260, min: 10 }) || key !== 'does') continue
      if (PROMISE_ES.test(b.es))
        errs.push(`${tag}.does[${j}]: promete una acción que cambia cosas («${b.es.match(PROMISE_ES)?.[0]}»); va en «doesNot»`)
      if (PROMISE_EN.test(b.en)) errs.push(`${tag}.does[${j}]: promises an action that changes things («${b.en.match(PROMISE_EN)?.[0]}»)`)
    }
  }

  if (!isRec(r.access)) errs.push(`${tag}.access: debe ser un objeto`)
  else {
    strictKeys(r.access, ['level', 'text'], `${tag}.access`, errs)
    if (!['none', 'read-folder', 'read-project'].includes(r.access.level as string)) errs.push(`${tag}.access.level inválido`)
    checkBi(r.access.text, `${tag}.access.text`, errs, { max: 220, min: 20 })
    if (mode === 'chat' && r.access.level !== 'none') errs.push(`${tag}: una receta de Chat no pide acceso a carpetas`)
    if (mode === 'tasks' && r.access.level !== 'read-folder') errs.push(`${tag}: una receta con carpeta pide «read-folder»`)
    if (mode === 'code' && r.access.level !== 'read-project') errs.push(`${tag}: una receta de Code pide «read-project»`)
  }

  if (typeof r.usesWeb !== 'boolean') errs.push(`${tag}: «usesWeb» debe ser verdadero o falso`)
  // La web solo está garantizada en Chat: en Overdrive depende de los sitios que la persona permita.
  if (r.usesWeb === true && mode !== 'chat') errs.push(`${tag}: usar la web solo está respaldado en Chat`)
  const doesText = Array.isArray(r.does) ? r.does.filter(isRec) : []
  if (r.usesWeb !== true && doesText.some((d) => typeof d.es === 'string' && WEB_ES.test(d.es)))
    errs.push(`${tag}: menciona la web pero «usesWeb» es falso`)
  if (r.usesWeb !== true && doesText.some((d) => typeof d.en === 'string' && WEB_EN.test(d.en)))
    errs.push(`${tag}: mentions the web but «usesWeb» is false`)

  checkSchedule(r.schedule, `${tag}.schedule`, errs)
  const isFile = isRec(r.schedule) && r.schedule.kind === 'file'
  if (isFile && mode === 'chat') errs.push(`${tag}: el disparador por archivo exige una carpeta (no es de Chat)`)

  // Preguntas.
  const textIds = new Set<string>()
  let folderQuestions = 0
  if (!Array.isArray(r.questions)) errs.push(`${tag}.questions: debe ser una lista`)
  else
    for (const [j, q] of r.questions.entries()) {
      const qw = `${tag}.questions[${j}]`
      if (!isRec(q)) {
        errs.push(`${qw}: no es un objeto`)
        continue
      }
      if (typeof q.id !== 'string' || !ID_RE.test(q.id)) errs.push(`${qw}: «id» inválido`)
      checkBi(q.label, `${qw}.label`, errs, { max: 120, min: 6 })
      if (q.kind === 'folder') {
        strictKeys(q, ['id', 'kind', 'label', 'help'], qw, errs)
        checkBi(q.help, `${qw}.help`, errs, { max: 200, min: 10 })
        folderQuestions++
      } else if (q.kind === 'text') {
        strictKeys(q, ['id', 'kind', 'label', 'help', 'placeholder', 'default', 'required', 'maxLength'], qw, errs)
        if (q.help !== undefined) checkBi(q.help, `${qw}.help`, errs, { max: 200, min: 5 })
        checkBi(q.placeholder, `${qw}.placeholder`, errs, { max: 120, min: 2, sameOk: true })
        if (q.default !== undefined) checkBi(q.default, `${qw}.default`, errs, { max: 160, min: 1, sameOk: true })
        if (typeof q.required !== 'boolean') errs.push(`${qw}: «required» debe ser verdadero o falso`)
        if (!Number.isInteger(q.maxLength) || (q.maxLength as number) < 1 || (q.maxLength as number) > 300)
          errs.push(`${qw}: «maxLength» de 1 a 300`)
        // Sin valor por omisión, una pregunta opcional dejaría un hueco en la instrucción.
        if (q.required === false && q.default === undefined) errs.push(`${qw}: una pregunta opcional necesita «default»`)
        if (typeof q.id === 'string') {
          if (textIds.has(q.id)) errs.push(`${qw}: id repetido «${q.id}»`)
          textIds.add(q.id)
        }
      } else errs.push(`${qw}: «kind» debe ser folder o text`)
    }
  if (hasFolder && folderQuestions !== 1) errs.push(`${tag}: una receta con carpeta lleva exactamente una pregunta de carpeta`)
  if (!hasFolder && folderQuestions > 0) errs.push(`${tag}: una receta de Chat no lleva pregunta de carpeta`)

  // Instrucción.
  const promptOk = checkBi(r.prompt, `${tag}.prompt`, errs, { max: 2500, min: 80 })
  if (promptOk) {
    const p = r.prompt as Bi
    const usedEs = new Set([...p.es.matchAll(ASK_RE)].map((m) => m[1]))
    const usedEn = new Set([...p.en.matchAll(ASK_RE)].map((m) => m[1]))
    for (const used of [usedEs, usedEn]) {
      for (const u of used) if (!textIds.has(u)) errs.push(`${tag}.prompt: «{{ask:${u}}}» no tiene pregunta`)
      for (const tId of textIds) if (!used.has(tId)) errs.push(`${tag}.prompt: la pregunta «${tId}» no se usa en la instrucción`)
    }
    for (const l of ['es', 'en'] as const) {
      const rest = p[l].replace(ASK_RE, '')
      const vars = rest.match(FILE_VARS_RE) ?? []
      if (vars.length > 0 && !isFile) errs.push(`${tag}.prompt.${l}: las variables de archivo solo valen con disparador por archivo`)
      if (/\{\{|\}\}/.test(rest.replace(FILE_VARS_RE, ''))) errs.push(`${tag}.prompt.${l}: llaves {{ }} sin resolver`)
    }
    if (isFile && !new RegExp(FILE_VARS_RE.source, 'i').test(p.es))
      errs.push(`${tag}.prompt.es: con disparador por archivo debe nombrar {{archivos}}`)
    if (hasFolder) {
      if (!NO_CHANGE_ES.test(p.es)) errs.push(`${tag}.prompt.es: debe decir que no modifica, mueve ni borra nada`)
      if (!NO_CHANGE_EN.test(p.en)) errs.push(`${tag}.prompt.en: must say it does not modify, move or delete anything`)
      if (!/respuesta final/i.test(p.es) || !/final reply/i.test(p.en))
        errs.push(`${tag}.prompt: el resultado debe quedar en la respuesta final (bandeja)`)
    }
  }

  // Ejecución desatendida y permisos.
  if (r.sessionMode !== 'fresh' && r.sessionMode !== 'continue') errs.push(`${tag}: «sessionMode» inválido`)
  if (r.onAsk !== 'reject') errs.push(`${tag}: «onAsk» debe ser «reject» (nadie mira mientras corre)`)
  if (!Array.isArray(r.allow)) errs.push(`${tag}.allow: debe ser una lista`)
  else {
    // Solo Overdrive aplica la lista de «permitir sin preguntar»; en Chat y Code el planificador la descarta, así que no se promete.
    if (mode !== 'tasks' && r.allow.length > 0)
      errs.push(`${tag}.allow: solo las recetas con carpeta de Overdrive llevan reglas (en Chat y Code se descartan)`)
    for (const [j, a] of r.allow.entries()) {
      const aw = `${tag}.allow[${j}]`
      if (!isRec(a)) {
        errs.push(`${aw}: no es un objeto`)
        continue
      }
      strictKeys(a, ['permission', 'pattern'], aw, errs)
      if (a.permission === 'bash') {
        if (typeof a.pattern !== 'string' || !SAFE_BASH_PATTERNS.includes(a.pattern))
          errs.push(`${aw}: comando no permitido en una receta («${String(a.pattern)}»)`)
      } else if (typeof a.permission === 'string' && SAFE_READ_PERMISSIONS.includes(a.permission)) {
        if (a.pattern !== '*') errs.push(`${aw}: las lecturas llevan patrón «*»`)
      } else errs.push(`${aw}: permiso no permitido en una receta («${String(a.permission)}»); solo lecturas`)
    }
  }

  if (typeof r.verifiedAt !== 'string' || !DATE_RE.test(r.verifiedAt)) errs.push(`${tag}: «verifiedAt» debe ser AAAA-MM-DD`)
  if (typeof r.verification !== 'string' || r.verification.length < 20) errs.push(`${tag}: «verification» debe explicar cómo se comprobó`)
  return id
}

/** Devuelve la lista de problemas del archivo de recetas (vacía = válido). Estricto: una clave desconocida también es un problema. */
export function validateRecipes(input: unknown): string[] {
  const errs: string[] = []
  if (!isRec(input)) return ['el archivo de recetas no es un objeto']
  strictKeys(input, ['schema', 'updatedAt', 'recipes'], 'recetas', errs)
  if (input.schema !== 1) errs.push('schema debe ser 1')
  if (typeof input.updatedAt !== 'string' || !DATE_RE.test(input.updatedAt)) errs.push('updatedAt debe ser AAAA-MM-DD')
  if (!Array.isArray(input.recipes)) return [...errs, 'recipes debe ser una lista']
  if (input.recipes.length === 0) errs.push('recipes está vacío')
  const seen = new Set<string>()
  for (const [i, r] of input.recipes.entries()) {
    const id = checkRecipe(r, i, errs)
    if (id) {
      if (seen.has(id)) errs.push(`id repetido «${id}»`)
      seen.add(id)
    }
  }
  return errs
}

/** Problemas del archivo empaquetado (vacío = bien). Si hay alguno, no se ofrece ninguna receta. */
export const RECIPE_ERRORS: string[] = validateRecipes(raw)

export const RECIPES: RoutineRecipe[] = RECIPE_ERRORS.length === 0 ? (raw as unknown as RecipeCatalog).recipes : []

export function recipeById(id: string): RoutineRecipe | undefined {
  return RECIPES.find((r) => r.id === id)
}

/** Texto de una pareja es/en en el idioma pedido. */
export function bi(v: Bi, lang: Lang): string {
  return v[lang]
}

export function folderQuestion(r: RoutineRecipe): RecipeFolderQuestion | undefined {
  return r.questions.find((q): q is RecipeFolderQuestion => q.kind === 'folder')
}

export function textQuestions(r: RoutineRecipe): RecipeTextQuestion[] {
  return r.questions.filter((q): q is RecipeTextQuestion => q.kind === 'text')
}

/** Respuestas por defecto (las de las preguntas de texto que traen valor). */
export function defaultAnswers(r: RoutineRecipe, lang: Lang): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of textQuestions(r)) out[q.id] = q.default ? q.default[lang] : ''
  return out
}

/** Una respuesta limpia: una sola línea, sin llaves (no puede colarse otra variable) y con el tope de la pregunta. */
export function cleanAnswer(raw: string, max: number): string {
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Preguntas de texto obligatorias que siguen sin respuesta. */
export function missingAnswers(r: RoutineRecipe, answers: Record<string, string>): RecipeTextQuestion[] {
  return textQuestions(r).filter((q) => q.required && cleanAnswer(answers[q.id] ?? '', q.maxLength) === '')
}

/**
 * Prepara el formulario de «Nueva rutina» a partir de una receta. No guarda nada. La carpeta queda vacía: la elige la persona en el
 * formulario (donde se aprueba, igual que en cualquier rutina). Una pregunta opcional en blanco toma su valor por omisión.
 */
export function buildRecipeInput(r: RoutineRecipe, lang: Lang, answers: Record<string, string>, model: ModelRef): RoutineInput {
  let prompt = r.prompt[lang]
  for (const q of textQuestions(r)) {
    const typed = cleanAnswer(answers[q.id] ?? '', q.maxLength)
    const value = typed || (q.default ? cleanAnswer(q.default[lang], q.maxLength) : '')
    prompt = prompt.split(`{{ask:${q.id}}}`).join(value)
  }
  const input: RoutineInput = {
    name: r.name[lang],
    prompt,
    mode: r.mode,
    folder: null,
    model,
    schedule: JSON.parse(JSON.stringify(r.schedule)) as RoutineSchedule,
    enabled: true,
    sessionMode: r.sessionMode,
    onAsk: r.onAsk,
    allow: r.allow.map((a) => ({ ...a }))
  }
  // El resto (carpeta, límites de red, Control total) sigue siendo decisión de la persona en el formulario.
  return input
}
