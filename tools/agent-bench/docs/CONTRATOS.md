# Contratos de agent-bench (T0/T1)

Fuente de verdad del código: `src/core/schemas.ts`, `proc.ts`, `redact.ts`, `ids.ts`. Este documento resume las interfaces exactas para implementar en paralelo. Si hay discrepancia, manda el código; no cambies estos contratos sin avisar.

## Reglas transversales
- TypeScript, Node 22 ESM con type stripping, sin build. Imports relativos CON extensión `.ts`. Solo sintaxis borrable (sin `enum`, sin `namespace`, sin parameter properties).
- Única dependencia runtime: `zod` (v4). Tests con `node:test`: `npm test` (globs `src/**/*.test.ts`, `test/**/*.test.ts`).
- Todo esquema lleva `schemaVersion: "1"`. Dato que el CLI no da = `null`, nunca `0`. Los campos opcionales de telemetría son `T | null` (obligatorios, no `undefined`).
- Procesos hijos SIEMPRE vía `supervise()`; nunca `spawn` suelto. Comandos largos con límite de tiempo. Sin carga artificial de CPU, sin red de proveedores, sin leer ni registrar credenciales.
- Todo artefacto que se escriba a disco pasa por `redactDeep`/`redactText`.

## Outcome
`"completed" | "agent_error" | "timeout" | "hung" | "rate_limited" | "infra_error" | "cancelled"` (`OutcomeSchema`).
- `completed`: el CLI terminó por sí mismo (el éxito lo decide el evaluador, no el agente).
- `agent_error`: el agente falló/abortó por su cuenta. `timeout`: tope duro. `hung`: sin actividad (watchdog). `rate_limited`: límite del proveedor (reintentable <=3 con backoff+jitter). `infra_error`: fallo del banco/entorno (no cuenta contra la configuración). `cancelled`: SIGINT/SIGTERM/AbortSignal.
- `proc.supervise` solo produce `completed|timeout|hung|cancelled|spawn_error`; el runner lo traduce a `Outcome` (`spawn_error` => `infra_error`).

## Esquemas (zod; tipos con `z.infer`, exportados como `Scenario`, etc.)
- `ScenarioSchema` (Test Case): `id` (`^[a-z0-9][a-z0-9._-]*$`), `description`, `category` ("node"|"onyx"|...), `difficulty` (`L1..L5|ctx`), `fixture{path, commit|null}`, `task`, `constraints{allowedPaths[], forbiddenPaths[], maxChangedFiles|null}`, `evaluators[]` (min 1, cada uno `{kind, command?, timeoutSec=120, weight=1, params={}}`), `hiddenTests|null`, `referencePatch|null`, `cheatPatch|null`, `metadata`.
- `EvaluatorKind`: `tests-visible, tests-hidden, build, typecheck, git_diff, restrictions, anti-cheat, trace_rules, fs_diff, canary, escalation, lang, plan_order`.
- `ConfigurationSchema`: `id`, `name`, `runner`, `provider|null`, `model|null`, `skills[]`, `subagents[]`, `prompts[]` (todos `FeatureRef{name, version, path|null}`), `settings{}`, `tags[]`.
- `EnvironmentSchema`: os, arch, nodeVersion, gitVersion|null, cliVersion|null, ncpu, totalMemBytes, benchVersion, isolation (`none|seatbelt|docker`).
- `LimitsSchema`: `timeoutSec=1200, maxSteps=60, maxTokens=2000000, inactivitySec=180`.
- `ExperimentSchema`: `id`, `scenarios[]` (ids), `configurations[]` (ids), `repetitions=5`, `seed=1`, `design` (`interleaved|blocked`), `limits`, `budget{maxCost (obligatorio), maxRuns|null, maxWallSec|null}`, `concurrency` (1..2, def 1), `alpha=0.05`.
- `TelemetrySchema`: `inputTokens, outputTokens, cachedTokens, reasoningTokens, totalTokens, llmCalls, peakContext, costUsd, toolCalls, commands, steps` (todos `number|null`), `filesRead/Modified/Created/Deleted` (`string[]|null`), `extra{}` (datos específicos del runner). Helpers: `emptyTelemetry()` (todo null), `maskTelemetry(t, caps)` (pone null lo no declarado).
- `EvaluatorResultSchema`: `kind`, `passed` (`boolean|null`), `score` (0..1|null), `testsPassed|null`, `testsTotal|null`, `violations[]`, `details`, `durationMs|null`.
- `RunResultSchema`: `runId, experimentId|null, scenarioId, configurationId, runner, provider|null, model|null, cliVersion|null, features{skills,subagents}, repetition, seed|null, startedAt, finishedAt (ISO), outcome, success (boolean|null), telemetry, durationMs, evaluators[], score{correctness,quality,efficiency (number|null)}, orphans (int|null), gitDiff|null, error|null, environment`.
  - `success` = `outcome==="completed"` Y evaluadores obligatorios pasan; `null` si no evaluable (infra_error/cancelled).

