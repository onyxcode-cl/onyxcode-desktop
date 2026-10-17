/**
 * Cliente mínimo del motor para las comparaciones (SDK v2 del `opencode serve` principal). La interfaz permite
 * un motor falso en las pruebas; `createSdkEngine` la implementa con `@opencode-ai/sdk/v2/client`.
 */
import { createOpencodeClient, type PermissionRuleset } from '@opencode-ai/sdk/v2/client'
import type { ComparePermissionMode } from '@shared/ipc-code'
import { rulesetForMode } from '@shared/permission-rules'
import type { MetricMessage } from './metrics'
import { EngineCallError } from './rate-limit'

export type EngineStatus = { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next?: number }

export interface EngineMessage extends MetricMessage {
  info: MetricMessage['info'] & { id?: string; error?: unknown }
}

export interface PermissionRule {
  permission: string
  pattern: string
  action: 'allow' | 'ask' | 'deny'
}

export interface CompareEngine {
  createSession(a: {
    directory: string
    title: string
    agent: string
    metadata: Record<string, unknown>
    permission?: PermissionRule[]
  }): Promise<string>
  /** `promptAsync`: devuelve en cuanto el motor acepta el prompt; lanza `EngineCallError` si lo rechaza. */
  prompt(a: {
    sessionID: string
    directory: string
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
    text: string
  }): Promise<void>
  abort(a: { sessionID: string; directory: string }): Promise<void>
  /** Estado de TODAS las sesiones de `directory` (una ausente = inactiva). */
  statuses(directory: string): Promise<Record<string, EngineStatus>>
  messages(a: { sessionID: string; directory: string }): Promise<EngineMessage[]>
  /** Ids de las sesiones hijas (subagentes). */
  children(a: { sessionID: string; directory: string }): Promise<string[]>
  deleteSession(a: { sessionID: string; directory: string }): Promise<void>
}

/** Modo efectivo de una comparación: el pedido (por defecto «Preguntar siempre»). «Todo sin preguntar» ya no se rebaja a «Automático». */
export function effectivePermissionMode(mode: ComparePermissionMode | undefined): ComparePermissionMode {
  return mode ?? 'manual'
}

/** Mismo bloque de reglas que Code (`src/shared/permission-rules.ts`); la única diferencia es quién aprueba los comandos de lectura. */
export function rulesetFor(mode: ComparePermissionMode | undefined): PermissionRule[] {
  return rulesetForMode(effectivePermissionMode(mode), { engineAllowReadOnly: true })
}

const REQUEST_TIMEOUT_MS = 30_000
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

function ok<T>(res: { data?: T; error?: unknown }): T {
  if (res.error !== undefined && res.error !== null) throw new EngineCallError(res.error)
  return res.data as T
}

export function createSdkEngine(conn: { baseUrl: string; authorization: string }): CompareEngine {
  const client = createOpencodeClient({ baseUrl: conn.baseUrl, headers: { Authorization: conn.authorization }, fetch: timedFetch })
  return {
    async createSession(a) {
      const data = ok(
        await client.session.create({
          directory: a.directory,
          title: a.title,
          agent: a.agent,
          metadata: a.metadata,
          ...(a.permission ? { permission: a.permission as PermissionRuleset } : {})
        })
      )
      return (data as { id: string }).id
    },
    async prompt(a) {
      ok(
        await client.session.promptAsync({
          sessionID: a.sessionID,
          directory: a.directory,
          agent: a.agent,
          model: a.model,
          ...(a.variant ? { variant: a.variant } : {}),
          parts: [{ type: 'text', text: a.text }]
        })
      )
    },
    async abort(a) {
      ok(await client.session.abort({ sessionID: a.sessionID, directory: a.directory }))
    },
    async statuses(directory) {
      return (ok(await client.session.status({ directory })) ?? {}) as Record<string, EngineStatus>
    },
    async messages(a) {
      return (ok(await client.session.messages({ sessionID: a.sessionID, directory: a.directory })) ?? []) as unknown as EngineMessage[]
    },
    async children(a) {
      const list = (ok(await client.session.children({ sessionID: a.sessionID, directory: a.directory })) ?? []) as { id: string }[]
      return list.map((s) => s.id)
    },
    async deleteSession(a) {
      ok(await client.session.delete({ sessionID: a.sessionID, directory: a.directory }))
    }
  }
}
