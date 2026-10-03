/**
 * La PWA se sirve por HTTP en una IP local: NO es un contexto seguro, así que el navegador del celular oculta algunas APIs
 * que la interfaz de escritorio (cargada desde un archivo de la app, contexto seguro) da por hechas:
 *  - `crypto.randomUUID()` (la usa la vigilancia de archivos de Code) → se rehace con `crypto.getRandomValues`, que sí existe;
 *  - `navigator.clipboard.writeText()` (botones «copiar») → se rehace con un `textarea` temporal y `execCommand('copy')`.
 * Solo se instalan si faltan; en un contexto seguro (p. ej. el HTTPS de la fase 2) no hacen nada.
 */

export function uuidV4(getRandomValues: (a: Uint8Array) => Uint8Array): string {
  const b = getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

/** Copia texto con el método antiguo (funciona sin contexto seguro, dentro de un gesto del usuario). */
export function legacyCopy(doc: Document, text: string): boolean {
  const ta = doc.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  doc.body.append(ta)
  const active = doc.activeElement as HTMLElement | null
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = doc.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.()
  return ok
}

export function installInsecureContextShims(win: Window & typeof globalThis = window): void {
  const c = win.crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID !== 'function') {
    try {
      Object.defineProperty(c, 'randomUUID', { value: () => uuidV4((a) => c.getRandomValues(a)), configurable: true })
    } catch {
      /* crypto no admite propiedades nuevas: la vigilancia de archivos fallará con un error claro */
    }
  }
  const nav = win.navigator as Navigator & { clipboard?: Clipboard }
  if (!nav.clipboard) {
    const fake = {
      writeText: (text: string): Promise<void> =>
        legacyCopy(win.document, text) ? Promise.resolve() : Promise.reject(new DOMException('Copy failed', 'NotAllowedError')),
      readText: (): Promise<string> => Promise.reject(new DOMException('Clipboard read is not available', 'NotAllowedError'))
    }
    try {
      Object.defineProperty(nav, 'clipboard', { value: fake, configurable: true })
    } catch {
      /* sin cambios */
    }
  }
}
