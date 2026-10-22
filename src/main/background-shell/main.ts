/**
 * Punto de entrada del servidor MCP `shell_bg` por stdio (docs/DISENO-SEGUNDO-PLANO.md §3.2).
 *
 * DÓNDE VIVE Y CÓMO SE EJECUTA (decisión, tras revisar cómo la app ya lanza helpers y conectores locales):
 *  - La app NO usa el SDK de MCP: los conectores locales son procesos externos (`npx`/`uvx` del catálogo, ahora con el Node y uv
 *    propios de `userData/runtimes` por ruta absoluta, F8-B195) y OpenCode habla con ellos por stdio; `src/main/tasks/mcp-tasks.ts`
 *    solo escribe su bloque `mcp` (`type: 'local'`, `command: [...]`). No hay ningún servidor MCP propio empaquetado todavía.
 *  - El MCP se ejecutaría dentro del sandbox Seatbelt de Tareas (o como hijo del sidecar en Chat/Code): ahí NO hay Electron ni
 *    `node_modules` accesibles, y `userData` se deniega de lectura salvo lo que el perfil abra. Por eso el código es TypeScript
 *    sin imports de Electron ni de paquetes (solo `node:*`), se compila en pruebas con vitest y se EMPAQUETA con esbuild
 *    (`scripts/build-shell-bg.mjs`) a UN `.cjs` autocontenido que ejecuta el Node incluido: `<node> shell-bg-mcp.cjs`.
 *  - Ese `.cjs` debe viajar fuera del .asar (Node no lee un script de dentro de un asar): `resources/shell-bg/**` en `asarUnpack`
 *    o `extraResources`, y el sandbox necesita lectura de esa ruta y del binario de Node (ver la lista de integración del informe).
 *  - Dentro del sandbox `process-info` sobre OTROS procesos está denegado (sandbox-profile.ts); `ps` por sysctl suele seguir
 *    funcionando, pero si no, el muestreo de CPU devuelve `null` y la supervisión queda solo con salida y archivos observados
 *    (falla hacia "avisar de más", nunca hacia matar).
 *
 * Se empaqueta a UN archivo CommonJS autocontenido y lo ejecuta el Node incluido de la app; NO usa Electron.
 *
 * Variables de entorno (las fija quien lo lanza; ninguna es secreta):
 *   LAZUNOX_SHELL_BG_DIR           carpeta base privada de salidas y registro de PIDs (por defecto `<tmp>/lazunox-shell-bg-<uid>`)
 *   LAZUNOX_SHELL_BG_QUIET_MS      silencio antes de `possibly-stuck` (por defecto 15 min)
 *   LAZUNOX_SHELL_BG_MAX_RUNTIME_MS tope absoluto para todos los trabajos (por defecto ninguno)
 *   LAZUNOX_SHELL_BG_MAX_JOBS      concurrencia (por defecto 8)
 *   LAZUNOX_SHELL_BG_EVENTS        archivo opcional donde se añaden los avisos como JSON por línea (para un plugin que despierte al modelo)
 *
 * Cierre: al cerrarse stdin, SIGTERM/SIGINT/SIGHUP o `exit` se terminan todos los grupos de procesos.
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { BackgroundShellManager } from './manager'
import { ShellBgMcpServer, formatEvent } from './mcp-server'

function envInt(name: string): number | undefined {
  const v = process.env[name]
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

async function main(): Promise<void> {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  const baseDir = process.env.LAZUNOX_SHELL_BG_DIR || join(tmpdir(), `lazunox-shell-bg-${uid}`)
  const eventsFile = process.env.LAZUNOX_SHELL_BG_EVENTS
  const sink: { server?: ShellBgMcpServer } = {}
  const manager = new BackgroundShellManager({
    baseDir,
    quietMs: envInt('LAZUNOX_SHELL_BG_QUIET_MS'),
    maxRuntimeMs: envInt('LAZUNOX_SHELL_BG_MAX_RUNTIME_MS') ?? null,
    maxConcurrent: envInt('LAZUNOX_SHELL_BG_MAX_JOBS'),
    onEvent: (e) => {
      sink.server?.notifyEvent(e)
      if (eventsFile) {
        try {
          appendFileSync(eventsFile, JSON.stringify({ ...e, message: formatEvent(e), at: Date.now() }) + '\n', { mode: 0o600 })
        } catch {
          /* el archivo de avisos es opcional */
        }
      }
    }
  })
  const server = new ShellBgMcpServer({
    manager,
    defaultCwd: process.cwd(),
    write: (line) => process.stdout.write(line + '\n')
  })
  sink.server = server

  try {
    await manager.init()
  } catch {
    /* sin limpieza de restos el servidor igualmente funciona */
  }

  let closing = false
  const close = (code: number): void => {
    if (closing) return
    closing = true
    const hard = setTimeout(() => {
      manager.killAllSync()
      process.exit(code)
    }, 8000)
    hard.unref()
    manager.shutdown().finally(() => process.exit(code))
  }
  process.on('SIGTERM', () => close(0))
  process.on('SIGINT', () => close(0))
  process.on('SIGHUP', () => close(0))
  process.on('exit', () => manager.killAllSync())
  process.on('uncaughtException', () => close(1))

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const pending = new Set<Promise<void>>()
  rl.on('line', (line) => {
    const p = server.handleLine(line).catch(() => undefined)
    pending.add(p)
    void p.finally(() => pending.delete(p))
  })
  rl.on('close', () => {
    void Promise.allSettled([...pending]).then(() => close(0))
  })
}

void main()
