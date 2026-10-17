/** Lo que devuelve cada extractor de formato: el contenido en Markdown y lo que se sabe del archivo. */
export interface Extracted {
  body: string
  /** Páginas / hojas / diapositivas totales del archivo, si el formato lo dice. */
  units: number | null
  /** Avisos de recorte propios del formato (filas, columnas, hojas, diapositivas), ya traducidos. */
  notes: string[]
  /** `true` si el texto se cortó por el tope de caracteres. */
  truncated: boolean
}
