/**
 * H5: ayudantes y comandos del proyecto en Tareas con jaula, leídos por main y SANEADOS.
 *
 * Con `OPENCODE_DISABLE_PROJECT_CONFIG=1` (`project-code.ts`) el motor con jaula ya no lee `.opencode/` de la carpeta. Los ayudantes que la
 * persona crea en Ajustes → Ayudantes viven en `<carpeta>/.opencode/agents/` y los comandos en `.opencode/command(s)/`. Para no perderlos,
 * main los lee aquí y los pasa por la config inline. La carpeta la puede escribir la tarea: su contenido NO es de fiar.
 *
 * Reglas:
 *  - Sin seguir enlaces: cada carpeta del camino tiene que ser real (`isRealDir`) y cada archivo se abre con `O_NOFOLLOW`
 *    (`readFileNoFollow`). Un enlace se ignora.
 *  - Ayudantes (`.opencode/agent(s)/**.md` y `.claude/agents/**.md`; gana `.opencode`): solo `description`, el texto (cuerpo), `color` y,
 *    porque solo RESTRINGEN, `disallowed_tools` y `max_turns`. Siempre `mode: subagent`. Se descarta todo lo demás (`permission`, `tools`,
 *    `model`, `mcp`, `hooks`, rutas, variables y cualquier clave desconocida): el ayudante queda con los permisos que el motor da a un
 *    ayudante de la sesión de Tareas, nunca más. Un nombre reservado (agentes del motor y de la app) se ignora.
 *  - Comandos (`.opencode/command(s)/**.md`): solo plantillas de TEXTO. Se omite el que tenga `` !`…` `` (ejecución) o una referencia
 *    `@…` a archivos (el motor la resuelve contra la raíz del repositorio o `/`, o contra `~`: puede salir de la carpeta). Quedan
 *    `template`, `description`, `subtask` y `agent` solo si apunta a un ayudante aceptado aquí. Se descarta `model` y lo demás.
 *  - Topes: 20 ayudantes y 50 comandos; 32 KB por archivo; profundidad 3.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RESERVED_HELPER_NAMES, splitFrontmatter, HELPER_LIMITS } from '@shared/helper-agents'
import { plainText } from '@shared/mcp-elicitation'
import { isRealDir, readFileNoFollow } from './no-follow'

export const PROJECT_HELPER_LIMITS = { helpers: 20, commands: 50, fileBytes: 32 * 1024, depth: 3, description: 500, maxTurns: 1000 } as const

/** Nombres que un ayudante del proyecto no puede ocupar (motor + app). Sin distinguir mayúsculas. */
export const RESERVED_AGENT_NAMES: readonly string[] = [...RESERVED_HELPER_NAMES, 'compaction', 'title', 'summary']

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const COLOR_RE = /^(#[0-9a-fA-F]{6}|primary|secondary|accent|success|warning|error|info)$/
const TOOL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:*-]{0,79}$/
/** Igual que el motor (`session/prompt.ts:2015`): `` !`cmd` `` se ejecuta al usar el comando. */
const SHELL_RE = /!`[^`]*`/
/** Igual que el motor (`config/markdown.ts:5`): `@ruta` se convierte en un archivo adjunto. */
const FILE_RE = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/

export interface ProjectAgent {
  description?: string
  prompt: string
  mode: 'subagent'
  color?: string
  disallowed_tools?: string[]
  max_turns?: number
}

export interface ProjectCommand {
  template: string
  description?: string
  subtask?: boolean
  agent?: string
}

export interface ProjectHelpersResult {
  agents: Record<string, ProjectAgent>
  commands: Record<string, ProjectCommand>
  /** Comandos omitidos (nombre y motivo), para el registro. */
  skipped: Array<{ kind: 'agent' | 'command'; name: string; reason: string }>
}

/** `.md` dentro de `dir` (sin seguir enlaces, hasta `depth`), con su nombre relativo sin `.md` (`sub/nombre`). */
function listMd(dir: string, depth: number, prefix = ''): Array<{ name: string; file: string }> {
  if (!isRealDir(dir)) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ name: string; file: string }> = []
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      if (depth > 1 && SEGMENT_RE.test(e.name)) out.push(...listMd(join(dir, e.name), depth - 1, `${prefix}${e.name}/`))
      continue
    }
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue
    const base = e.name.slice(0, -3)
    if (!SEGMENT_RE.test(base)) continue
    out.push({ name: `${prefix}${base}`, file: join(dir, e.name) })
  }
  return out
}

/** Valor escalar de una línea `clave: valor` (comillas JSON o simples); listas, bloques y anclas = null. */
function scalar(lines: string[]): string | null {
  if (lines.length !== 1) return null
  const v = lines[0]!.slice(lines[0]!.indexOf(':') + 1).trim()
  if (v.startsWith('"')) {
    try {
      const s = JSON.parse(v) as unknown
      return typeof s === 'string' ? s : null
    } catch {
      return null
    }
  }
  if (v.startsWith("'")) return v.length >= 2 && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : null
  if (/^[[{|>&*!]/.test(v)) return null
  return v.replace(/\s+#.*$/, '').trim()
}

/** Lista `[a, b]` o `- a` / `- b`, o una cadena separada por comas. */
function list(lines: string[]): string[] | null {
  const rest = lines[0]!.slice(lines[0]!.indexOf(':') + 1).trim()
  let items: string[]
  if (rest.startsWith('[')) {
    const m = lines.length === 1 ? /^\[(.*)\]$/.exec(rest) : null
    if (!m) return null
    items = m[1]!.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''))
  } else if (rest === '') {
    items = lines.slice(1).map((l) => /^\s*-\s+(.+)$/.exec(l)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '')
  } else {
    const s = scalar(lines)
    if (s === null) return null
    items = s.split(',').map((x) => x.trim())
  }
  items = items.filter((x) => x !== '')
  return items.length <= HELPER_LIMITS.tools && items.every((x) => TOOL_RE.test(x)) ? items : null
}

interface Parsed {
  fields: Map<string, string[]>
  body: string
}

function parse(file: string): Parsed | null {
  const read = readFileNoFollow(file, PROJECT_HELPER_LIMITS.fileBytes)
  if (!read) return null
  const text = read.content.toString('utf8')
  if (text.includes('\0')) return null
  const fm = splitFrontmatter(text)
  if (!fm) return { fields: new Map(), body: text.replace(/\r\n?/g, '\n').trim() }
  const fields = new Map<string, string[]>()
  for (const b of fm.blocks) if (!fields.has(b.key)) fields.set(b.key, b.lines)
  return { fields, body: fm.body.trim() }
}

const oneLine = (v: string, max: number): string =>
  plainText(v, max)
    .replace(/\s*\n\s*/g, ' ')
    .trim()

const isReserved = (name: string, extra: ReadonlySet<string>): boolean => {
  const n = name.toLowerCase()
  const last = n.split('/').pop() ?? n
  return RESERVED_AGENT_NAMES.includes(n) || RESERVED_AGENT_NAMES.includes(last) || extra.has(n) || extra.has(last)
}

function toAgent(p: Parsed): ProjectAgent | null {
  const prompt = plainText(p.body, HELPER_LIMITS.prompt).trim()
  if (!prompt) return null
  const out: ProjectAgent = { prompt, mode: 'subagent' }
  const desc = p.fields.get('description')
  const d = desc ? scalar(desc) : null
  if (d) out.description = oneLine(d, PROJECT_HELPER_LIMITS.description)
  const color = p.fields.get('color')
  const c = color ? scalar(color) : null
  if (c && COLOR_RE.test(c)) out.color = c
  // Solo restringen (el motor nunca amplía con ellas): se conservan.
  const dis = p.fields.get('disallowed_tools') ?? p.fields.get('disallowedTools')
  const dl = dis ? list(dis) : null
  if (dl && dl.length) out.disallowed_tools = dl
  const turns = p.fields.get('max_turns') ?? p.fields.get('maxTurns')
  const t = turns ? scalar(turns) : null
  if (t && /^\d{1,4}$/.test(t)) {
    const n = Number(t)
    if (n >= 1 && n <= PROJECT_HELPER_LIMITS.maxTurns) out.max_turns = n
  }
  return out
}

/** Motivo para omitir una plantilla de comando, o null si es solo texto. */
export function commandRisk(template: string): string | null {
  if (SHELL_RE.test(template)) return 'ejecuta un comando (!`…`)'
  if (FILE_RE.test(template)) return 'adjunta archivos (@…)'
  return null
}

/**
 * Ayudantes y comandos de `folder` ya saneados. `reservedExtra`: nombres de agentes de la app (`opencode-config/agents`), en minúsculas.
 * Nunca lanza.
 */
export function readProjectHelpers(folder: string, reservedExtra: ReadonlySet<string> = new Set()): ProjectHelpersResult {
  const res: ProjectHelpersResult = { agents: {}, commands: {}, skipped: [] }
  const dot = join(folder, '.opencode')
  const opencodeDot = isRealDir(dot)
  try {
    // Ayudantes: primero `.claude/agents`, después `.opencode/agent(s)` (gana el último, como en el motor).
    const sources: Array<{ name: string; file: string; claude: boolean }> = []
    if (isRealDir(join(folder, '.claude'))) {
      for (const f of listMd(join(folder, '.claude', 'agents'), PROJECT_HELPER_LIMITS.depth)) sources.push({ ...f, claude: true })
    }
    if (opencodeDot) {
      for (const sub of ['agent', 'agents']) for (const f of listMd(join(dot, sub), PROJECT_HELPER_LIMITS.depth)) sources.push({ ...f, claude: false })
    }
    for (const s of sources) {
      const parsed = parse(s.file)
      if (!parsed) continue
      // Claude Code: el nombre puede venir en el encabezado.
      const declared = s.claude ? scalar(parsed.fields.get('name') ?? ['']) : null
      const name = declared && SEGMENT_RE.test(declared) ? declared : s.name
      if (isReserved(name, reservedExtra)) {
        res.skipped.push({ kind: 'agent', name, reason: 'nombre reservado' })
        continue
      }
      const agent = toAgent(parsed)
      if (!agent) continue
      if (!(name in res.agents) && Object.keys(res.agents).length >= PROJECT_HELPER_LIMITS.helpers) {
        res.skipped.push({ kind: 'agent', name, reason: 'demasiados ayudantes' })
        continue
      }
      delete res.agents[name]
      res.agents[name] = agent
    }
    if (opencodeDot) {
      for (const sub of ['command', 'commands']) {
        for (const f of listMd(join(dot, sub), PROJECT_HELPER_LIMITS.depth)) {
          if (Object.keys(res.commands).length >= PROJECT_HELPER_LIMITS.commands) {
            res.skipped.push({ kind: 'command', name: f.name, reason: 'demasiados comandos' })
            continue
          }
          const parsed = parse(f.file)
          if (!parsed || !parsed.body) continue
          const template = plainText(parsed.body, PROJECT_HELPER_LIMITS.fileBytes)
          const risk = commandRisk(template)
          if (risk) {
            res.skipped.push({ kind: 'command', name: f.name, reason: risk })
            continue
          }
          const cmd: ProjectCommand = { template }
          const desc = parsed.fields.get('description')
          const d = desc ? scalar(desc) : null
          if (d) cmd.description = oneLine(d, PROJECT_HELPER_LIMITS.description)
          const st = parsed.fields.get('subtask')
          const sv = st ? scalar(st) : null
          if (sv === 'true' || sv === 'false') cmd.subtask = sv === 'true'
          const ag = parsed.fields.get('agent')
          const av = ag ? scalar(ag) : null
          if (av && av in res.agents) cmd.agent = av
          res.commands[f.name] = cmd
        }
      }
    }
  } catch {
    // Nunca rompe el arranque: lo leído hasta aquí vale (cada pieza ya está saneada).
  }
  return res
}
