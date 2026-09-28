/**
 * Configuración de OpenCode propia de la app (agentes `chat`, `cowork` y `computer`).
 *
 * Mecanismo verificado con opencode v1.18.32: la variable de entorno `OPENCODE_CONFIG_DIR`
 * apunta a un directorio con la misma estructura que `~/.config/opencode`
 * (`agents/*.md`, `plugins/*.js`, `opencode.json`…). Se SUMA a la config global del usuario
 * (no la reemplaza) y la config inline `OPENCODE_CONFIG_CONTENT` tiene prioridad sobre ella.
 *
 * Los agentes viven en `resources/opencode/agents/` (dentro del bundle, SOLO lectura). OpenCode
 * ESCRIBE en su `OPENCODE_CONFIG_DIR` (instala `@opencode-ai/plugin` en `node_modules`, crea
 * `package.json`/`bun.lock`), así que nunca se apunta al bundle (rompería la firma o fallaría en
 * /Applications — AUDIT.md P1): al arrancar se copian a `userData/opencode-config/` y se apunta ahí.
 *
 * Además se genera `plugins/lapis-env.js`: un plugin `shell.env` que oculta a bash/pty las
 * variables sensibles del proceso `opencode serve` (contraseña del propio servidor, credenciales
 * de proveedores de los sandboxes, config inline con el token del MCP de computer use, y la URL+
 * token del canal lateral que usa `lapis-plan-gate.js`). OpenCode pasa `{...process.env,
 * ...shell.env}` a cada comando bash (AUDIT.md S3).
 *
 * Y `plugins/lapis-plan-gate.js`: flujo Plan → Aprobar → Ejecutar, aplicado del lado del SERVIDOR
 * de OpenCode (no solo por prompt ni por el MCP): en el servidor de acceso total, ninguna
 * herramienta corre para el agente `computer` hasta que el usuario apruebe el plan — salvo las de
 * solo planificar (`computer_request_access`, `todowrite`, `todoread`, `question`, `read`, `glob`,
 * `grep`, `list`). Antes, el MCP de computer use ya bloqueaba sus propias herramientas
 * (`computer_*`) del lado del servidor (`computer/mcp-server.ts`), pero `bash`, `edit`, `write`,
 * `webfetch`/`websearch` y `task` son herramientas NATIVAS de OpenCode: el agente podía usarlas
 * (p. ej. `ls /Applications`, `open -a Discord`) antes de que el usuario viera la tarjeta del plan.
 * Este plugin cierra ese hueco con `tool.execute.before`, consultando el mismo `/plan-status` que
 * el MCP (`LAPIS_PLAN_GATE_URL`, oculto a bash por `lapis-env.js`), con el mismo fail-closed: si no
 * se puede verificar, se deniega. Solo se activa cuando la variable está presente (servidores de
 * acceso total); en el sandbox y en el sidecar principal no hace nada.
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CHAT_AGENT_ID = 'chat'
export const COWORK_AGENT_ID = 'cowork'
/** Agente del flujo Plan → Aprobar → Ejecutar (`resources/opencode/agents/computer.md`). */
export const COMPUTER_AGENT_ID = 'computer'

/** Herramientas de solo-planificación: las únicas que `lapis-plan-gate` deja pasar sin plan aprobado. */
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
  'LAPIS_PLAN_GATE_URL'
] as const

const ENV_PLUGIN_FILE = 'lapis-env.js'
const PLAN_GATE_PLUGIN_FILE = 'lapis-plan-gate.js'
const STAMP_FILE = '.lapis-version'

