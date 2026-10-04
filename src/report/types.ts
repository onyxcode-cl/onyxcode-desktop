// Tipos del módulo de informes. Todo número desconocido es null (NaN/Infinity se serializan como null).
import type { Comparison, ConfigSummary, MetricName, Mpe, Veredicto } from "../stats/index.ts";

export interface ReportOptions {
  /** Configuración base de las comparaciones. Por defecto, la primera por id. */
  baselineId?: string;
  alpha?: number;
  seed?: number;
  /** Remuestreos bootstrap (por defecto 2000 para informes rápidos). */
  B?: number;
  mpe?: Mpe;
  /** Score compuesto opcional. DESACTIVADO por defecto. */
  composite?: boolean;
  /** Ruta que se escribe en los comandos de reproducción de claims. */
  inputRef?: string;
  /** Simulaciones Monte Carlo para la potencia (tope duro en stats). */
  powerSims?: number;
  title?: string;
}

export interface CatastropheStats {
  configId: string;
  runs: number;
  catastrophes: number;
  rate: number | null;
  wilson: { lo: number | null; hi: number | null };
  /** Motivos: tipo -> cantidad. */
  reasons: Record<string, number>;
}

export interface Dist {
  n: number;
  nulls: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
}

export interface ConfigReport {
  configId: string;
  label: string;
  itt: ConfigSummary;
  pp: ConfigSummary;
  tokens: Dist;
  duration: Dist;
  /** Coste medio por run (USD) si TODOS los runs lo declaran; si no null. */
  costUsdMean: number | null;
  catastrophe: CatastropheStats;
  onParetoFront: boolean;
}

export type StabilityCell = "siempre" | "nunca" | "a veces" | "sin datos";

export interface StabilityRow {
  caseId: string;
  cells: Record<string, { state: StabilityCell; successes: number; runs: number }>;
}

export interface PowerWarning {
  comparison: string;
  metric: MetricName | "success-power";
  message: string;
}

export interface ComparisonReport {
  id: string;
  comparison: Comparison;
  /** Potencia estimada (Monte Carlo) de detectar el MPE de éxito con el diseño observado. */
  power: { power: number | null; simsRun: number; truncated: boolean; nCases: number; repsPerCase: number; deltaMpe: number } | null;
  warnings: PowerWarning[];
}

export interface CompositeEntry {
  configId: string;
  /** 0..1 o null si faltan datos. */
  score: number | null;
  components: { success: number | null; tokens: number | null; duration: number | null };
  /** Veredictos de regresión de esta config frente a la base (nunca se ocultan). */
  regressions: string[];
}

export interface Analysis {
  schemaVersion: "1";
  title: string;
  data: { runs: number; dataHash: string; dataVersion: string; cases: number; configs: number };
  options: { baselineId: string; alpha: number; seed: number; B: number; mpe: Mpe; composite: boolean };
  configs: ConfigReport[];
  comparisons: ComparisonReport[];
  stability: StabilityRow[];
  composite: { enabled: boolean; weights: { success: number; tokens: number; duration: number }; entries: CompositeEntry[]; note: string } | null;
  warnings: string[];
}

export interface Claim {
  id: string;
  text: string;
  value: number | string | boolean | null;
  /** Ruta dentro de analysis.json donde está el valor. */
  path: string;
  /** Comando que regenera el análisis y verifica esta afirmación. */
  command: string;
  dataHash: string;
  dataVersion: string;
}

export interface ClaimsFile {
  schemaVersion: "1";
  dataHash: string;
  dataVersion: string;
  claims: Claim[];
}

export type { Veredicto };
