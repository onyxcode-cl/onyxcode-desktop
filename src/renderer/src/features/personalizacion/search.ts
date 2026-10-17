/** Búsqueda de Personalización: sin tildes ni mayúsculas, y todas las palabras escritas deben aparecer (en cualquier orden). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function matchesQuery(query: string, fields: ReadonlyArray<string | undefined>): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = normalize(fields.filter((f): f is string => !!f).join(' \n '))
  return words.every((w) => hay.includes(w))
}
