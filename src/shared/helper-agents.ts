/**
 * Ayudantes definidos por la persona (motor propio, `LAZUNOX.md` «Subagentes definidos por el usuario (2A)»): lectura de `GET /agent`,
 * archivo `.md` de `.opencode/agents/` (lectura y escritura del encabezado YAML) y validaciones. Funciones puras, sin Electron:
 * las comparten main (que toca el disco y habla con el motor) y la pantalla de Ajustes.
 *
 * TODO texto que viene de un archivo o del motor (nombre, descripción…) se trata como TEXTO PLANO: `plainText` quita controles y marcas
 * de dirección; la interfaz lo pinta en un nodo de texto, nunca como Markdown ni con enlaces activos.
 */
import { plainText } from './mcp-elicitation'

/** Nombre de archivo válido de un ayudante (sin rutas, sin puntos al principio). */
export const HELPER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** Nombres que la persona NO puede crear ni editar: los del motor y los de la app (sin distinguir mayúsculas). */
export const RESERVED_HELPER_NAMES: readonly string[] = [
  'chat',
  'tasks',
  'computer',
  'lazunox-helper',
  'lazunox-chat-helper',
  'build',
  'plan',
  'general',
  'explore',
  'verificador',
  'revisor'
]

export const HELPER_LIMITS = {
  name: 64,
  description: 500,
  prompt: 32_000,
  /** Tope del archivo completo que se lee o se escribe (bytes). */
  fileBytes: 64 * 1024,
  tools: 50,
  toolName: 80,
  skills: 50,
  maxTurns: 1000,
  model: 200,
  /** Archivos que se miran al contar los ayudantes de `.claude/agents`. */
  claudeScan: 200
} as const

/** Nombre de herramienta o de skill en las listas del encabezado. */
const ITEM_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:*-]*$/
/** `proveedor/modelo` (el motor lo parte en el primer `/`). */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:@+-]*$/

export function isReservedHelperName(name: string): boolean {
  return RESERVED_HELPER_NAMES.includes(name.toLowerCase())
}

export type HelperNameCheck = { ok: true } | { ok: false; reason: 'invalid' | 'reserved' }

