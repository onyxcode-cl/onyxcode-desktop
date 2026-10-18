/**
 * Archivos de bloqueo de los conectores locales (F8-B186). Viajan DENTRO de la app (se compilan como texto), así que lo que se
 * instala es exactamente lo que se revisó: ni se descargan ni los puede cambiar nadie después de empaquetar. La ficha del
 * catálogo fija el SHA-256 de cada uno y `local-connectors.ts` lo comprueba antes de usarlo.
 *
 * Añadir un conector local exige añadir aquí sus archivos; `local-connectors.test.ts` falla si falta alguno o si su hash no
 * coincide con el de la ficha.
 */
import googleRequirements from '../../../resources/catalogo/conectores-locales/google-workspace/requirements.lock?raw'
import microsoftPackage from '../../../resources/catalogo/conectores-locales/microsoft-365/package.json?raw'
import microsoftPackageLock from '../../../resources/catalogo/conectores-locales/microsoft-365/package-lock.json?raw'

/** Clave: `<runtime.dir>/<nombre del archivo>`. */
export const LOCK_FILE_TEXT: Readonly<Record<string, string>> = {
  'google-workspace/requirements.lock': googleRequirements,
  'microsoft-365/package.json': microsoftPackage,
  'microsoft-365/package-lock.json': microsoftPackageLock
}
