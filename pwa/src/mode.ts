/**
 * ¿Esta página corre en el sitio del servicio de conexión (HTTPS, modo nube) o servida por el propio Mac en la red local (HTTP)?
 * El modo nube exige contexto seguro Y el origen exacto del sitio: una copia de la página en otro dominio nunca se comporta
 * como el sitio oficial (no usa el almacén de claves de este ni conecta con el servicio).
 */
import { CLOUD_ORIGIN } from '../../src/shared/remote/cloud'
import { TUNNEL_ORIGIN_RE } from '../../src/shared/remote/travel'

export function isCloudMode(origin: string, secure: boolean): boolean {
  return secure && origin === CLOUD_ORIGIN
}

/**
 * ¿Esta página la sirve el túnel del modo viaje (HTTPS en `https://<palabras>.trycloudflare.com`, sin puerto ni ruta)? Solo con
 * contexto seguro y el patrón EXACTO: HTTP, otro dominio o un puerto nunca cuentan. El vínculo y la clave viven en el almacenamiento
 * de ESE origen, así que valen solo para ese túnel.
 */
export function isTravelMode(origin: string, secure: boolean): boolean {
  return secure && TUNNEL_ORIGIN_RE.test(origin)
}
