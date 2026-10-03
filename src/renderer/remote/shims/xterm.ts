/**
 * Sustituto de `@xterm/xterm` en la PWA del celular: sin terminal (D5, no hay pty desde el celular), así que el paquete real
 * no se incluye en el bundle. `terminalRegistry.ts` solo crea un `Terminal` si hay pty (`platformCaps().terminal`), que en
 * la superficie `remote` es falso; si algo lo pidiera igualmente, falla con un error claro en vez de dibujar una terminal vacía.
 */
export type ITheme = Record<string, string | undefined>

export class Terminal {
  constructor() {
    throw new Error('La terminal no está disponible desde el celular.')
  }
}
