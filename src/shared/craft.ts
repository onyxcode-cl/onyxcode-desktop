/** Estado de las presentaciones con diseño premium (DeckCraft, opcional) que ve la interfaz. Sin dependencias de Electron. */
export type CraftUiState =
  | { state: 'unsupported'; reason: string }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'installed'; version: string }

export interface CraftUiSnapshot {
  status: CraftUiState
  /** Hay una instalación en curso. */
  installing: boolean
  progress?: { phase: 'download' | 'verify' | 'copy' | 'done'; done?: number; total?: number }
  /** Código del último fallo (`hash`, `signature`, `disk`, `download`, `cancelled`…), hasta que se reintente. */
  error?: string
}

export type CraftInstallResult = { ok: true } | { ok: false; error: string; message: string }
