/** Metadatos internos de fotos comprobadas; nunca se convierten en contenido visible. */
export interface ImageCredit {
  path: string
  credit: string
  attribution?: {
    fullCredit?: string
    author: string
    license: string
    provider: string
    source: string
    licenseUrl: string
    notices?: string
    transformations?: string[]
  }
}
