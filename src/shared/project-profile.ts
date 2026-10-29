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
}

export interface VaultSetView {
  ok: boolean
  saved: string[]
  problems: string[]
  reason?: 'no-encryption' | 'too-many' | 'bad-folder'
  profile: ProjectProfileView
}
