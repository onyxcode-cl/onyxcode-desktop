/**
 * Configuración de OpenCode propia de la app (agentes `chat`, `cowork` y `computer`).
 *
 * Mecanismo verificado con opencode v1.18.32: la variable de entorno `OPENCODE_CONFIG_DIR`
 * apunta a un directorio con la misma estructura que `~/.config/opencode`
 * (`agents/*.md`, `plugins/*.js`, `opencode.json`…). Se SUMA a la config global del usuario
 * (no la reemplaza) y la config inline `OPENCODE_CONFIG_CONTENT` tiene prioridad sobre ella.
 *
 * Los agentes viven en `resources/opencode/agents/` y las skills de oficina (docx, xlsx, pdf, pptx)
 * en `resources/opencode/skills/<nombre>/SKILL.md` (dentro del bundle, SOLO lectura). OpenCode
 * ESCRIBE en su `OPENCODE_CONFIG_DIR` (instala `@opencode-ai/plugin` en `node_modules`, crea
 * `package.json`/`bun.lock`), así que nunca se apunta al bundle (rompería la firma o fallaría en
 * /Applications — AUDIT.md P1): al arrancar se copian a `userData/opencode-config/` y se apunta ahí.
 *
 * Además se genera `plugins/onyxcode-env.js`: un plugin `shell.env` que oculta a bash/pty las
 * variables sensibles del proceso `opencode serve` (contraseña del propio servidor, credenciales
 * de proveedores de los sandboxes, config inline con el token del MCP de computer use, y la URL+
 * token del canal lateral que usa `onyxcode-plan-gate.js`). OpenCode pasa `{...process.env,
 * ...shell.env}` a cada comando bash (AUDIT.md S3).
 *
 * Y `plugins/onyxcode-session.js` (Lote D, B.7): en TODO servidor (también el sidecar de Code), en
 * `tool.execute.before`, si `input.tool` empieza por `browser_` inyecta `output.args.onyxcode_session =
 * input.sessionID` MUTANDO el objeto en sitio, igual que `onyxcode-plan-gate` hace con `computer_*`
 * (mismo bundle de opencode 1.18.32, mismo motivo: el MCP del navegador integrado no conoce la
 * sesión que lo llama, así que hay que decírselo por fuera del propio modelo, que nunca puede fijar
 * ese argumento por su cuenta —siempre se sobrescribe—). Sin esto, `owner.ts` (`src/main/embedded-
 * browser/`) no podría identificar de qué tarea viene la llamada y fallaría cerrado.
 *
 * Y `plugins/onyxcode-plan-gate.js`: flujo Plan → Aprobar → Ejecutar, aplicado del lado del SERVIDOR
 * de OpenCode (no solo por prompt ni por el MCP): en el servidor de acceso total, ninguna
 * herramienta corre en NINGUNA sesión (agente `computer`, hijas de `task`, otros agentes) hasta que
 * el usuario apruebe el plan de esa sesión — salvo las de solo planificar (`computer_request_access`,
 * `todowrite`, `todoread`, `question`, `read`, `glob`, `grep`, `list`). Antes, el MCP de computer use ya bloqueaba sus propias herramientas
 * (`computer_*`) del lado del servidor (`computer/mcp-server.ts`), pero `bash`, `edit`, `write`,
 * `webfetch`/`websearch` y `task` son herramientas NATIVAS de OpenCode: el agente podía usarlas
 * (p. ej. `ls /Applications`, `open -a Discord`) antes de que el usuario viera la tarjeta del plan.
 * Este plugin cierra ese hueco con `tool.execute.before`, consultando el mismo `/plan-status` que
 * el MCP (`ONYXCODE_PLAN_GATE_URL`, oculto a bash por `onyxcode-env.js`), con el mismo fail-closed: si no
 * se puede verificar, se deniega. Solo se activa cuando la variable está presente (servidores de
 * acceso total); en el sandbox y en el sidecar principal no hace nada.
 *
 * La aprobación es POR SESIÓN (tarea): la consulta lleva `?session=<sessionID>` y dura toda la
 * tarea (varios turnos y seguimientos) hasta "Revocar", Detener o archivar/borrar la tarea. Además,
 * el hook INYECTA `onyxcode_session` (= `input.sessionID`) en los args de las herramientas `computer_*`
 * para que el MCP —que no conoce la sesión— consulte la aprobación de la tarea correcta. Verificado
 * en el bundle de opencode 1.18.32: `tool.execute.before` recibe `(input, output)` y el MCP se llama
 * con el MISMO objeto `output.args`, así que hay que MUTARLO (no reasignarlo). Reverificar al subir
 * de versión de opencode; si la inyección fallara, main cae al modo global (con aviso en el log).
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CHAT_AGENT_ID = 'chat'
export const COWORK_AGENT_ID = 'cowork'
/** Agente del flujo Plan → Aprobar → Ejecutar (`resources/opencode/agents/computer.md`). */
export const COMPUTER_AGENT_ID = 'computer'

