/**
 * Node.js y uv de la app (F8-B195): lo que ve la interfaz. Sin dependencias de Electron.
 *
 * Los conectores locales (correo, calendario, archivos) necesitan Node.js (Microsoft 365) y uv (Google Workspace). La app los descarga
 * una vez a su propia carpeta, verificados por huella; la persona no instala nada a mano.
 */

export type RuntimeUiId = 'node' | 'uv'

export interface RuntimeUiItem {
  id: RuntimeUiId
  /** `installed` listo; `missing` sin descargar; `broken` dañado o de otra versión (se repara al instalar). */
  state: 'installed' | 'missing' | 'broken' | 'unsupported'
  /** Versión fijada por la app. */
  version: string
}

export interface RuntimesSnapshot {
  /** Esta plataforma ofrece conectores locales (si no, no se pinta nada). */
  offered: boolean
  items: RuntimeUiItem[]
  /** Bytes que bajaría «Instalar» (lo que falta). */
  missingBytes: number
  ready: boolean
  installing: boolean
  progress?: { phase: 'download' | 'extract' | 'verify' | 'done'; done?: number; total?: number }
  /** Código del último fallo (`disk`, `hash`, `download`, `unsafe`, `broken`, `cancelled`…), hasta que se reintente. */
  error?: string
}

export type RuntimesInstallResult = { ok: true } | { ok: false; error: string; message: string }
