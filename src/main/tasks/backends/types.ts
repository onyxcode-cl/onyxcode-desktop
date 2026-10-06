/**
 * Contrato de los backends de aislamiento de Tareas (F8-B81). Solo tipos: sin Electron ni efectos.
 *
 * Un backend decide CÓMO se lanza `opencode serve` aislado de una carpeta (Seatbelt en macOS, WSL2 en
 * Windows más adelante, o sin aislamiento). Los proxies de egress y de credenciales, el centinela, el
 * token del servidor, la espera de salud y `stop` siguen en `sandbox.ts` y son comunes a todos.
 */
import type { ChildProcess } from 'node:child_process'
import type { FolderAccessMode, TasksSandboxState } from '@shared/ipc-tasks'
import type { PathMount } from '@shared/wsl-paths'

export interface SandboxIsolation {
  /** Directorio privado del servidor (userData/tasks-sandbox/<hash>). */
  privateDir: string
  /** userData de la app (lectura denegada dentro del sandbox salvo privateDir/readOnly). */
  userData: string
}

export interface SandboxNetworkOptions {
  /** Puertos localhost adicionales a permitir en salida (egress proxy, credential proxy…). */
  allowedOutboundPorts: number[]
  /** Puerto propio del servidor (bind + inbound). */
  serverPort: number
  /** "Permitir borrar, mover y renombrar" concedido para esta tarea (si no, `file-write-unlink` se deniega). */
  allowDelete: boolean
  /** Carpetas adicionales (vinculadas o de confianza): `rw` escribible sin borrado, `ro` sin escritura. */
  extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
}

export interface SandboxLaunchSpec {
  folder: string
  /** Binario de OpenCode (el del anfitrión; un backend remoto usa el suyo). */
  bin: string
  serveArgs: string[]
  serverPort: number
  /** Obligatorio en los backends que aíslan; ausente solo en `none`. */
  isolation?: SandboxIsolation
  /** Config de agentes de la app, SOLO lectura dentro del sandbox. */
  configDir: string
  allowDelete: boolean
  extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
  /** Puertos localhost de salida permitidos (egress, credenciales y extra). */
  outboundPorts: number[]
  /** Entorno del anfitrión previo al aislamiento (config de OpenCode, usuario/clave del servidor…). */
  baseEnv: Record<string, string>
  /**
   * Parte del entorno que depende del proxy: variables `*_PROXY` y `OPENCODE_AUTH_CONTENT` con el
   * CENTINELA. NUNCA contiene la clave real (la prueba estática lo vigila también en `backends/*`).
   */
  proxyEnv: Record<string, string>
  /** `options.extraEnv` ya fusionado; gana sobre todo lo anterior. */
  extraEnv?: Record<string, string>
}

export interface LaunchedSandbox {
  child: ChildProcess
  /** Ruta del sandbox → ruta del anfitrión (null si no es traducible o queda fuera). Identidad en Seatbelt. */
  toHostPath(p: string): string | null
  /** Ruta del anfitrión → ruta dentro del sandbox. Identidad en Seatbelt. */
  toSandboxPath(p: string): string
  /** Montajes concedidos (WSL): ruta de Windows ⇄ ruta dentro de la distro. Ausente en Seatbelt y en `none` (identidad). */
  mounts?: PathMount[]
  /** Libera lo propio del backend (p. ej. el perfil temporal). Se llama cuando el proceso termina. */
  dispose(): Promise<void>
}

export type SandboxState = TasksSandboxState

/** Para qué se llama a `setup`: instalar desde cero, reparar la carga o actualizar la imagen. Es una pista: manda el estado real. */
export type SandboxSetupKind = 'install' | 'repair' | 'update'

export interface SandboxSetupOptions {
  /** Cancelación: efectiva hasta justo antes de importar la distro (después se espera y se deshace). */
  signal?: AbortSignal
  kind?: SandboxSetupKind
}

export interface SandboxBackend {
  id: 'seatbelt' | 'wsl' | 'none'
  status(): Promise<{ state: SandboxState; detail?: string }>
  /** Prepara el directorio privado del servidor en el anfitrión (antes de arrancar los proxies). */
  prepare?(isolation: SandboxIsolation): void
  setup?(onProgress: (pct: number, phase: string) => void, opts?: SandboxSetupOptions): Promise<void>
  /** Quita lo que `setup` creó (en WSL: la distro propia, su carpeta, la caché y el estado). */
  remove?(): Promise<void>
  launch(spec: SandboxLaunchSpec): Promise<LaunchedSandbox>
  storage?: { size(key: string): Promise<number>; remove(key: string): Promise<void> }
}
