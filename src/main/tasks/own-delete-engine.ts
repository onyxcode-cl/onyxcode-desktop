/** Lectura acotada de mensajes desde main, con las credenciales de SU servidor; nunca sale el contenido al sandbox. */
import { GUARD_MAX_MESSAGES_BYTES, GUARD_UPSTREAM_TIMEOUT_MS, type GuardServerRef } from './guard-info'

export async function deleteEngineMessages(
  ref: GuardServerRef,
  sessionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown[] | null> {
  try {
    const url = `${ref.baseUrl.replace(/\/+$/, '')}/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(ref.directory)}&limit=30`
    const r = await fetchImpl(url, {
      headers: { authorization: ref.authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(GUARD_UPSTREAM_TIMEOUT_MS)
    })
    if (!r.ok) {
      await r.body?.cancel()
      return null
    }
    const reader = r.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > GUARD_MAX_MESSAGES_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export function hasLiveDeleteCall(messages: unknown[], sessionId: string, callId: string, command: string, workdir: unknown): boolean {
  return messages.some((m) => {
    if (!m || typeof m !== 'object') return false
    const msg = m as { info?: { sessionID?: string; role?: string; error?: unknown; time?: { completed?: number } }; parts?: unknown[] }
    if (
      msg.info?.sessionID !== sessionId ||
      msg.info.role !== 'assistant' ||
      msg.info.error ||
      msg.info.time?.completed ||
      !Array.isArray(msg.parts)
    )
      return false
    return msg.parts.some((part) => {
      if (!part || typeof part !== 'object') return false
      const p = part as {
        type?: string
        tool?: string
        callID?: string
        sessionID?: string
        state?: { status?: string; input?: Record<string, unknown> }
      }
      return (
        p.type === 'tool' &&
        p.tool === 'bash' &&
        p.sessionID === sessionId &&
        p.callID === callId &&
        p.state?.status === 'running' &&
        p.state.input?.command === command &&
        p.state.input?.workdir === workdir
      )
    })
  })
}
