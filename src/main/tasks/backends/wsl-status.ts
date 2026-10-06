/**
 * Análisis PURO de la salida de `wsl.exe` para decidir el estado de Tareas en Windows (F8-B81).
 * Las salidas llegan ya decodificadas (`decodeWslOutput`: UTF-16LE sin `WSL_UTF8`, UTF-8 con él). Los mensajes de
 * `wsl.exe` están localizados (es/en…): se miran códigos y marcas numéricas antes que frases.
 */
import { WSL_DISTRO } from './wsl-spec'
import { compareWslRootfsVersion } from './wsl-pin'
import { decodeWslOutput } from './bridge-protocol'
import type { SandboxState } from './types'

export interface DistroInfo {
  name: string
  /** Texto localizado del estado (`Running`, `En ejecución`, `Stopped`…). */
  state: string
  version: number
  isDefault: boolean
}

/** `wsl -l -v`: columnas NAME / STATE / VERSION; el estado puede tener espacios, la versión es el último token. */
export function parseDistroList(text: string): DistroInfo[] {
  const out: DistroInfo[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\u0000/g, '')
    if (!line.trim()) continue
    const isDefault = /^\s*\*/.test(line)
    const tokens = line
      .replace(/^\s*\*?\s*/, '')
      .trim()
      .split(/\s+/)
    if (tokens.length < 3) continue
    const version = Number(tokens[tokens.length - 1])
    if (!Number.isInteger(version)) continue // cabecera
    out.push({ name: tokens[0]!, state: tokens.slice(1, -1).join(' '), version, isDefault })
  }
  return out
}

export interface RunResult {
  /** null si el proceso no llegó a ejecutarse o se cortó por tiempo. */
  code: number | null
  stdout: Buffer
  stderr: Buffer
  /** `ENOENT` (no existe wsl.exe), `timeout` u otro código de error del sistema. */
  error?: string
}

/** Datos de `/etc/lazunox-rootfs.json` que devuelve el probe; `null` = el archivo no existe (distro ajena). */
export interface ProbeRootfs {
  id: string
  version: string
}

export interface ProbeInfo {
  interop: boolean
  driveMounts: string[]
  landlockAbi: number
  kernel: string
  uid: number
  /** Campos opcionales (lanzador nuevo). Ausente = lanzador antiguo: no se juzga. */
  rootfs?: ProbeRootfs | null
  /** sha de la carga instalada (`null` = sin carga). */
  payloadSha?: string | null
  /** Montajes de sistema de WSL con tipo de unidad (9p/virtiofs/fuse*) que NO son unidades de Windows. */
  wslSystemMounts?: string[]
}

/** Tipos de sistema de archivos que dan acceso a Windows (o al anfitrión): cuentan como unidades. */
export function isDriveFsType(t: string): boolean {
  return /^(9p|drvfs|virtiofs|fuse.*)$/i.test(t)
}

/** Montajes de sistema de WSL tolerados aunque sean 9p/virtiofs (GPU y WSLg). */
export const WSL_SYSTEM_MOUNT_ALLOWED = ['/usr/lib/wsl/drivers', '/usr/lib/wsl/lib', '/mnt/wslg']
const isAllowedSystemMount = (m: string): boolean => WSL_SYSTEM_MOUNT_ALLOWED.some((a) => m === a || m.startsWith(a + '/'))

export function parseProbe(text: string): ProbeInfo | null {
  try {
    const p = JSON.parse(text.trim().split('\n').pop() ?? '') as Partial<ProbeInfo>
    if (
      typeof p.interop !== 'boolean' ||
      !Array.isArray(p.driveMounts) ||
      !p.driveMounts.every((m) => typeof m === 'string') ||
      !Number.isInteger(p.landlockAbi) ||
      typeof p.kernel !== 'string' ||
      !Number.isInteger(p.uid)
    )
      return null
    if (p.rootfs !== undefined && p.rootfs !== null) {
      if (typeof p.rootfs !== 'object' || typeof p.rootfs.id !== 'string' || typeof p.rootfs.version !== 'string') return null
    }
    if (p.payloadSha !== undefined && p.payloadSha !== null && typeof p.payloadSha !== 'string') return null
    if (p.wslSystemMounts !== undefined && (!Array.isArray(p.wslSystemMounts) || !p.wslSystemMounts.every((m) => typeof m === 'string')))
      return null
    return p as ProbeInfo
  } catch {
    return null
  }
}

export interface WslVersionInfo {
  /** `2.4.13.0` (primera versión con puntos de `--version`). */
  wsl?: string
  /** `6.6.87.2` (segunda línea con versión; el sufijo `-microsoft…` se ignora). */
  kernel?: string
}

/**
 * `wsl --version`: línea 1 = WSL, línea 2 = núcleo, el resto (WSLg, MSRDC, Windows…) no interesa. Las etiquetas están
 * localizadas, así que se leen solo los números: la primera y la segunda línea que contengan `N.N.N[.N]`.
 */
export function parseWslVersion(text: string): WslVersionInfo {
  const nums: string[] = []
  for (const line of text
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .split('\n')) {
    const m = /\d+(?:\.\d+){2,3}/.exec(line)
    if (m) nums.push(m[0])
    if (nums.length === 2) break
  }
  return { wsl: nums[0], kernel: nums[1] }
}

