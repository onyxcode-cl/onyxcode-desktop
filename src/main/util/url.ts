/** Host (en minúsculas, sin puerto) de una URL, o `null` si no se puede parsear. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}
