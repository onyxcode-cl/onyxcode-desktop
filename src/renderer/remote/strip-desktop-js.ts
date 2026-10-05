/**
 * Quita del JS minificado de la PWA las clases con prefijo `desk:` (la variante de escritorio de Tailwind): el celular nunca marca
 * `<html data-shell>`, así que no actúan, y `stripDesktopCss` ya les quitó sus reglas. Solo toca fichas dentro de cadenas de clases:
 * ` desk:x` (con el espacio que la separa) y `"desk:x ` / `"desk:x"` al principio de la cadena. No toca claves de objeto (`{desk:…}`).
 */
export function stripDesktopJs(js: string): string {
  return js.replace(/(\s)(?:[\w@[\]-]+:)*desk:[^\s"'`\\]+/g, '').replace(/(["'`])(?:[\w@[\]-]+:)*desk:[^\s"'`\\]+\s?/g, '$1')
}
