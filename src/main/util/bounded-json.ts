/** Solo para APIs fijas elegidas por main; nunca recibe una URL aportada por el modelo. */
export async function boundedJson(url: string, init: RequestInit, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
  try {
    if (!res.ok) throw Error(`La búsqueda no está disponible (HTTP ${res.status}).`)
    const reader = res.body?.getReader()
    if (!reader) throw Error('Respuesta vacía del buscador.')
    const parts: Buffer[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 1024 * 1024) throw Error('Respuesta del buscador demasiado grande.')
        parts.push(Buffer.from(next.value))
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } finally {
    if (!res.body?.locked) await res.body?.cancel().catch(() => undefined)
  }
}