/** Herramientas de solo-planificación: las únicas que `onyxcode-plan-gate` deja pasar sin plan aprobado. */
export const PLAN_GATE_ALLOWED_TOOLS = [
  'computer_request_access',
  'todowrite',
  'todoread',
  'question',
  'read',
  'glob',
  'grep',
  'list'
] as const

/** Variables del entorno de `opencode serve` que bash/pty NO deben ver. */
export const HIDDEN_SHELL_ENV = [
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_AUTH_CONTENT',
  'OPENCODE_CONFIG_CONTENT',
  'ONYXCODE_PLAN_GATE_URL'
] as const

const ENV_PLUGIN_FILE = 'onyxcode-env.js'
const PLAN_GATE_PLUGIN_FILE = 'onyxcode-plan-gate.js'
const SESSION_PLUGIN_FILE = 'onyxcode-session.js'
const STAMP_FILE = '.onyxcode-version'

export function envScrubPluginSource(): string {
  // Formato de plugin de ruta de opencode 1.18: `export default { id, server() }` (verificado).
  return `// Generado por la app: no editar (se regenera al arrancar).
// Oculta a bash/pty las variables sensibles del proceso \`opencode serve\`.
const HIDDEN = ${JSON.stringify(HIDDEN_SHELL_ENV)}
export default {
  id: 'onyxcode-env',
  server: async () => ({
    'shell.env': async (_input, output) => {
      output.env = output.env || {}
      for (const k of HIDDEN) output.env[k] = ''
    }
  })
}
`
}

/**
 * Plugin `tool.execute.before`: bloquea, del lado del servidor, toda herramienta que no sea de
 * solo-planificación hasta que `GET <ONYXCODE_PLAN_GATE_URL>/plan-status?session=<id>` confirme
 * `{ approved: true }`. Se aplica a TODA sesión del servidor con la variable (también las sesiones
 * hijas de `task` y cualquier agente que no sea `computer`), con clave en su propio `sessionID`:
 * una sesión sin plan aprobado queda bloqueada (fail-closed). Sin la variable de entorno (sandbox /
 * sidecar principal), es un no-op. Ya no se distingue el agente: el atajo anterior
 * (`agentBySession.get(...) !== 'computer' → return`) dejaba sin puerta a las hijas.
 */
