/**
 * Clasifica un fallo del sistema de archivos al instalar un componente (F8-B198), para decir la causa real en vez de
 * «revisa tu conexión»: sin espacio en el disco, sin permiso de escritura (carpeta protegida, disco de solo lectura) o ninguna de las dos.
 * Solo mira el código de error (`ENOSPC`…), nunca el texto, que cambia con el idioma del sistema.
 */
export type FsFailureKind = 'disk' | 'permission'

const DISK = new Set(['ENOSPC', 'EDQUOT', 'EFBIG'])
const PERMISSION = new Set(['EACCES', 'EPERM', 'EROFS'])

export function fsFailureKind(err: unknown): FsFailureKind | null {
  // `cause` por si una capa intermedia envolvió el error original.
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code !== 'string') continue
    if (DISK.has(code)) return 'disk'
    if (PERMISSION.has(code)) return 'permission'
  }
  return null
}
