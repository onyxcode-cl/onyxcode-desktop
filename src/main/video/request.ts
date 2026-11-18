/** Identidad del pedido comprobada contra el motor, nunca elegida por la IA. Un fallo impide reemplazar salidas. */
export async function videoRequest(
  connection: { baseUrl: string; authorization: string },
  directory: string,
  session: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (!/^ses_[A-Za-z0-9]+$/.test(session)) return null
  try {
    const res = await fetchImpl(`${connection.baseUrl}/session/${session}/message?directory=${encodeURIComponent(directory)}&limit=100`, {
      headers: { authorization: connection.authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 2 * 1024 * 1024) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    const messages: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!Array.isArray(messages)) return null
    const users = messages
      .map((m) => m?.info)
      .filter(
        (m) =>
          m?.role === 'user' &&
          m.sessionID === session &&
          typeof m.id === 'string' &&
          /^msg_[A-Za-z0-9]+$/.test(m.id) &&
          typeof m.time?.created === 'number' &&
          Number.isFinite(m.time.created)
      )
      .sort((a, b) => b.time.created - a.time.created || b.id.localeCompare(a.id))
    return users[0]?.id ?? null
  } catch {
    return null
  }
}