export function planGatePluginSource(): string {
  return `// Generado por la app: no editar (se regenera al arrancar).
// Flujo Plan -> Aprobar -> Ejecutar (servidor de acceso total): bloquea del lado del servidor toda
// herramienta que no sea de solo-planificacion, en CUALQUIER sesion del servidor, hasta que se
// apruebe el plan de esa sesion. Ver src/main/cowork/opencode-config.ts para el contexto completo.
const GATE_URL = process.env.ONYXCODE_PLAN_GATE_URL || ''
const ALLOWED = new Set(${JSON.stringify(PLAN_GATE_ALLOWED_TOOLS)})
const CACHE_MS = 250
const DENY_MSG =
  'Todavia no hay un plan aprobado para esta tarea (flujo Plan -> Aprobar -> Ejecutar). Antes de tocar la ' +
  'pantalla, editar o crear archivos, usar la terminal o consultar la web: llama a computer_request_access ' +
  'con tu plan completo (basado en lo que ya sabes, sin explorar el sistema primero) y la lista completa de ' +
  'apps con su nivel en "levels" (si la tarea no controla ninguna app, envia el plan con "apps": []), y ' +
  'espera a que el usuario apruebe con "Aprobar y empezar".'

export default {
  id: 'onyxcode-plan-gate',
  server: async () => {
    if (!GATE_URL) return {}
    const cache = new Map()
    const isApproved = async (sessionID) => {
      const key = sessionID || ''
      const now = Date.now()
      const hit = cache.get(key)
      if (hit && now - hit.at < CACHE_MS) return hit.ok
      let ok = false
      try {
        const q = sessionID ? '?session=' + encodeURIComponent(sessionID) : ''
        const r = await fetch(GATE_URL + '/plan-status' + q, { signal: AbortSignal.timeout(1500) })
        if (r.ok) {
          const j = await r.json()
          ok = j && j.approved === true
        }
      } catch {
        ok = false // fail-closed: si no se puede verificar el estado, se deniega
      }
      cache.set(key, { at: now, ok })
      return ok
    }
    return {
      'tool.execute.before': async (input, output) => {
        // 1) Inyectar la sesion en los args de las herramientas del MCP de computer use. Se MUTA el
        // objeto en sitio (opencode llama al MCP con ese mismo objeto) y SIEMPRE sobrescribe lo que
        // ponga el modelo. Va antes de cualquier return para que se aplique a todo agente.
        if (typeof input.tool === 'string' && input.tool.startsWith('computer_') && output && output.args && typeof output.args === 'object') {
          output.args.onyxcode_session = input.sessionID
        }
        // 2) Control del plan, por sesion. Se aplica a TODA sesion del servidor (tambien las hijas
        // creadas con la herramienta task y cualquier otro agente), con clave en su propio
        // sessionID: una sesion sin plan aprobado queda bloqueada (fail-closed).
        if (ALLOWED.has(input.tool)) return
        if (await isApproved(input.sessionID)) return
        throw new Error(DENY_MSG)
      }
    }
  }
}
`
}

/**
 * Plugin `tool.execute.before` (Lote D, B.7): en TODO servidor (sidecar de Code y cada servidor de
 * Cowork, sandbox o Control total), inyecta `onyxcode_session` en los args de cualquier herramienta
 * `browser_*` con el `sessionID` de quien llama, MUTANDO el objeto en sitio (opencode llama al MCP
 * con ese mismo objeto `output.args`) y SIEMPRE sobrescribiendo lo que ponga el modelo — igual que
 * `onyxcode-plan-gate` hace con `computer_*`. Sin variable de entorno que lo condicione: a diferencia
 * del plan-gate (solo acceso total), el navegador integrado existe en todos los servidores.
 */
export function sessionPluginSource(): string {
  return `// Generado por la app: no editar (se regenera al arrancar).
// Inyecta onyxcode_session en las herramientas browser_* del MCP del navegador integrado (Lote D).
// Ver src/main/cowork/opencode-config.ts para el contexto completo.
export default {
  id: 'onyxcode-session',
  server: async () => ({
    'tool.execute.before': async (input, output) => {
      if (typeof input.tool === 'string' && input.tool.startsWith('browser_') && output && output.args && typeof output.args === 'object') {
        output.args.onyxcode_session = input.sessionID
      }
    }
  })
}
`
}

/** `resources/opencode` del bundle (dev y empaquetado, fuera del asar). Solo lectura. */
export function getBundledOpencodeDir(): string {
  const candidates = [
    join(app.getAppPath(), 'resources', 'opencode').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'),
    join(process.resourcesPath ?? '', 'opencode'),
    join(process.cwd(), 'resources', 'opencode')
  ]
  return candidates.find((p) => existsSync(join(p, 'agents'))) ?? candidates[0]
}

let prepared: string | null = null

/** Copia `src` a `dest` recursivamente y borra de `dest` lo que ya no exista en `src`. */
function syncDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  const names = new Set(entries.map((e) => e.name))
  // Quitar sobrantes (archivos o carpetas que ya no existen en el bundle).
  for (const old of readdirSync(dest)) {
    if (!names.has(old)) rmSync(join(dest, old), { recursive: true, force: true })
  }
  for (const e of entries) {
    const from = join(src, e.name)
    const to = join(dest, e.name)
    if (e.isDirectory()) syncDirRecursive(from, to)
    else if (e.isFile()) copyFileSync(from, to)
  }
}

