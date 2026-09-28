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
 * de proveedores de los sandboxes, config inline con el token del MCP de computer use). OpenCode
 * pasa `{...process.env, ...shell.env}` a cada comando bash (AUDIT.md S3).
 */
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CHAT_AGENT_ID = 'chat'
export const COWORK_AGENT_ID = 'cowork'

/** Variables del entorno de `opencode serve` que bash/pty NO deben ver. */
export const HIDDEN_SHELL_ENV = [
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_AUTH_CONTENT',
  'OPENCODE_CONFIG_CONTENT'
] as const

const PLUGIN_FILE = 'lapis-env.js'
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
  writeFileSync(join(pluginsDest, PLUGIN_FILE), envScrubPluginSource(), 'utf8')
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
