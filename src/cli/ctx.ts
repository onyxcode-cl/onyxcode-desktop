import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

/** Códigos de salida. */
export const EXIT = {
  OK: 0,
  FALLO: 1, // la comprobación/ejecución se hizo y falló
  USO: 2, // argumentos inválidos
  RECHAZADO: 3, // regla de seguridad (coste, runner real, confirmación)
  DATOS: 4, // archivo/experimento/configuración no encontrado o inválido
  NO_DISPONIBLE: 5, // motor o informes aún no disponibles
  INTERRUMPIDO: 130,
} as const;

export interface Ctx {
  /** Raíz del proyecto agent-bench. */
  root: string;
  home: string;
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
  /** Pregunta sí/no; solo se llama si isTTY. */
  confirm: (question: string) => Promise<boolean>;
  signal: AbortSignal;
}

export function defaultRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function makeCtx(signal: AbortSignal): Ctx {
  return {
    root: defaultRoot(),
    home: homedir(),
    env: process.env,
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    confirm: (q) =>
      new Promise((res) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        rl.question(`${q} [s/N] `, (a) => {
          rl.close();
          res(/^(s|si|sí|y|yes)$/i.test(a.trim()));
        });
      }),
    signal,
  };
}

/** Resultado de un comando: el main imprime y sale. */
export interface CmdResult {
  code: number;
  /** Objeto para --json. */
  data: Record<string, unknown>;
  /** Texto humano (ya en español). */
  text: string;
}

export const ok = (data: Record<string, unknown>, text: string): CmdResult => ({ code: EXIT.OK, data, text });
export const fail = (code: number, error: string, extra: Record<string, unknown> = {}): CmdResult => ({
  code,
  data: { error, ...extra },
  text: `Error: ${error}`,
});