/**
 * Copia los agentes y las skills del bundle a `userData/opencode-config/{agents,skills}` (sobrescribe
 * si cambió la versión de la app o en desarrollo) y regenera los plugins. Idempotente.
 */
export function prepareOpencodeConfigDir(): string {
  if (prepared) return prepared
  const dest = join(app.getPath('userData'), 'opencode-config')
  const agentsDest = join(dest, 'agents')
  const skillsDest = join(dest, 'skills')
  const pluginsDest = join(dest, 'plugins')
  mkdirSync(agentsDest, { recursive: true })
  mkdirSync(skillsDest, { recursive: true })
  mkdirSync(pluginsDest, { recursive: true })
  const stampPath = join(dest, STAMP_FILE)
  const version = app.getVersion()
  let stamp = ''
  try {
    stamp = readFileSync(stampPath, 'utf8').trim()
  } catch {
    // primera vez
  }
  const bundled = getBundledOpencodeDir()
  const src = join(bundled, 'agents')
  const skillsSrc = join(bundled, 'skills')
  const refresh = !app.isPackaged || stamp !== version || readdirSync(agentsDest).length === 0
  if (refresh) {
    try {
      const names = readdirSync(src).filter((n) => n.endsWith('.md'))
      // Quitar agentes que ya no existen en el bundle.
      for (const old of readdirSync(agentsDest)) {
        if (old.endsWith('.md') && !names.includes(old)) rmSync(join(agentsDest, old), { force: true })
      }
      for (const n of names) copyFileSync(join(src, n), join(agentsDest, n))
      writeFileSync(stampPath, version, 'utf8')
    } catch (err) {
      console.error('[opencode-config] no se pudieron copiar los agentes:', err)
    }
  }
  // Skills: mismo criterio de refresco que los agentes (y también si faltan en el destino, p.ej.
  // al actualizar desde una versión sin skills con el mismo sello).
  if (existsSync(skillsSrc) && (refresh || readdirSync(skillsDest).length === 0)) {
    try {
      syncDirRecursive(skillsSrc, skillsDest)
    } catch (err) {
      console.error('[opencode-config] no se pudieron copiar las skills:', err)
    }
  }
  writeFileSync(join(pluginsDest, ENV_PLUGIN_FILE), envScrubPluginSource(), 'utf8')
  writeFileSync(join(pluginsDest, PLAN_GATE_PLUGIN_FILE), planGatePluginSource(), 'utf8')
  writeFileSync(join(pluginsDest, SESSION_PLUGIN_FILE), sessionPluginSource(), 'utf8')
  // OpenCode escribe este .gitignore si falta, y en un servidor sandboxeado (sin escritura aquí)
  // ese EPERM es FATAL (`Config.ensureGitignore`): crearlo siempre desde main.
  const gitignore = join(dest, '.gitignore')
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, ['node_modules', 'package.json', 'package-lock.json', 'bun.lock', '.gitignore'].join('\n'), 'utf8')
  }
  prepared = dest
  return dest
}

/**
 * Bloque de config inline para las skills empaquetadas. Verificado con opencode 1.18.32 en un
 * servidor sandbox real: `GET /skill` YA lista las skills de `OPENCODE_CONFIG_DIR/skills`, así que
 * no hace falta `skills.paths` y esto devuelve `{}` (se mantiene el gancho por si una versión
 * futura dejara de escanear ese directorio: entonces devolver
 * `{ skills: { paths: [join(getOpencodeConfigDir(), 'skills')] } }`). `skills.paths` tampoco
 * resuelve las colisiones de nombre con `~/.claude/skills` (ver informe de W2-F).
 */
export function skillsInlineConfig(): Record<string, unknown> {
  return {}
}

/** Directorio de config de OpenCode de la app (`userData/opencode-config`). */
export function getOpencodeConfigDir(): string {
  return prepareOpencodeConfigDir()
}

/**
 * Variables de entorno para cualquier `opencode serve` de la app (sidecar principal y
 * servidores de Cowork). Fusionar con `process.env` al hacer spawn.
 */
export function getOpencodeEnv(): Record<string, string> {
  return {
    OPENCODE_CONFIG_DIR: getOpencodeConfigDir(),
    // La app fija la versión del SDK: el binario no debe actualizarse solo.
    OPENCODE_DISABLE_AUTOUPDATE: '1'
  }
}