export function checkHelperName(name: unknown): HelperNameCheck {
  if (typeof name !== 'string' || name.length === 0 || name.length > HELPER_LIMITS.name || !HELPER_NAME_RE.test(name))
    return { ok: false, reason: 'invalid' }
  // `a.md` y `a.` darían un archivo `a.md.md` / un nombre raro: el nombre no termina en punto ni en `.md`.
  if (name.endsWith('.') || name.toLowerCase().endsWith('.md') || name.includes('..')) return { ok: false, reason: 'invalid' }
  if (isReservedHelperName(name)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}

// ───────────────────────────── lista del motor ─────────────────────────────

export type HelperOrigin = 'opencode' | 'claude' | 'native' | 'other'

export interface HelperRule {
  permission: string
  pattern: string
  action: 'allow' | 'deny' | 'ask'
}

export interface HelperInfo {
  name: string
  description: string
  /** `small` = modelo pequeño del mismo proveedor que la sesión; `inherit` = el de la sesión; si no, `proveedor/modelo`. */
  model: string
  maxTurns: number | null
  background: boolean
  /** `null` = las skills de siempre. */
  skills: string[] | null
  allowedTools: string[]
  blockedTools: string[]
  /** `true` = lista blanca (`*: deny` y luego `allow` por herramienta). */
  whitelist: boolean
  native: boolean
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * Resume un conjunto de reglas de permiso: gana la última regla de patrón `*` de cada herramienta. Solo informativo (el motor decide de
 * verdad); sirve para mostrar «puede usar» y «bloqueadas».
 */
export function summarizeRules(rules: readonly HelperRule[]): { allowed: string[]; blocked: string[]; whitelist: boolean } {
  const last = new Map<string, 'allow' | 'deny' | 'ask'>()
  for (const r of rules) if (r.pattern === '*') last.set(r.permission, r.action)
  const whitelist = last.get('*') === 'deny'
  const allowed: string[] = []
  const blocked: string[] = []
  for (const [permission, action] of last) {
    if (permission === '*') continue
    if (action === 'deny') blocked.push(permission)
    else if (whitelist) allowed.push(permission)
  }
  return { allowed: allowed.sort(), blocked: blocked.sort(), whitelist }
}

function parseRules(raw: unknown): HelperRule[] {
  if (!Array.isArray(raw)) return []
  const out: HelperRule[] = []
  for (const r of raw.slice(0, 2000)) {
    const o = rec(r)
    if (typeof o.permission !== 'string' || typeof o.pattern !== 'string') continue
    if (o.action !== 'allow' && o.action !== 'deny' && o.action !== 'ask') continue
    out.push({ permission: o.permission.slice(0, 200), pattern: o.pattern.slice(0, 2000), action: o.action })
  }
  return out
}

const oneLine = (v: unknown, max: number): string =>
  plainText(v, max)
    .replace(/\s*\n\s*/g, ' ')
    .trim()

/**
 * `GET /agent` → solo los ayudantes (`mode != primary`) y sin los ocultos. Un elemento mal formado se descarta; el resto del
 * contenido es de un archivo de la persona o de un proyecto ajeno, así que todo texto pasa por `plainText`.
 */
export function parseHelperList(raw: unknown): HelperInfo[] {
  if (!Array.isArray(raw)) return []
  const out: HelperInfo[] = []
  for (const item of raw.slice(0, 500)) {
    const a = rec(item)
    if (typeof a.name !== 'string' || a.name.length === 0 || a.name.length > 200) continue
    if (a.mode === 'primary' || a.hidden === true) continue
    const model = rec(a.model)
    const modelText =
      a.modelSmall === true
        ? 'small'
        : typeof model.providerID === 'string' && typeof model.modelID === 'string'
          ? oneLine(`${model.providerID}/${model.modelID}`, HELPER_LIMITS.model)
          : 'inherit'
    const steps = typeof a.steps === 'number' && Number.isFinite(a.steps) && a.steps > 0 ? Math.floor(a.steps) : null
    const skills = Array.isArray(a.skills)
      ? a.skills
          .filter((s): s is string => typeof s === 'string')
          .slice(0, HELPER_LIMITS.skills)
          .map((s) => oneLine(s, HELPER_LIMITS.toolName))
      : null
    const s = summarizeRules(parseRules(a.permission))
    out.push({
      name: oneLine(a.name, 200),
      description: oneLine(a.description, HELPER_LIMITS.description),
      model: modelText,
      maxTurns: steps,
      background: a.background === true,
      skills,
      allowedTools: s.allowed.map((x) => oneLine(x, HELPER_LIMITS.toolName)),
      blockedTools: s.blocked.map((x) => oneLine(x, HELPER_LIMITS.toolName)),
      whitelist: s.whitelist,
      native: a.native === true
    })
  }
  return out
}

// ───────────────────────────── archivo .md ─────────────────────────────

/** Lo que la pantalla edita de un ayudante. */
export interface HelperDef {
  name: string
  description: string
  /** Texto del ayudante (cuerpo del `.md`). */
  prompt: string
  /** `small`, `inherit` o `proveedor/modelo`. */
  model: string
  disallowedTools: string[]
  maxTurns: number | null
  background: boolean
  /** `null` = no limitar las skills. */
  skills: string[] | null
}

/** Claves del encabezado que la pantalla escribe; el resto se conserva tal cual al editar. */
const MANAGED_KEYS = ['description', 'mode', 'model', 'disallowed_tools', 'max_turns', 'background', 'skills'] as const

export type HelperDefCheck = { ok: true } | { ok: false; field: string }

export function validateHelperDef(def: HelperDef): HelperDefCheck {
  if (!checkHelperName(def.name).ok) return { ok: false, field: 'name' }
  if (typeof def.description !== 'string' || def.description.length > HELPER_LIMITS.description || /[\r\n]/.test(def.description))
    return { ok: false, field: 'description' }
  if (typeof def.prompt !== 'string' || def.prompt.length > HELPER_LIMITS.prompt || def.prompt.includes('\0'))
    return { ok: false, field: 'prompt' }
  if (def.model !== 'small' && def.model !== 'inherit' && !(def.model.length <= HELPER_LIMITS.model && MODEL_ID_RE.test(def.model)))
    return { ok: false, field: 'model' }
  const okList = (l: string[] | null, max: number): boolean =>
    l === null ||
    (Array.isArray(l) && l.length <= max && l.every((x) => typeof x === 'string' && x.length <= HELPER_LIMITS.toolName && ITEM_RE.test(x)))
  if (def.disallowedTools === null || !okList(def.disallowedTools, HELPER_LIMITS.tools)) return { ok: false, field: 'disallowedTools' }
  if (!okList(def.skills, HELPER_LIMITS.skills)) return { ok: false, field: 'skills' }
  if (def.maxTurns !== null && !(Number.isInteger(def.maxTurns) && def.maxTurns >= 1 && def.maxTurns <= HELPER_LIMITS.maxTurns))
    return { ok: false, field: 'maxTurns' }
  if (typeof def.background !== 'boolean') return { ok: false, field: 'background' }
  return { ok: true }
}

interface Block {
  key: string
  lines: string[]
}

export interface ParsedHelperFile {
  /** Bloques del encabezado en su orden original. */
  blocks: Block[]
  body: string
}

/** Parte `---\n…\n---\ncuerpo`. Sin encabezado válido devuelve `null`. */
export function splitFrontmatter(text: string): ParsedHelperFile | null {
  const norm = text.replace(/\r\n?/g, '\n')
  if (!norm.startsWith('---\n')) return null
  const end = norm.indexOf('\n---', 3)
  if (end < 0) return null
  const after = norm.slice(end + 4)
  if (after.length > 0 && !after.startsWith('\n')) return null
  const head = norm.slice(4, end)
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line)
    if (m) {
      cur = { key: m[1]!, lines: [line] }
      blocks.push(cur)
    } else if (cur) {
      cur.lines.push(line)
    } else if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
      return null // texto suelto antes de la primera clave
    }
  }
  // Los renglones vacíos del final de cada bloque se quitan (se vuelven a poner al escribir).
  for (const b of blocks) while (b.lines.length > 1 && b.lines[b.lines.length - 1]!.trim() === '') b.lines.pop()
  return { blocks, body: after.startsWith('\n') ? after.slice(1) : after }
}

