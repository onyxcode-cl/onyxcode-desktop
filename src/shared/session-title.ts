/** OpenCode nombra una sesión nueva «New session - 2026-10-09T21:00:00.000Z» hasta que el agente le pone título: se muestra con un nombre en llano. */
const PLACEHOLDER = /^(new session|child session) - \d{4}-\d{2}-\d{2}T[\d:.]+Z?$/i

export function isPlaceholderTitle(title: string | undefined | null): boolean {
  return !title || PLACEHOLDER.test(title.trim())
}

/** Título para mostrar; `fallback` es el texto de «sin título» / «Nueva conversación». */
export function displayTitle(title: string | undefined | null, fallback: string): string {
  return isPlaceholderTitle(title) ? fallback : (title as string)
}
