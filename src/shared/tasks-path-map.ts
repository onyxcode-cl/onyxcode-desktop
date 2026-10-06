/**
 * Mapa de rutas entre la interfaz/`main` (Windows) y el interior del sandbox de Tareas (módulo PURO).
 *
 * En macOS el sandbox ve las mismas rutas que el anfitrión (`identity`). En Windows con WSL2 la traducción es
 * léxica y biyectiva (`C:\a\b` ⇄ `/win/c/a/b`, ver `wsl-paths.ts`). TRADUCIR NO ES AUTORIZAR: que una ruta se
 * pueda traducir no significa que esté permitida; eso lo decide siempre `assertInsideApproved`.
 * El renderer lo usa solo para MOSTRAR rutas; `main` para hablar con OpenCode.
 */
import { fromSandboxPath, toSandboxPath, winFromLinuxAbsolute, type PathMount } from './wsl-paths'

export type PathMapWire = { kind: 'identity' } | { kind: 'wsl'; mounts: PathMount[] }

export const IDENTITY_MAP: PathMapWire = { kind: 'identity' }

/**
 * Ruta del sandbox → ruta del anfitrión, solo si cae dentro de un montaje. `null` si no se puede traducir
 * (fuera de los montajes, forma inválida). Identidad en `identity`.
 */
export function toHost(map: PathMapWire, p: string): string | null {
  if (map.kind === 'identity') return typeof p === 'string' ? p : null
  const r = fromSandboxPath(p, map.mounts)
  return r.ok ? r.path : null
}

/** Ruta del anfitrión → ruta del sandbox, o `null` si la ruta es inválida (UNC, ADS, `..`, 8.3, relativa…). */
export function toSandboxOrNull(map: PathMapWire, p: string): string | null {
  if (map.kind === 'identity') return typeof p === 'string' ? p : null
  const r = toSandboxPath(p)
  return r.ok ? r.path : null
}

/** Como `toSandboxOrNull`, pero devuelve `p` sin tocar si no se puede traducir (usar solo con rutas ya validadas). */
export function toSandbox(map: PathMapWire, p: string): string {
  return toSandboxOrNull(map, p) ?? p
}

/**
 * Ruta para MOSTRAR al usuario. Primero los montajes; después la forma `/win/<letra>/…` aunque no esté montada
 * (p. ej. una petición `external_directory`). Si nada traduce, devuelve `p` sin tocar. Nunca autoriza nada.
 */
export function displayPath(map: PathMapWire, p: string): string {
  if (map.kind === 'identity') return p
  const host = toHost(map, p)
  if (host !== null) return host
  const w = winFromLinuxAbsolute(p)
  return w.ok ? w.path : p
}
