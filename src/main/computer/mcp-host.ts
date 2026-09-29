/**
 * Anfitrión del MCP de control del Mac: lo ejecuta como `utilityProcess` del proceso principal y lo
 * expone a OpenCode como MCP `remote` (Streamable HTTP en 127.0.0.1 con token Bearer).
 *
 * Por qué así (AUDIT.md S6 + fuses):
 * - Los `opencode serve` se lanzan desvinculados de TCC (`process/disclaim.ts`); un MCP local lanzado
 *   por OpenCode tampoco tendría Accesibilidad/Grabación de pantalla. Un utilityProcess es hijo de
 *   OnyxCode y conserva su responsabilidad TCC, igual que el `cu-helper` y `screencapture` que lanza.
 * - Sin `ELECTRON_RUN_AS_NODE`: el fuse RunAsNode puede ir desactivado en el paquete.
 *
 * Puerto y token son FIJOS durante la vida de la app: si el proceso muere se relanza en el mismo
 * puerto (con enfriamiento), así la config ya entregada a OpenCode sigue siendo válida.
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import { getFreePort } from '../util/net'
import { minimalEnv } from '../process/child-env'

const READY_TIMEOUT_MS = 10_000
/** Reinicios permitidos en la ventana antes de rendirse (hasta el siguiente `ensure`). */
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000

export interface McpEndpoint {
  url: string
  token: string
}

export class ComputerMcpHost {
  private proc: UtilityProcess | null = null
  private port = 0
  private readonly token = randomBytes(32).toString('base64url')
  private starting: Promise<McpEndpoint> | null = null
  private restarts: number[] = []
  private disposed = false

  constructor(
    private readonly scriptPath: () => string | null,
    private readonly env: () => Promise<Record<string, string>>
  ) {}

  /** Arranca (si hace falta) y devuelve el endpoint. */
  ensure(): Promise<McpEndpoint> {
    if (this.proc && this.port) return Promise.resolve(this.endpoint())
    this.starting ??= this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private endpoint(): McpEndpoint {
    return { url: `http://127.0.0.1:${this.port}/mcp`, token: this.token }
  }

  private async launch(): Promise<McpEndpoint> {
    const script = this.scriptPath()
    if (!script) throw new Error('Falta computer-mcp.js (ejecuta `npm run build`).')
    if (!this.port) this.port = await getFreePort()
    const env = minimalEnv({
      ...(await this.env()),
      COMPUTER_MCP_TOKEN: this.token,
      COMPUTER_MCP_PORT: String(this.port)
    })
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'OnyxCode MCP de control del Mac',
      env,
      stdio: 'pipe'
    })
    this.proc = proc
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[computer-mcp] ${d.toString()}`))
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d.toString()))

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El MCP de control del Mac no arrancó a tiempo')), READY_TIMEOUT_MS)
      proc.on('message', (msg: { type?: string; port?: number; message?: string }) => {
        if (msg?.type === 'ready') {
          clearTimeout(timer)
          resolve()
        } else if (msg?.type === 'error') {
          clearTimeout(timer)
          reject(new Error(msg.message ?? 'error del MCP'))
        }
      })
      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`El MCP de control del Mac terminó al arrancar (code=${code})`))
      })
    })
    proc.once('exit', (code) => this.onExit(proc, code))
    try {
      await ready
    } catch (err) {
      if (this.proc === proc) this.proc = null
      proc.kill()
      throw err
    }
    console.log(`[computer] MCP (utilityProcess pid=${proc.pid}) en 127.0.0.1:${this.port}`)
    return this.endpoint()
  }

  private onExit(proc: UtilityProcess, code: number): void {
    if (this.proc !== proc) return
    this.proc = null
    if (this.disposed) return
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    if (this.restarts.length >= MAX_RESTARTS) {
      console.error(`[computer] el MCP terminó (code=${code}) ${MAX_RESTARTS} veces en 1 min; no se relanza`)
      return
    }
    this.restarts.push(now)
    const delay = 500 * 2 ** (this.restarts.length - 1)
    console.warn(`[computer] el MCP terminó (code=${code}); relanzando en ${delay} ms`)
    setTimeout(() => {
      if (this.disposed || this.proc) return
      this.ensure().catch((err: unknown) => console.error('[computer] relanzar MCP:', err))
    }, delay).unref()
  }

  dispose(): void {
    this.disposed = true
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      proc.postMessage({ type: 'shutdown' })
    } catch {
      // ya cerrado
    }
    setTimeout(() => proc.kill(), 500).unref()
  }
}
