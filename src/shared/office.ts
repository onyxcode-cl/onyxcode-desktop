/** Estado de LibreOffice (revisión visual de Word/Excel/PowerPoint) que ve la interfaz. Sin dependencias de Electron. */
export type OfficeUiState =
  | { state: 'unsupported'; reason: string }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'installed'; source: 'app' | 'system'; version: string }

export interface OfficeUiSnapshot {
  status: OfficeUiState
  /** Hay una instalación en curso. */
  installing: boolean
  progress?: { phase: 'download' | 'verify' | 'mount' | 'copy' | 'done'; done?: number; total?: number }
  /** Código del último fallo (`hash`, `signature`, `disk`, `download`, `cancelled`…), hasta que se reintente. */
  error?: string
}

export type OfficeInstallResult = { ok: true } | { ok: false; error: string; message: string }
