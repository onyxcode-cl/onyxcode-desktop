# Integración

## Hecho
- `npm run typecheck` (tsc --noEmit, tsconfig estricto): 0 errores en core, isolation, workspace, evaluators, evaluators-onyx, runners, telemetry, stats y tests.
- Tipos unificados con `src/core/schemas.ts`:
  - `Outcome` (runners/base, stats `RunOutcome`) se re-exporta desde core.
  - `toCoreEvaluatorResult()` (`src/evaluators/adapt.ts`) mapea el resultado local (details como objeto) al `EvaluatorResult` zod. `kind` = id del evaluador. No aplica o error de infra => `passed`/`score` = null.
  - `runResultToRow()` / `runResultsToRows()` (`src/stats/adapt.ts`): `RunResult` -> `RunRow`. Tokens = `totalTokens`, o input+output si ambos existen, si no null.
- `tests-visible`: con `EvalContext.baseCommit` ejecuta en una copia del workspace con los tests visibles del commit base restaurados (editados o borrados por el agente); `details.tamperedTests` lista los alterados. El workspace no se modifica.
- `killTreeAndSignal(pid, signal)` / `signalIfNoOrphans(signal, pids)` en `src/workspace/treedead.ts`: emiten `TreeDeadSignal` solo si `verifyNoOrphans` da cero.

## Para el engine (no tocado aquí)
1. Pasar `baseCommit` (de `createWorkspace`) en `EvalContext` a los evaluadores; sin él, tests-visible corre sobre el workspace tal cual.
2. Tras terminar el agente: `killTreeAndSignal(pid, signal, { extraPids })` (o `signalIfNoOrphans(signal, res.pids)` si `supervise` ya limpió) y solo entonces `createEvalCopy`. Si `dead === false`, marcar el run `infra_error` con los huérfanos y no inyectar ocultos.
3. Convertir cada resultado con `toCoreEvaluatorResult` antes de construir `RunResult`; `RunResult.orphans` debe salir de `EnsureTreeDeadResult.orphans.length`.
4. El store/report deben usar `runResultToRow` para alimentar `src/stats`.

## Prueba intermitente de aislamiento
`test/isolation` ("sandbox": esperaba código 0, recibió null) no se reproduce sola (12/12) ni en 3 corridas completas. `code === null` sin timeout = hijo matado por señal externa, típico de un `pkill -f`/`killall` de otro proceso de la máquina (otros agentes en paralelo). Mitigación: el test reintenta hasta 2 veces cuando `code === null && !timedOut` (un fallo real del perfil da código != null y no se reintenta) y el mensaje de fallo ahora incluye señal y stderr. Regla: no usar `pkill -f` con patrones amplios (`node`, `agent-bench`); matar por pid o por la ruta única del run.
