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
 *  - números: enteros fuera de rango se recortan al límite (`maxDevices` 0–3, `deviceTtlDays` 1–365); un valor que no es
 *    un entero cuenta como el más restrictivo (`maxDevices` 0, `deviceTtlDays` 1).
 *
 * La política manda sobre los ajustes del usuario y no se puede cambiar desde la app. Se relee cuando el archivo cambia
 * (mtime/tamaño/ctime), así que un cambio del administrador se aplica sin reiniciar.
 */
import { readFileSync, statSync } from 'node:fs'
import type { RemotePolicyView } from '@shared/ipc-remote'
import { LIMITS } from '@shared/remote/protocol'

export const NO_ORG_POLICY: RemotePolicyView = {
  managed: false,
  blocked: false,
  allowRemember: true,
  requirePin: false,
  maxDevices: LIMITS.maxDevices,
  deviceTtlDays: null,
  allowConfirmRemember12h: true,
  requireConnectionConfirm: false
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
    requireConnectionConfirm: true
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Valida el JSON ya parseado de un `managed.json`. Puro. */
export function parseRemotePolicy(raw: unknown): RemotePolicyView {
  if (!isPlain(raw)) return invalidRemotePolicy()
  if (!('remote' in raw)) return { ...NO_ORG_POLICY, managed: true }
  const r = raw.remote
  if (!isPlain(r)) return invalidRemotePolicy()
  const out: RemotePolicyView = { ...NO_ORG_POLICY, managed: true }
  if ('enabled' in r && r.enabled !== true) out.blocked = r.enabled === false ? 'disabled' : 'invalid'
  if ('allowRemember' in r) out.allowRemember = r.allowRemember === true
  if ('allowConfirmRemember12h' in r) out.allowConfirmRemember12h = r.allowConfirmRemember12h === true
  if ('requirePin' in r) out.requirePin = r.requirePin !== false
  if ('requireConnectionConfirm' in r) out.requireConnectionConfirm = r.requireConnectionConfirm !== false
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
