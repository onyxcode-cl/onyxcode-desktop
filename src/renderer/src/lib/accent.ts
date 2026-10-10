/** Color de acento de la interfaz (preferencia de este equipo; no viaja al celular). `blue` = el predeterminado de siempre. */
export type AccentId = 'blue' | 'violet' | 'green' | 'teal' | 'rose'

export const ACCENTS: { id: AccentId; swatch: string }[] = [
  { id: 'blue', swatch: '#2c4fd8' },
  { id: 'violet', swatch: '#6d3fd8' },
  { id: 'green', swatch: '#1f7a4d' },
  { id: 'teal', swatch: '#0f766e' },
  { id: 'rose', swatch: '#be185d' }
]

const KEY = 'lazunox.accent'

export function getAccent(): AccentId {
  try {
    const v = localStorage.getItem(KEY)
    return ACCENTS.some((a) => a.id === v) ? (v as AccentId) : 'blue'
  } catch {
    return 'blue'
  }
}

/** Aplica el acento al documento (y lo recuerda si `save`). */
export function applyAccent(id: AccentId, save = false): void {
  const root = document.documentElement
  if (id === 'blue') delete root.dataset.accent
  else root.dataset.accent = id
  if (!save) return
  try {
    if (id === 'blue') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, id)
  } catch {
    // sin almacenamiento: el cambio vale solo para esta sesión
  }
}
