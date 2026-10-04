export interface RunLayout {
  schemaVersion: "1";
  runId: string;
  runId8: string;
  root: string;
  ws: string;
  home: string;
  tmp: string;
  eval: string;
  out: string;
}

export interface SandboxOptions {
  /** Raíz del run: único lugar con escritura permitida. */
  runRoot: string;
  /** Rutas adicionales de solo lectura (p. ej. dir del binario del agente). */
  extraReadPaths?: string[];
  /** Permitir red (por defecto true: los proveedores la necesitan). Se ignora si se da `network`. */
  allowNetwork?: boolean;
  /** Modo de red: "all" (modelo remoto), "loopback" (solo 127.0.0.1/::1) o "none". */
  network?: NetworkMode;
  /**
   * Rutas con lectura denegada explícitamente (se aplican tras las lecturas base y antes de re-permitir
   * runRoot/extraReadPaths). Por defecto: ~/.ssh, ~/.config, ~/Library/Application Support, ~/.aws, ~/.gnupg
   * y el HOME real completo (del usuario que ejecuta el banco).
   */
  denyReadPaths?: string[];
}

export type NetworkMode = "all" | "loopback" | "none";

export type GateDecision =
  | { schemaVersion: "1"; status: "ok"; metrics: GateMetrics }
  | { schemaVersion: "1"; status: "pausa"; reason: string; metrics: GateMetrics };

export interface GateMetrics {
  loadPerCpu: number;
  ncpu: number;
  freeMemMB: number | null;
  thermal: "nominal" | "warning" | "unknown";
}

export interface GateThresholds {
  maxLoadPerCpu: number;
  minFreeMemMB: number;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  schemaVersion: "1";
  ok: boolean;
  checks: DoctorCheck[];
}

export interface SandboxedResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
