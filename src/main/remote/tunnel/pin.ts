/**
 * Pin de `cloudflared` compilado dentro de la app (`resources/cloudflared/pin.json` se empaqueta en el código firmado: su
 * integridad la cubre la firma y el sellado del .asar). Si no es válido, `CLOUDFLARED_PIN` es `null` y el modo viaje no instala
 * ni arranca nada.
 */
import pinJson from '../../../../resources/cloudflared/pin.json'
import { parsePin, type CloudflaredPin } from './binary'

export const CLOUDFLARED_PIN: CloudflaredPin | null = parsePin(pinJson)
