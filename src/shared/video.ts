/** Piezas opcionales de video, F8-B333. Ninguna operación de render en este paso. */
export interface VideoSnapshot {
  offered: boolean
  ready: boolean
  missingBytes: number
  installing: boolean
  items: { id: 'chrome' | 'ffmpeg' | 'ffprobe' | 'hyperframes' | 'node'; version: string; state: 'missing' | 'installed' | 'broken' }[]
  progress?: { phase: 'node' | 'download' | 'extract' | 'npm' | 'verify' | 'done'; done?: number; total?: number }
  error?: string
}
export type VideoInstallResult = { ok: true } | { ok: false; error: string }
export interface VideoPaths {
  chrome: string
  ffmpeg: string
  ffprobe: string
  hyperframes: string
}
export type VideoEnsureResult =
  { state: 'ready'; paths: VideoPaths } | { state: 'missing'; missingBytes: number } | { state: 'unsupported' }
