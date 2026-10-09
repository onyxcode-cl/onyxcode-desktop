/**
 * Exenciones de la puerta de navegación (B.8, F8-B68): una navegación que NOSOTROS ya decidimos (barra de URL, agente tras
 * aprobación, atrás/adelante) no vuelve a pedir aprobación, pero solo para ESA URL exacta, UNA vez y por pestaña.
 * Antes era un interruptor por pestaña (durante toda la carga o 2 s): una redirección del servidor o un `window.open`
 * en esa ventana llegaban a un destino distinto sin pasar por la puerta.
 */
const MAX_PER_TAB = 8

export class NavBypass {
  private readonly byTab = new Map<string, Map<string, number>>()

  constructor(private readonly now: () => number = Date.now) {}

  static key(url: string): string {
    try {
      return new URL(url).href
    } catch {
      return url
    }
  }

  /** Autoriza UNA navegación a `url` en la pestaña, hasta `ttlMs` (por defecto sin caducidad: se revoca con `revoke`). */
  allow(tabId: string, url: string, ttlMs = Infinity): void {
    let m = this.byTab.get(tabId)
    if (!m) this.byTab.set(tabId, (m = new Map()))
    if (m.size >= MAX_PER_TAB) m.delete(m.keys().next().value as string)
    m.set(NavBypass.key(url), ttlMs === Infinity ? Infinity : this.now() + ttlMs)
  }

  /** ¿Está autorizada esta URL ahora? La consume (un solo uso). */
  take(tabId: string, url: string): boolean {
    const m = this.byTab.get(tabId)
    const k = NavBypass.key(url)
    const until = m?.get(k)
    if (until === undefined) return false
    m!.delete(k)
    if (m!.size === 0) this.byTab.delete(tabId)
    return until === Infinity || until > this.now()
  }

  revoke(tabId: string, url: string): void {
    const m = this.byTab.get(tabId)
    if (!m) return
    m.delete(NavBypass.key(url))
    if (m.size === 0) this.byTab.delete(tabId)
  }

  clearTab(tabId: string): void {
    this.byTab.delete(tabId)
  }
}

/**
 * `loadURL` rechaza con ERR_ABORTED (-3) cuando otra navegación la sustituye (p. ej. `about:blank` inicial de una pestaña
 * nueva frente a la URL real, o la puerta que cancela una redirección y la relanza). No es un fallo de carga.
 */
export function isAbortedNavigation(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown; message?: unknown } | null
  return e?.code === 'ERR_ABORTED' || e?.errno === -3 || /ERR_ABORTED/.test(String(e?.message ?? err))
}
