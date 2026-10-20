/**
 * Pide a la IA un texto suelto (mensaje de commit, título/descripción de un PR, revisión) SIN dejar rastro en la lista de
 * sesiones y SIN herramientas: crea una sesión efímera del agente de conversación con TODOS los permisos denegados (ni archivos,
 * ni terminal, ni web), envía el prompt, espera la respuesta, la lee y borra la sesión. No publica ni ejecuta nada: solo devuelve texto
 * que la persona revisa y edita.
 */
import { CHAT_AGENT } from '@shared/types'
import { NO_AI_ERROR } from '@shared/ai-errors'
import { t } from '@shared/i18n'
import { currentAiGate } from '../../../../lib/ai-gate'
import { resolveModelForMode } from '../../../settings/impl/extras'
import { errorMessage, requireClient } from '../client'

/** Marca de las sesiones efímeras: el store de Code y las listas las ignoran. */
export const PR_HELPER_MODE = 'pr-helper'

/**
 * Todo denegado, igual que el agente de conversación: la única excepción es `read` sobre una ruta que no existe, porque el modelo
 * gratuito rechaza peticiones sin esa herramienta anunciada (probado con el motor real) y no lee nada de verdad.
 */
export const HELPER_PERMISSION = [
  { permission: '*', pattern: '*', action: 'deny' as const },
  { permission: 'read', pattern: '/__lazunox_sin_acceso__', action: 'allow' as const }
]

const POLL_MS = 700
const DEFAULT_TIMEOUT_MS = 150_000

export interface AskOptions {
  /** Modelo de qué modo se usa (por defecto el de Code; la traducción de PDF usa el de Chat). */
  mode?: 'chat' | 'code'
  signal?: AbortSignal
  timeoutMs?: number
  /** Prueba: sustituye al reloj/espera. */
  sleep?: (ms: number) => Promise<void>
}

interface MsgPart {
  type?: string
  text?: string
  synthetic?: boolean
}
interface Msg {
  info?: { role?: string; error?: unknown; time?: { completed?: number } }
  parts?: MsgPart[]
}

/** Texto de la última respuesta COMPLETA del asistente, o `null` si todavía no hay. Lanza si el motor reportó un error. */
export function finishedAnswer(messages: Msg[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.info?.role !== 'assistant') continue
    if (m.info.error) throw new Error(errorMessage(m.info.error))
    if (!m.info.time?.completed) return null
    return (m.parts ?? [])
      .filter((p) => p.type === 'text' && !p.synthetic && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
      .trim()
  }
  return null
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function askModel(directory: string, prompt: string, opts: AskOptions = {}): Promise<string> {
  const client = requireClient()
  const wanted = resolveModelForMode(opts.mode ?? 'code')
  const { effective, gate } = currentAiGate(wanted)
  if (gate.blocked || !effective) throw NO_AI_ERROR
  const sleep = opts.sleep ?? realSleep
  const created = await client.session.create({
    directory,
    title: 'Lazunox',
    agent: CHAT_AGENT,
    metadata: { mode: PR_HELPER_MODE },
    permission: HELPER_PERMISSION
  })
  if (created.error || !created.data) throw new Error(errorMessage(created.error))
  const sessionID = created.data.id
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const sent = await client.session.promptAsync({
      sessionID,
      directory,
      agent: CHAT_AGENT,
      model: { providerID: effective.providerID, modelID: effective.modelID },
      parts: [{ type: 'text', text: prompt }]
    })
    if ((sent as { error?: unknown }).error) throw new Error(errorMessage((sent as { error?: unknown }).error))
    for (;;) {
      if (opts.signal?.aborted) throw new Error('aborted')
      if (Date.now() > deadline) throw new Error(t('pr.err.timeout'))
      await sleep(POLL_MS)
      const res = await client.session.messages({ sessionID, directory })
      if (res.error) throw new Error(errorMessage(res.error))
      const answer = finishedAnswer((res.data ?? []) as unknown as Msg[])
      if (answer !== null) {
        if (!answer) throw new Error(t('code.client.emptyResponse'))
        return answer
      }
    }
  } catch (err) {
    await client.session.abort({ sessionID, directory }).catch(() => undefined)
    throw err
  } finally {
    await client.session.delete({ sessionID, directory }).catch(() => undefined)
  }
}
