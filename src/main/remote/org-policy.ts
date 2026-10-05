/**
 * Política de la organización para el control remoto: bloque `remote` del `managed.json` que ya usa Tareas
 * (`tasks/policy.ts`; mismas rutas, mismo archivo). Solo lectura y FAIL CLOSED:
 *
 *  - sin archivo → sin restricciones de la organización (la función sigue gobernada por los ajustes del usuario);
 *  - archivo presente pero ilegible, con JSON inválido o que no es un objeto → control remoto DESHABILITADO (`invalid`);
 *  - `remote` presente pero que no es un objeto → DESHABILITADO (`invalid`);
 *  - `enabled: false` → DESHABILITADO (`disabled`); `enabled` con cualquier otro valor que no sea `true` → `invalid`;
 *  - booleanos que RELAJAN (`allowRemember`, `allowConfirmRemember12h`): solo `true` los permite; cualquier otra cosa = `false`;
 *  - booleano que ENDURECE (`requirePin`): solo `false` lo desactiva; cualquier otra cosa = `true`;
 *  - booleano que ENDURECE pero NO viene activado (`requireConnectionConfirm`): ausente = `false`; presente y distinto de `false`
 *    (incluido un valor raro) = `true`: cada conexión de un celular ya vinculado se confirma en el Mac;
 *  - booleanos que RELAJAN y son de «fuera de casa» (`allowOutsideNetwork`, `allowRelay`, `allowPush`): sin archivo valen `true`;
 *    con archivo (con o sin bloque `remote`) y la clave AUSENTE valen `false` (lo más restrictivo: una política escrita antes de
 *    esta función no autorizó la nube); solo `true` exacto los permite;
 *  - Modo viaje: `allowTravelMode`, `allowTravelRelay` y `allowTravelDownload` RELAJAN (sin archivo `true`; con archivo y la clave
 *    ausente `false`; solo `true` exacto permite). `travelMaxHours`: sin archivo 24; con archivo y la clave ausente, no entera o
 *    rara = 1; entero fuera de 1–24 se recorta;
 *  - booleano que ENDURECE (`requirePasskey`): ausente = `false`; presente y distinto de `false` = `true`;
 *  - números: enteros fuera de rango se recortan al límite (`maxDevices` 0–3, `deviceTtlDays` 1–365); un valor que no es
 *    un entero cuenta como el más restrictivo (`maxDevices` 0, `deviceTtlDays` 1).
 *
 * La política manda sobre los ajustes del usuario y no se puede cambiar desde la app. Se relee cuando el archivo cambia
 * (mtime/tamaño/ctime), así que un cambio del administrador se aplica sin reiniciar.
 */
import { readFileSync, statSync } from 'node:fs'
import type { RemotePolicyView } from '@shared/ipc-remote'
import { LIMITS } from '@shared/remote/protocol'

const TRAVEL_MAX_HOURS = 24

export const NO_ORG_POLICY: RemotePolicyView = {
  managed: false,
  blocked: false,
  allowRemember: true,
  requirePin: false,
  maxDevices: LIMITS.maxDevices,
  deviceTtlDays: null,
  allowConfirmRemember12h: true,
  requireConnectionConfirm: false,
  allowOutsideNetwork: true,
  allowRelay: true,
  allowPush: true,
  requirePasskey: false,
  allowTravelMode: true,
  travelMaxHours: TRAVEL_MAX_HOURS,
  allowTravelRelay: true,
  allowTravelDownload: true
}

/** Con archivo de política: lo de «fuera de casa» solo se permite si se dice expresamente. */
const MANAGED_BASE: RemotePolicyView = {
  ...NO_ORG_POLICY,
  managed: true,
  allowOutsideNetwork: false,
  allowRelay: false,
  allowPush: false,
  allowTravelMode: false,
  travelMaxHours: 1,
  allowTravelRelay: false,
  allowTravelDownload: false
}

