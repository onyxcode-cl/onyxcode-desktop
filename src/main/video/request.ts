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

/** Solo adjuntos de mensajes humanos de la sesión activa. Jamás interpreta rutas del modelo como acceso a disco. */
export async function videoAttachment(
  connection: { baseUrl: string; authorization: string },
  directory: string,
  session: string,
  origin: string,
  kind: 'photo' | 'audio',
  fetchImpl: typeof fetch = fetch
): Promise<Buffer | null> {
  if (!/^ses_[A-Za-z0-9]+$/.test(session) || !origin || origin.length > 400) return null
  try {
    const response = await fetchImpl(
      `${connection.baseUrl}/session/${session}/message?directory=${encodeURIComponent(directory)}&limit=100`,
      {
        headers: { authorization: connection.authorization },
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      }
    )
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > 48 * 1024 * 1024) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    const messages: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!Array.isArray(messages)) return null
    const matches: Buffer[] = []
    for (const msg of messages) {
      if (msg?.info?.role !== 'user' || msg.info.sessionID !== session || !Array.isArray(msg.parts)) continue
      for (const part of msg.parts) {
        if (part?.type !== 'file' || (part.id !== origin && part.filename !== origin) || typeof part.url !== 'string') continue
        const match = /^data:(image\/(?:png|jpeg|webp|gif)|audio\/(?:mpeg|mp3|mp4|m4a|wav|x-wav|aac));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          part.url
        )
        if (!match || !match[1].startsWith(kind === 'photo' ? 'image/' : 'audio/')) continue
        const bytes = Buffer.from(match[2], 'base64')
        if (bytes.length <= 32 * 1024 * 1024) matches.push(bytes)
      }
    }
    // Un nombre repetido con contenido distinto es ambiguo: usar el id de la parte.
    return matches.length && matches.every((b) => b.equals(matches[0])) ? matches[0] : null
  } catch {
    return null
  }
}
