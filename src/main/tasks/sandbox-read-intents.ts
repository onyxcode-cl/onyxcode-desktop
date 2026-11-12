/** Atribución conservadora: una sonda del motor no es una lectura pedida por el modelo. */
import { posix } from 'node:path'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

export interface ReadIntent {
  id: string
  input: unknown
  start: number
  end: number
}
const READ_TOOLS = new Set(['read', 'bash', 'glob', 'grep', 'list', 'execute'])

/** Solo partes de herramientas efectivamente ejecutadas; nunca mensajes, permisos ni planes. */
export function readIntent(raw: unknown, now = Date.now()): ReadIntent | null {
  const event = (
    raw as {
      payload?: {
        type?: unknown
        properties?: {
          part?: {
            id?: unknown
            type?: unknown
            tool?: unknown
            state?: { status?: unknown; input?: unknown; time?: { start?: unknown; end?: unknown } }
          }
        }
      }
    } | null
  )?.payload
  const part = event?.properties?.part
  if (event?.type !== 'message.part.updated' || part?.type !== 'tool') return null
  if (typeof part.tool !== 'string' || !READ_TOOLS.has(part.tool)) return null
  const state = part.state
  if (!state || !['running', 'completed', 'error'].some((s) => s === state.status) || !state.input || typeof state.input !== 'object')
    return null
  const start = state.time?.start
  if (typeof start !== 'number' || !Number.isFinite(start) || start > now) return null
  if (typeof part.id !== 'string' || JSON.stringify(state.input).length > 32_768) return null
  const end = typeof state.time?.end === 'number' && Number.isFinite(state.time.end) ? Math.min(now, state.time.end) : now
  return { id: part.id, input: state.input, start, end: state.status === 'running' ? now + 30_000 : end }
}

/** Exige un destino explícito en los argumentos, no solo coincidencia temporal con cualquier comando. */
export function requestsRead(intent: ReadIntent, path: string, folder: string, at: number): boolean {
  if (!path.startsWith('/') || at < intent.start || at > intent.end + 1000) return false
  const normalized = (value: string): string => posix.normalize(value.replace(/^\/private\/(var|tmp)(\/|$)/, '/$1$2'))
  const target = normalized(path)
  const matches = (value: unknown, depth: number): boolean => {
    if (depth > 5) return false
    if (typeof value === 'string') {
      // Rutas absolutas o relativas en argumentos de read/glob/grep y en órdenes de shell/Python.
      // No se adivinan rutas creadas por scripts ni se atribuyen sus lecturas implícitas de configuración.
      const tokens = [value.trim(), ...Array.from(value.matchAll(/(["'])(.*?)\1/g), (m) => m[2]), ...value.split(/[\s"'`;,|&()<>\[\]{}=]+/)]
      return tokens.some((token) => {
        if (!token.startsWith('/') && !token.startsWith('./') && !token.startsWith('../') && token.includes(':')) return false
        if (!token) return false
        const candidate = normalized(posix.resolve(folder, token))
        return candidate === target || (target !== '/' && candidate.startsWith(target + '/'))
      })
    }
    if (Array.isArray(value)) return value.some((v) => matches(v, depth + 1))
    return !!value && typeof value === 'object' && Object.values(value).some((v) => matches(v, depth + 1))
  }
  return matches(intent.input, 0)
}

export type ReadIntentSource = (receive: (intent: ReadIntent) => void, signal: AbortSignal) => Promise<void>

/** Un flujo por servidor aislado, solo mientras sus avisos están encendidos; sin persistir argumentos ni credenciales. */
export function sandboxReadIntentSource(port: number, env: Record<string, string>): ReadIntentSource {
  return async (receive, signal) => {
    const client = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${port}`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.OPENCODE_SERVER_USERNAME}:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`
      }
    })
    while (!signal.aborted) {
      try {
        const { stream } = await client.global.event({ signal, sseMaxRetryAttempts: 0 })
        for await (const raw of stream) {
          if (signal.aborted) return
          const intent = readIntent(raw)
          if (intent) receive(intent)
        }
      } catch {
        // El servidor puede seguir arrancando. Sin evidencia de herramienta no se emiten avisos de lectura.
      }
      if (signal.aborted) return
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, 500)
        signal.addEventListener('abort', finish, { once: true })
      })
    }
  }
}