/** Archivo presente pero no fiable: todo cerrado. */
export function invalidRemotePolicy(): RemotePolicyView {
  return {
    managed: true,
    blocked: 'invalid',
    allowRemember: false,
    requirePin: true,
    maxDevices: 0,
    deviceTtlDays: 1,
    allowConfirmRemember12h: false,
    requireConnectionConfirm: true,
    allowOutsideNetwork: false,
    allowRelay: false,
    allowPush: false,
    requirePasskey: true,
    allowTravelMode: false,
    travelMaxHours: 1,
    allowTravelRelay: false,
    allowTravelDownload: false
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Valida el JSON ya parseado de un `managed.json`. Puro. */
export function parseRemotePolicy(raw: unknown): RemotePolicyView {
  if (!isPlain(raw)) return invalidRemotePolicy()
  if (!('remote' in raw)) return { ...MANAGED_BASE }
  const r = raw.remote
  if (!isPlain(r)) return invalidRemotePolicy()
  const out: RemotePolicyView = { ...MANAGED_BASE }
  if ('enabled' in r && r.enabled !== true) out.blocked = r.enabled === false ? 'disabled' : 'invalid'
  if ('allowRemember' in r) out.allowRemember = r.allowRemember === true
  if ('allowConfirmRemember12h' in r) out.allowConfirmRemember12h = r.allowConfirmRemember12h === true
  if ('requirePin' in r) out.requirePin = r.requirePin !== false
  if ('requireConnectionConfirm' in r) out.requireConnectionConfirm = r.requireConnectionConfirm !== false
  if ('allowOutsideNetwork' in r) out.allowOutsideNetwork = r.allowOutsideNetwork === true
  if ('allowRelay' in r) out.allowRelay = r.allowRelay === true
  if ('allowPush' in r) out.allowPush = r.allowPush === true
  if ('allowTravelMode' in r) out.allowTravelMode = r.allowTravelMode === true
  if ('allowTravelRelay' in r) out.allowTravelRelay = r.allowTravelRelay === true
  if ('allowTravelDownload' in r) out.allowTravelDownload = r.allowTravelDownload === true
  if ('travelMaxHours' in r) {
    const v = r.travelMaxHours
    out.travelMaxHours = typeof v === 'number' && Number.isInteger(v) ? Math.max(1, Math.min(v, TRAVEL_MAX_HOURS)) : 1
  }
  if ('requirePasskey' in r) out.requirePasskey = r.requirePasskey !== false
  if ('maxDevices' in r) {
    const v = r.maxDevices
    out.maxDevices = typeof v === 'number' && Number.isInteger(v) ? Math.max(0, Math.min(v, LIMITS.maxDevices)) : 0
  }
  if ('deviceTtlDays' in r) {
    const v = r.deviceTtlDays
    out.deviceTtlDays = typeof v === 'number' && Number.isInteger(v) ? Math.max(1, Math.min(v, 365)) : 1
  }
  return out
}

export interface OrgPolicyFs {
  stat(file: string): { mtimeMs: number; size: number; ctimeMs: number }
  read(file: string): string
}

const realFs: OrgPolicyFs = { stat: (f) => statSync(f), read: (f) => readFileSync(f, 'utf8') }

export class OrgRemotePolicy {
  private cache: { file: string; sig: string; view: RemotePolicyView } | null = null

  /** `file` se evalúa en cada lectura (puede cambiar en desarrollo); `fs` es inyectable para las pruebas. */
  constructor(
    private readonly file: () => string,
    private readonly fs: OrgPolicyFs = realFs
  ) {}

  /** Política vigente (nunca lanza). */
  get(): RemotePolicyView {
    const file = this.file()
    let sig: string
    try {
      const st = this.fs.stat(file)
      sig = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR') {
        this.cache = { file, sig: 'none', view: NO_ORG_POLICY }
        return NO_ORG_POLICY
      }
      // Existe pero no se puede ni consultar (permisos…): no es fiable.
      const view = invalidRemotePolicy()
      this.cache = { file, sig: 'error', view }
      return view
    }
    if (this.cache && this.cache.file === file && this.cache.sig === sig) return this.cache.view
    let view: RemotePolicyView
    try {
      view = parseRemotePolicy(JSON.parse(this.fs.read(file)))
    } catch {
      view = invalidRemotePolicy()
    }
    this.cache = { file, sig, view }
    return view
  }
}
