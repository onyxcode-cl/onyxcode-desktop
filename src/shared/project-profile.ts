/** Tipos compartidos de la Ficha del proyecto (nivel de acceso de la IA y Bóveda de variables). La pantalla solo recibe NOMBRES, nunca valores. */
export type AccessLevel = 'aislado' | 'comandos' | 'total'

export interface ProjectProfileView {
  /** Nombre que la persona le puso a la ficha (vacío = el de la carpeta). */
  name: string
  access: AccessLevel
  /** Nombres de las variables guardadas en la Bóveda (sin valores). */
  vaultNames: string[]
  /** ¿Hay almacén seguro para cifrar? Si no, la Bóveda no guarda nada. */
  secure: boolean
  /** Carpetas añadidas al proyecto (Code): la IA entra sin preguntar; `ro` = solo lectura. */
  linked: Array<{ path: string; name: string; mode: 'rw' | 'ro' }>
}

/** Motivos por los que una carpeta no se puede añadir (la pantalla los traduce). */
export type LinkedRejection =
  | 'not-absolute'
  | 'missing'
  | 'not-folder'
  | 'root-or-home'
  | 'system'
  | 'app-state'
  | 'secrets'
  | 'same-as-project'
  | 'inside-project'
  | 'contains-project'
  | 'has-wildcards'
  | 'too-many'
  | 'duplicate'

export type PickLinkedResult = { path: string } | { reason: LinkedRejection } | null
export interface LinkResult {
  ok: boolean
  reason?: LinkedRejection
  profile: ProjectProfileView
}

export interface VaultSetView {
  ok: boolean
  saved: string[]
  problems: string[]
  reason?: 'no-encryption' | 'too-many' | 'bad-folder'
  profile: ProjectProfileView
}
