/** Tamaño del texto de la interfaz (preferencia de este equipo): escala el `rem` base de toda la app. */
export type TextSizeId = 'small' | 'normal' | 'large'

export const TEXT_SIZES: { id: TextSizeId; percent: number }[] = [
  { id: 'small', percent: 92 },
  { id: 'normal', percent: 100 },
  { id: 'large', percent: 110 }
]

const KEY = 'lazunox.textSize'

export function getTextSize(): TextSizeId {
  try {
    const v = localStorage.getItem(KEY)
    return TEXT_SIZES.some((s) => s.id === v) ? (v as TextSizeId) : 'normal'
  } catch {
    return 'normal'
  }
}

/** Aplica el tamaño al documento (y lo recuerda si `save`). */
export function applyTextSize(id: TextSizeId, save = false): void {
  const percent = TEXT_SIZES.find((s) => s.id === id)?.percent ?? 100
  document.documentElement.style.fontSize = percent === 100 ? '' : `${percent}%`
  if (!save) return
  try {
    if (id === 'normal') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, id)
  } catch {
    // sin almacenamiento: el cambio vale solo para esta sesión
  }
}