/** Compara versiones numéricas con puntos (`5.15.153.1` vs `5.19`). */
export function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const d = (pa[k] ?? 0) - (pb[k] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** ABI 2 de Landlock exige núcleo >= 5.19. */
export const MIN_KERNEL = '5.19'

const text = (r: RunResult): string => decodeWslOutput(r.stdout) + '\n' + decodeWslOutput(r.stderr)

/** Códigos de error de virtualización que imprime wsl.exe (HCS / 0x80370102 / 0x80070003…) sin depender del idioma. */
const VIRT_RE = /HCS_E_HYPERV_NOT_INSTALLED|0x80370102|0x80370114|ERROR_VIRTUALIZATION|VIRTUALIZATION_NOT_ENABLED|virtualiz/i
const KERNEL_RE = /0x800701bc|WSL 2 requires an update|kernel component|WSL2.*(actualiz|update)/i
/** PROVISIONAL (capturar el texto real en el PC): WSL bloqueado por directiva de la organización. */
const ORG_RE = /group policy|directiva de grupo|blocked by (your|an?) (organi[sz]ation|administrator)|bloquead[oa] por/i
/** El probe no pudo ni ejecutar el lanzador (carga ausente por un setup interrumpido). */
const NO_PAYLOAD_RE = /execvpe|ENOENT|No such file|no existe|no se encuentra|cannot find|0x80070002|ERROR_FILE_NOT_FOUND/i

export interface StatusInputs {
  policyDisabled?: boolean
  /** `wsl --version` */
  version: RunResult
  /** `wsl -l -v` */
  list: RunResult
  /** `launcher.py --probe` (solo si la distro existe). */
  probe?: RunResult | null
  /** Versión de imagen del pin (`wsl-rootfs.version`): por debajo → `update:rootfs`. */
  expectedRootfsVersion?: string
  /** `wsl-rootfs.minVersion`: por debajo, la actualización es obligatoria (`update:rootfs:required`). */
  minRootfsVersion?: string
  /** sha de la carga que trae esta app: distinto → `update:payload`. */
  expectedPayloadSha?: string
}

export interface WslStatus {
  state: SandboxState
  detail?: string
}

export function classifyWslStatus(i: StatusInputs): WslStatus {
  if (i.policyDisabled) return { state: 'policyDisabled' }
  if (i.version.error === 'ENOENT' || i.list.error === 'ENOENT') return { state: 'needsWsl', detail: 'wsl.exe' }
  const all = text(i.version) + '\n' + text(i.list)
  const versionOk = i.version.code === 0
  const listOk = i.list.code === 0
  if (!versionOk || !listOk) {
    if (VIRT_RE.test(all)) return { state: 'needsVirtualization' }
    if (KERNEL_RE.test(all)) return { state: 'needsWsl2', detail: 'kernel' }
    if (ORG_RE.test(all)) return { state: 'needsWsl', detail: 'org' }
  }
  if (!versionOk) {
    // WSL integrado antiguo: `--version` no existe pero `-l` responde.
    if (listOk) return { state: 'needsWsl2', detail: 'old-wsl' }
    return { state: 'needsWsl', detail: `version:${i.version.code ?? i.version.error ?? '?'}` }
  }
  const kernel = parseWslVersion(decodeWslOutput(i.version.stdout)).kernel
  if (kernel && compareDotted(kernel, MIN_KERNEL) < 0) return { state: 'needsWsl2', detail: 'kernel' }
  // WSL instalado pero sin distros (`-l` falla con WSL_E_DEFAULT_DISTRO_NOT_FOUND): es el caso normal tras
  // `wsl --install --no-distribution`, lo que falta es nuestra distro, no WSL.
  if (!listOk) return { state: 'needsSetup', detail: 'no-distros' }
  const mine = parseDistroList(decodeWslOutput(i.list.stdout)).find((d) => d.name === WSL_DISTRO)
  if (!mine) return { state: 'needsSetup' }
  if (mine.version !== 2) return { state: 'broken', detail: 'wsl1' }
  const pr = i.probe
  if (pr && pr.code !== 0 && NO_PAYLOAD_RE.test(text(pr))) return { state: 'broken', detail: 'payload' }
  const probe = pr && pr.code === 0 ? parseProbe(decodeWslOutput(pr.stdout)) : null
  if (!probe) return { state: 'broken', detail: 'probe' }
  if (probe.rootfs === null) return { state: 'broken', detail: 'foreign' }
  if (probe.payloadSha === null) return { state: 'broken', detail: 'payload' }
  if (probe.interop) return { state: 'broken', detail: 'interop' }
  if (probe.driveMounts.length > 0) return { state: 'broken', detail: 'drives' }
  // virtiofs/9p/fuse* fuera de los montajes de sistema conocidos de WSL cuentan como unidades.
  if ((probe.wslSystemMounts ?? []).some((m) => !isAllowedSystemMount(m))) return { state: 'broken', detail: 'drives' }
  // Sin Landlock se falla cerrado (recomendación del plan, decisión del dueño §8.4).
  if (probe.landlockAbi < 2) return { state: 'broken', detail: `landlock:${probe.landlockAbi}` }
  if (i.expectedRootfsVersion && probe.rootfs && compareWslRootfsVersion(probe.rootfs.version, i.expectedRootfsVersion) < 0) {
    const required = i.minRootfsVersion && compareWslRootfsVersion(probe.rootfs.version, i.minRootfsVersion) < 0
    return { state: 'needsSetup', detail: required ? 'update:rootfs:required' : 'update:rootfs' }
  }
  if (i.expectedPayloadSha && probe.payloadSha && probe.payloadSha !== i.expectedPayloadSha) {
    return { state: 'needsSetup', detail: 'update:payload' }
  }
  return { state: 'ready', detail: probe.kernel }
}
