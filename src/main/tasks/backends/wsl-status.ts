/**
 * Análisis PURO de la salida de `wsl.exe` para decidir el estado de Tareas en Windows (F8-B81).
 * Las salidas llegan ya decodificadas (`decodeWslOutput`: UTF-16LE sin `WSL_UTF8`, UTF-8 con él). Los mensajes de
 * `wsl.exe` están localizados (es/en…): se miran códigos y marcas numéricas antes que frases.
 */
import { WSL_DISTRO } from './wsl-spec'
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

export interface ProbeInfo {
  interop: boolean
  driveMounts: string[]
  landlockAbi: number
  kernel: string
  uid: number
}

export function parseProbe(text: string): ProbeInfo | null {
  try {
    const p = JSON.parse(text.trim().split('\n').pop() ?? '') as Partial<ProbeInfo>
    if (
      typeof p.interop !== 'boolean' ||
      !Array.isArray(p.driveMounts) ||
      !Number.isInteger(p.landlockAbi) ||
      typeof p.kernel !== 'string' ||
      !Number.isInteger(p.uid)
    )
      return null
    return p as ProbeInfo
  } catch {
    return null
  }
}

const text = (r: RunResult): string => decodeWslOutput(r.stdout) + '\n' + decodeWslOutput(r.stderr)

/** Códigos de error de virtualización que imprime wsl.exe (HCS / 0x80370102 / 0x80070003…) sin depender del idioma. */
const VIRT_RE = /HCS_E_HYPERV_NOT_INSTALLED|0x80370102|0x80370114|ERROR_VIRTUALIZATION|VIRTUALIZATION_NOT_ENABLED|virtualiz/i
const NEEDS_WSL2_RE = /0x800701bc|WSL 2 requires an update|kernel component|WSL2.*(actualiz|update)/i

export interface StatusInputs {
  policyDisabled?: boolean
  /** `wsl --version` */
  version: RunResult
  /** `wsl -l -v` */
  list: RunResult
  /** `launcher.py --probe` (solo si la distro existe). */
  probe?: RunResult | null
}

export function classifyWslStatus(i: StatusInputs): { state: SandboxState; detail?: string } {
  if (i.policyDisabled) return { state: 'policyDisabled' }
  if (i.version.error === 'ENOENT' || i.list.error === 'ENOENT') return { state: 'needsWsl', detail: 'wsl.exe' }
  const all = text(i.version) + '\n' + text(i.list)
  if (VIRT_RE.test(all) && i.list.code !== 0) return { state: 'needsVirtualization' }
  if (NEEDS_WSL2_RE.test(all) && i.list.code !== 0) return { state: 'needsWsl2' }
  if (i.list.code !== 0) {
    // wsl.exe existe pero sin distribuciones/sin el componente: la guía de instalación es la misma.
    return { state: 'needsWsl', detail: `list:${i.list.code ?? i.list.error ?? '?'}` }
  }
  const mine = parseDistroList(decodeWslOutput(i.list.stdout)).find((d) => d.name === WSL_DISTRO)
  if (!mine) return { state: 'needsSetup' }
  if (mine.version !== 2) return { state: 'broken', detail: 'wsl1' }
  const probe = i.probe && i.probe.code === 0 ? parseProbe(decodeWslOutput(i.probe.stdout)) : null
  if (!probe) return { state: 'broken', detail: 'probe' }
  if (probe.interop) return { state: 'broken', detail: 'interop' }
  if (probe.driveMounts.length > 0) return { state: 'broken', detail: 'drives' }
  // Sin Landlock se falla cerrado (recomendación del plan, decisión del dueño §8.4).
  if (probe.landlockAbi < 2) return { state: 'broken', detail: `landlock:${probe.landlockAbi}` }
  return { state: 'ready', detail: probe.kernel }
}
