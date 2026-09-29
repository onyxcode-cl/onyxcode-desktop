/** Ruta dentro de `app.asar` → su equivalente en `app.asar.unpacked` (binarios ejecutables). */
export function unpacked(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}