## Capabilities
`CapabilitiesSchema`: booleanos `tokens, cachedTokens, reasoningTokens, cost, llmCalls, peakContext, toolCalls, commands, fileAccessLists, steps, streaming, cancel`. `NO_CAPABILITIES` = todo false. Cada runner las declara en `probe()`; el motor aplica `maskTelemetry` y lo no declarado sale `null`.

## Interfaz AgentRunner (`src/core/schemas.ts`)
```ts
interface AgentRunner {
  readonly id: string;
  probe(): Promise<RunnerProbe>;                       // {available, version|null, capabilities, notes?}
  prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun>;
  run(prepared: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput>;
  collect(prepared: PreparedRun, raw: RawRunOutput): Promise<Collected>; // {telemetry, outcome}
  cleanup(prepared: PreparedRun): Promise<{ orphans: number }>;
}
interface RunContext { runId; runRoot; workspace; home; tmp; out; env: Record<string,string>; seed: number|null }
interface PreparedRun { ctx: RunContext; configuration: Configuration; state: Record<string, unknown> }
interface Task { scenarioId: string; prompt: string }
interface RawRunOutput { outcome: Outcome; exitCode: number|null; durationMs: number; artifacts: string[]; error: string|null; raw: Record<string, unknown> }
```
Reglas: `run` debe respetar `signal` (cancelar en <10 s sin huérfanos) y `limits`; `cleanup` devuelve el nº de procesos que sobrevivieron (debe ser 0); el runner nunca toca fuera de `ctx.workspace/home/tmp/out`; sin secretos en artefactos; determinista con la misma semilla (FakeRunner); `rate_limit` => `Outcome` `rate_limited`.
Ciclo del motor: aislar (runRoot `~/ab/r/<runId8>/{ws,home,tmp,eval,out}`) -> `prepare` -> `run` -> árbol del agente muerto -> inyectar tests ocultos -> evaluadores -> `collect` -> `cleanup` -> persistir `RunResult` -> borrar workspace.

## proc.ts
- `supervise(opts): Promise<SuperviseResult>`: spawn `detached` (líder de su grupo). Opciones: `cmd, args?, cwd?, env? (exacto; si se omite hereda process.env, pasa siempre un env explícito), stdin?, timeoutMs, inactivityMs?, signal?, graceMs=3000, maxOutputBytes=4MiB, onStdout?, onStderr?`. Resultado: `outcome (completed|timeout|hung|cancelled|spawn_error), exitCode, signal, stdout, stderr, truncated, durationMs, pid, orphans:number[], error?`. Siempre limpia el árbol al terminar (incluso nietos tras salir el líder) y verifica cero huérfanos; `orphans` debe ser `[]`.
- `killTree(rootPid, {graceMs=3000, verifyMs=2000, extraPids?})`: snapshot `ps -A -o pid=,ppid=,pgid=` antes de señalar (incluye descendientes que hicieron `setsid`), SIGTERM a grupo+pids, espera `graceMs`, SIGKILL a los vivos, verifica. Devuelve `{targeted, sigkilled, orphans}`.
- Utilidades: `snapshotProcs, parsePs, descendantsOf, isAlive (zombi = muerto), verifyNoOrphans(pids)`, `sleep`.

## redact.ts
`redactText(text, extraSecrets?)`, `redactEnv(env)` (por nombre de clave sensible), `redactDeep(value, extraSecrets?)` (no muta), `containsSecret(text)`, constante `REDACTED = "[REDACTED]"`. Detecta `sk-`, tokens GitHub/AWS/Slack, JWT, claves privadas PEM, `Bearer/Basic`, y asignaciones `api_key=`, `token:`, etc.

## ids.ts
`newRunId()` (UUID v4), `runId8(id)`, `canonicalJson`, `contentHash` (sha256), `deterministicId(...parts)` (16 hex), `seededRng(seed)` (mulberry32), `seededShuffle(items, seed)`.

## Estructura
`bin, src/{core,runners,evaluators,workspace,telemetry,store,stats,report,cli,isolation}, benchmarks/{node,onyx}, configurations/{opencode,codex}, experiments, results, docs, test`. Los tests unitarios van junto al código (`*.test.ts`); los de integración en `test/`.
