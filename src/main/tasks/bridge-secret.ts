/**
 * Secreto del «puente de apps» del modo unificado (1.8, ola 1): un valor aleatorio por ejecución de la app, solo en memoria del proceso
 * main. El proxy MCP lo pone en la cabecera `BRIDGE_ORIGIN_HEADER` de las peticiones del servidor aislado al MCP de control; el servidor
 * de control lo compara con `isBridgeSecret` para saber que la petición pasó por el proxy (y no la hizo el agente directamente).
 * Nunca se escribe en disco, en el entorno del motor ni en la configuración que recibe el agente.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

let secret: string | null = null

/** El secreto de esta ejecución (se crea la primera vez que se pide). Solo para main. */
export function getBridgeSecret(): string {
  secret ??= randomBytes(32).toString('base64url')
  return secret
}

/** ¿El valor recibido en la cabecera del puente es el secreto? Comparación en tiempo constante; ausente o de otro largo = no. */
export function isBridgeSecret(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false
  const a = Buffer.from(value)
  const b = Buffer.from(getBridgeSecret())
  return a.length === b.length && timingSafeEqual(a, b)
}
