/**
 * ¿Esta página corre en el sitio del servicio de conexión (HTTPS, modo nube) o servida por el propio Mac en la red local (HTTP)?
 * El modo nube exige contexto seguro Y el origen exacto del sitio: una copia de la página en otro dominio nunca se comporta
 * como el sitio oficial (no usa el almacén de claves de este ni conecta con el servicio).
 */
import { CLOUD_ORIGIN } from '../../src/shared/remote/cloud'

export function isCloudMode(origin: string, secure: boolean): boolean {
  return secure && origin === CLOUD_ORIGIN
}
