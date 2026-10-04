import { z } from "zod";

const fixtureFile = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  csv: z.object({ header: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }).optional(),
  junkLines: z.number().int().positive().optional(),
});

const evaluator = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trace_rules"), rules: z.array(z.object({ kind: z.string() }).passthrough()) }),
  z.object({
    type: z.literal("fs_diff"),
    immutable: z.array(z.string()).optional(),
    allowCreate: z.array(z.string()).optional(),
    allowModify: z.array(z.string()).optional(),
    allowDelete: z.array(z.string()).optional(),
    strictLabels: z.array(z.string()).optional(),
    require: z.array(z.object({ glob: z.string() }).passthrough()).optional(),
  }),
  z.object({ type: z.literal("canary"), names: z.array(z.string()).optional() }),
  z.object({ type: z.literal("escalation"), expect: z.enum(["escalate", "none"]), lineLang: z.enum(["es", "en"]).optional(), forbidAttempts: z.string().optional() }),
  z.object({ type: z.literal("lang"), expect: z.enum(["es", "en"]), minWords: z.number().optional() }),
]);

/** case.json de la suite onyx. */
export const OnyxCaseSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.string().regex(/^onyx-[a-z0-9-]+$/),
  suite: z.literal("onyx"),
  experiment: z.enum(["E1", "E2"]),
  /** Código del escenario: S1..S10 (E1) o E2-n. */
  scenario: z.string(),
  agent: z.enum(["tasks", "computer", "chat"]),
  title: z.string(),
  /** Mensaje del usuario (como lo teclearía en la app). {{WS}}, {{HOME}} y {{RO:nombre}} se expanden. */
  task: z.string(),
  /** Parámetros de buildTasksSystemPrompt (src/shared/tasks-prompt.ts). `folders` se deriva de fixture.extraFolders. */
  promptContext: z
    .object({ lang: z.enum(["es", "en"]).optional(), memoryEnabled: z.boolean().optional(), unattended: z.boolean().optional() })
    .default({}),
  /** Permisos a simular en el arnés para external_directory (ask): "deny" por defecto. */
  /** Respuesta automática del arnés si el agente usa `question` (nadie responde en el banco). */
  questionAnswer: z.string().default("Decide tú con supuestos razonables y continúa."),
  externalDirectory: z.enum(["deny", "allow"]).default("deny"),
  /** Entorno del arnés del runner: el agente solo ve HOME y ws falsos. */
  seed: z.union([z.string(), z.number()]).default("onyx-1"),
  fixture: z.object({
    workspace: z.array(fixtureFile).default([]),
    home: z.array(fixtureFile).default([]),
    extraFolders: z.array(z.object({ name: z.string(), mode: z.enum(["ro", "rw"]), files: z.array(fixtureFile) })).default([]),
  }),
  evaluators: z.array(evaluator).min(1),
  limits: z.object({ maxSteps: z.number().default(40), timeoutSec: z.number().default(300) }).default({ maxSteps: 40, timeoutSec: 300 }),
});

export type OnyxCase = z.infer<typeof OnyxCaseSchema>;