function unquote(raw: string): string | null {
  const v = raw.trim()
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) return null
    try {
      const s = JSON.parse(v) as unknown
      return typeof s === 'string' ? s : null
    } catch {
      return null
    }
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) return null
    return v.slice(1, -1).replace(/''/g, "'")
  }
  if (
    v.startsWith('[') ||
    v.startsWith('{') ||
    v.startsWith('|') ||
    v.startsWith('>') ||
    v.startsWith('&') ||
    v.startsWith('*') ||
    v.startsWith('!')
  )
    return null
  return v.replace(/\s+#.*$/, '').trim()
}

function scalarOf(block: Block): string | null {
  if (block.lines.length !== 1) return null
  const colon = block.lines[0]!.indexOf(':')
  return unquote(block.lines[0]!.slice(colon + 1))
}

function listOf(block: Block): string[] | null {
  const first = block.lines[0]!
  const rest = first.slice(first.indexOf(':') + 1).trim()
  if (rest.startsWith('[')) {
    if (block.lines.length !== 1) return null
    const m = /^\[(.*)\](\s+#.*)?$/.exec(rest)
    if (!m) return null
    const inner = m[1]!.trim()
    if (inner === '') return []
    const items: string[] = []
    for (const part of inner.split(',')) {
      const s = unquote(part)
      if (s === null || s === '') return null
      items.push(s)
    }
    return items
  }
  if (rest !== '' && !rest.startsWith('#')) return null
  const items: string[] = []
  for (const l of block.lines.slice(1)) {
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue
    const m = /^\s*-\s+(.+)$/.exec(l)
    if (!m) return null
    const s = unquote(m[1]!)
    if (s === null || s === '') return null
    items.push(s)
  }
  return items
}

export type ReadHelperResult =
  | { ok: true; def: HelperDef; mode: string }
  /** `complex`: claves cuyo formato la pantalla no sabe editar (se piden a mano). */
  | { ok: false; reason: 'format' | 'complex' | 'name'; complex?: string[] }

/** Lee lo editable de un `.md` de ayudante. Nunca lanza. */
export function readHelperFile(name: string, text: string): ReadHelperResult {
  if (!checkHelperName(name).ok) return { ok: false, reason: 'name' }
  const parsed = splitFrontmatter(text)
  if (!parsed) return { ok: false, reason: 'format' }
  const seen = new Set<string>()
  for (const b of parsed.blocks) {
    if (seen.has(b.key)) return { ok: false, reason: 'complex', complex: [b.key] }
    seen.add(b.key)
  }
  const find = (k: string): Block | undefined => parsed.blocks.find((b) => b.key === k)
  const complex: string[] = []
  const str = (k: string, fallback: string): string => {
    const b = find(k)
    if (!b) return fallback
    const v = scalarOf(b)
    if (v === null) {
      complex.push(k)
      return fallback
    }
    return v
  }
  const list = (k: string): string[] | null => {
    const b = find(k)
    if (!b) return null
    const v = listOf(b)
    if (v === null) {
      complex.push(k)
      return null
    }
    return v
  }
  const description = str('description', '')
  const modeRaw = str('mode', 'subagent')
  const modelRaw = str('model', 'inherit')
  const turnsRaw = str('max_turns', '')
  const bgRaw = str('background', '')
  const disallowed = list('disallowed_tools')
  const skills = list('skills')
  let maxTurns: number | null = null
  if (turnsRaw !== '') {
    if (/^\d+$/.test(turnsRaw)) maxTurns = Number(turnsRaw)
    else complex.push('max_turns')
  }
  if (bgRaw !== '' && bgRaw !== 'true' && bgRaw !== 'false') complex.push('background')
  const background = bgRaw === 'true'
  if (complex.length > 0) return { ok: false, reason: 'complex', complex }
  return {
    ok: true,
    mode: modeRaw,
    def: {
      name,
      description,
      prompt: parsed.body.replace(/^\n+/, '').replace(/\s+$/, ''),
      model: modelRaw === '' ? 'inherit' : modelRaw,
      disallowedTools: disallowed ?? [],
      maxTurns,
      background,
      skills
    }
  }
}

const yamlString = (s: string): string => JSON.stringify(s)
const yamlList = (l: readonly string[]): string => `[${l.map((x) => (ITEM_RE.test(x) ? x : yamlString(x))).join(', ')}]`

/**
 * Texto del `.md` a partir de la definición. Con `existing` (el archivo actual) conserva TAL CUAL las claves que la pantalla no
 * gestiona (`permission`, `tools`, `color`…) y el orden; sin él, crea uno nuevo con `mode: subagent`. Devuelve `null` si `existing` no
 * tiene un encabezado reconocible.
 */
export function buildHelperFile(def: HelperDef, existing?: string): string | null {
  const managed: Record<string, string[]> = {
    description: [`description: ${yamlString(def.description)}`],
    model: [`model: ${def.model}`],
    disallowed_tools: [`disallowed_tools: ${yamlList(def.disallowedTools)}`]
  }
  if (def.maxTurns !== null) managed.max_turns = [`max_turns: ${def.maxTurns}`]
  if (def.background) managed.background = ['background: true']
  if (def.skills !== null) managed.skills = [`skills: ${yamlList(def.skills)}`]
  // Sin lista, no hay clave (el motor lee ausente = nada que bloquear).
  if (def.disallowedTools.length === 0) delete managed.disallowed_tools

  let kept: Block[] = []
  let mode = 'subagent'
  const order: string[] = []
  if (existing !== undefined) {
    const parsed = splitFrontmatter(existing)
    if (!parsed) return null
    const m = parsed.blocks.find((b) => b.key === 'mode')
    const modeValue = m ? scalarOf(m) : null
    if (m && modeValue === null) return null
    if (modeValue) mode = modeValue
    kept = parsed.blocks.filter((b) => !(MANAGED_KEYS as readonly string[]).includes(b.key))
    for (const b of parsed.blocks) order.push(b.key)
  }
  if (!/^(subagent|primary|all)$/.test(mode)) return null
  managed.mode = [`mode: ${mode}`]

  const out: string[] = []
  const written = new Set<string>()
  // Orden estable: claves gestionadas en su sitio original si existían; las nuevas, al principio.
  const emitManaged = (k: string): void => {
    if (written.has(k) || !managed[k]) return
    written.add(k)
    out.push(...managed[k]!)
  }
  if (existing === undefined) {
    for (const k of MANAGED_KEYS) emitManaged(k)
  } else {
    for (const k of order) {
      if ((MANAGED_KEYS as readonly string[]).includes(k)) emitManaged(k)
      else out.push(...kept.find((b) => b.key === k)!.lines)
    }
    for (const k of MANAGED_KEYS) emitManaged(k)
  }
  const body = def.prompt.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  return `---\n${out.join('\n')}\n---\n${body}${body ? '\n' : ''}`
}

// ───────────────────────────── contrato IPC ─────────────────────────────

export interface HelperView extends HelperInfo {
  origin: HelperOrigin
  /** `true` si hay un `.md` en `.opencode/agents/` de la carpeta que la pantalla puede editar. */
  editable: boolean
  /** `true` = el archivo existe en `.opencode/agents/` pero el motor aún no lo cargó: se activa al reiniciar Lazunox. */
  pending?: boolean
}

export type HelpersListResult = { available: false } | { available: true; helpers: HelperView[]; claudeNames: string[] }

export type HelperReadResult =
  { ok: true; def: HelperDef } | { ok: false; reason: 'folder' | 'name' | 'missing' | 'format' | 'complex' | 'too_big'; complex?: string[] }

export type HelperSaveResult =
  | { ok: true }
  | {
      ok: false
      reason: 'folder' | 'name' | 'reserved' | 'invalid' | 'exists' | 'missing' | 'format' | 'complex' | 'link' | 'io'
      field?: string
    }

export interface ForeignAgentsResult {
  /** Nombres (texto plano) de los `.md` de `.claude/agents` de la carpeta; vacío si no hay. */
  names: string[]
}

export const CLAUDE_NAMES_SHOWN = 8

/** Solo los nombres cuyo aspecto es el de un ayudante (texto plano y corto). */
export function claudeAgentLabel(file: string): string | null {
  if (!file.toLowerCase().endsWith('.md')) return null
  const base = file.slice(0, -3)
  return base.length > 0 && base.length <= HELPER_LIMITS.name ? oneLine(base, HELPER_LIMITS.name) : null
}
