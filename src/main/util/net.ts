import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

/** Puerto libre en `host` (por defecto 127.0.0.1). */
export function getFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, host, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('No se pudo obtener un puerto libre')))
      }
    })
  })
}

/**
 * Espera a que `<baseUrl>/global/health` responda. `label` se usa en los mensajes de error
 * (p. ej. "opencode serve"). Devuelve la versión reportada.
 */
export async function waitForHealth(
  baseUrl: string,
  authorization: string,
  child: ChildProcess,
  opts: { label: string; timeoutMs: number; intervalMs?: number }
): Promise<string | undefined> {
  const { label, timeoutMs, intervalMs = 150 } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} terminó durante el arranque (code=${child.exitCode})`)
    }
    try {
      const res = await fetch(`${baseUrl}/global/health`, {
        headers: { authorization },
        signal: AbortSignal.timeout(2000)
      })
      if (res.ok) {
        const body = (await res.json()) as { healthy?: boolean; version?: string }
        if (body.healthy !== false) return body.version
      }
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} no respondió en ${timeoutMs / 1000}s`)
}
