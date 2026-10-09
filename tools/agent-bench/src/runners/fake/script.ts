import { readFileSync } from "node:fs";
import { z } from "zod";

const relPath = z.string().min(1).refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "ruta debe ser relativa al workspace");

export const FakeEventSchema = z.object({
  type: z.enum(["message", "tool_call"]),
  name: z.string().optional(),
  text: z.string().optional(),
  /** archivo (relativo al ws) que el "agente" dice leer */
  read: relPath.optional(),
  delayMs: z.number().int().min(0).max(120_000).optional(),
});

export const FakeScriptSchema = z.object({
  schemaVersion: z.literal("1").default("1"),
  seed: z.number().int().default(1),
  model: z.string().default("fake-model"),
  events: z.array(FakeEventSchema).default([]),
  /** totales; cached/peakContext opcionales (ausentes => no observados) */
  usage: z
    .object({ input: z.number().int(), output: z.number().int(), cached: z.number().int().optional(), peakContext: z.number().int().optional() })
    .optional(),
  /** fracción de variación determinista (por semilla) sobre tokens y retardos */
  jitter: z.number().min(0).max(0.9).default(0),
  patch: z.object({ write: z.record(relPath, z.string()).default({}), delete: z.array(relPath).default([]) }).optional(),
  failure: z
    .object({
      kind: z.enum(["rate_limit", "hang", "crash", "orphan"]),
      /** se dispara tras emitir este nº de eventos (def: todos) */
      atEvent: z.number().int().min(0).optional(),
    })
    .optional(),
  /** hijos reales (node con sleep, sin CPU) que el agente lanza y mantiene */
  children: z.number().int().min(0).max(5).default(0),
  /** nombre de variable de entorno cuyo valor el agente imprime (simula fuga) */
  leakSecretEnv: z.string().optional(),
});

export type FakeScript = z.infer<typeof FakeScriptSchema>;
export type FakeScriptInput = z.input<typeof FakeScriptSchema>;

export function loadScript(src: FakeScriptInput | string): FakeScript {
  const raw = typeof src === "string" ? (JSON.parse(readFileSync(src, "utf8")) as unknown) : src;
  return FakeScriptSchema.parse(raw);
}