export function envScrubPluginSource(): string {
  // Formato de plugin de ruta de opencode 1.18: `export default { id, server() }` (verificado).
  return `// Generado por la app: no editar (se regenera al arrancar).
// Oculta a bash/pty las variables sensibles del proceso \`opencode serve\`.
const HIDDEN = ${JSON.stringify(HIDDEN_SHELL_ENV)}
export default {
  id: 'lapis-env',
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
 * solo-planificación para el agente `computer` hasta que `GET <LAPIS_PLAN_GATE_URL>/plan-status`
 * confirme `{ approved: true }`. Sin la variable de entorno (sandbox / sidecar principal), es un
 * no-op. `chat.params` recuerda el agente de cada sesión (el hook de herramientas no lo trae).
 */
export function planGatePluginSource(): string {
  return `// Generado por la app: no editar (se regenera al arrancar).
// Flujo Plan -> Aprobar -> Ejecutar (servidor de acceso total): bloquea del lado del servidor toda
// herramienta que no sea de solo-planificacion para el agente "computer" hasta que se apruebe el
// plan. Ver src/main/cowork/opencode-config.ts para el contexto completo.
const GATE_URL = process.env.LAPIS_PLAN_GATE_URL || ''
const COMPUTER_AGENT = ${JSON.stringify(COMPUTER_AGENT_ID)}
const ALLOWED = new Set(${JSON.stringify(PLAN_GATE_ALLOWED_TOOLS)})
const CACHE_MS = 250
const DENY_MSG =
  'Todavia no hay un plan aprobado para esta tarea (flujo Plan -> Aprobar -> Ejecutar). Antes de tocar la ' +
  'pantalla, editar o crear archivos, usar la terminal o consultar la web: llama a computer_request_access ' +
  'con tu plan completo (basado en lo que ya sabes, sin explorar el sistema primero) y la lista completa de ' +
  'apps, y espera a que el usuario apruebe con "Aprobar y empezar".'

export default {
  id: 'lapis-plan-gate',
  server: async () => {
    if (!GATE_URL) return {}
    const agentBySession = new Map()
    let cache = null
    const isApproved = async () => {
      const now = Date.now()
      if (cache && now - cache.at < CACHE_MS) return cache.ok
      let ok = false
      try {
        const r = await fetch(GATE_URL + '/plan-status', { signal: AbortSignal.timeout(1500) })
        if (r.ok) {
          const j = await r.json()
          ok = j && j.approved === true
        }
      } catch {
        ok = false // fail-closed: si no se puede verificar el estado, se deniega
      }
      cache = { at: now, ok }
      return ok
    }
    return {
      'chat.params': async (input) => {
        agentBySession.set(input.sessionID, input.agent)
      },
      'tool.execute.before': async (input) => {
        if (agentBySession.get(input.sessionID) !== COMPUTER_AGENT) return
        if (ALLOWED.has(input.tool)) return
        if (await isApproved()) return
        throw new Error(DENY_MSG)
      }
    }
  }
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

/**
 * Copia los agentes del bundle a `userData/opencode-config/agents` (sobrescribe si cambió la
 * versión de la app o en desarrollo) y regenera el plugin de entorno. Idempotente.
 */
export function prepareOpencodeConfigDir(): string {
  if (prepared) return prepared
  const dest = join(app.getPath('userData'), 'opencode-config')
  const agentsDest = join(dest, 'agents')
  const pluginsDest = join(dest, 'plugins')
  mkdirSync(agentsDest, { recursive: true })
  mkdirSync(pluginsDest, { recursive: true })
  const stampPath = join(dest, STAMP_FILE)
  const version = app.getVersion()
  let stamp = ''
  try {
    stamp = readFileSync(stampPath, 'utf8').trim()
  } catch {
    // primera vez
  }
  const src = join(getBundledOpencodeDir(), 'agents')
  if (!app.isPackaged || stamp !== version || readdirSync(agentsDest).length === 0) {
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
  writeFileSync(join(pluginsDest, ENV_PLUGIN_FILE), envScrubPluginSource(), 'utf8')
  writeFileSync(join(pluginsDest, PLAN_GATE_PLUGIN_FILE), planGatePluginSource(), 'utf8')
  // OpenCode escribe este .gitignore si falta, y en un servidor sandboxeado (sin escritura aquí)
  // ese EPERM es FATAL (`Config.ensureGitignore`): crearlo siempre desde main.
  const gitignore = join(dest, '.gitignore')
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, ['node_modules', 'package.json', 'package-lock.json', 'bun.lock', '.gitignore'].join('\n'), 'utf8')
  }
  prepared = dest
  return dest
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
