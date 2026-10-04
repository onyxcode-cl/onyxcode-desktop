# agent-bench

Banco de pruebas reproducible para agentes de coding (OpenCode, Codex y los que vengan). Mide con números, no con impresiones, si un cambio mejora o empeora a un agente.

## Para qué sirve
- ¿Un skill, un subagente o un cambio de prompt mejora el éxito? ¿Cuánto cuesta en tokens y tiempo?
- ¿Una modificación provoca regresiones?
- ¿Qué configuración da mejor relación calidad/estabilidad/consumo?
- ¿Dos agentes se comportan distinto ante el mismo problema?

Principios: el agente nunca decide si tuvo éxito (lo deciden evaluadores externos y tests ocultos); cada run parte de un estado limpio y aislado; los datos crudos se conservan (JSONL); lo que un CLI no informa es `null`, nunca 0; las conclusiones usan estadística con efecto mínimo práctico y admiten «SIN EVIDENCIA».

Vive fuera de OnyxCode y no se publica ni se hace push.

## Estado
Implementado y probado con `node --test` (sin modelos reales):
- Núcleo: esquemas zod, supervisor de procesos (mata el árbol, sin huérfanos), redactor de secretos.
- Aislamiento: directorio por run, entorno en lista blanca, perfil Seatbelt, puerta de carga y `doctor` (funciones en `src/isolation`).
- Workspace y evaluadores: tests visibles y ocultos, build/typecheck, git diff, restricciones, anti-trampa, y los evaluadores de la suite onyx.
- Runners: FakeRunner (determinista, con fallos inyectables) y OpenCodeRunner/CodexRunner probados solo con binarios simulados.
- Estadística: Wilson, bootstrap por clúster de caso, permutación sign-flip, Wilcoxon, McNemar, Holm/BH, pass^k, potencia Monte Carlo y regla de decisión.
- Informes: HTML autocontenido, Markdown, `analysis.json` y `claims.json` (`writeReport`).
- 18 casos Node/TS (L1 a L5 y ctx) y 17 casos onyx.

Pendiente: la CLI unificada (`src/cli` está vacío), el motor que ejecuta experimentos de punta a punta, el almacén JSONL + sqlite, y la sonda real y el piloto (requieren aprobación del dueño; ver `docs/PILOTO.md`). Los campos de OpenCode/Codex marcados NV en `docs/RUNNERS.md` no están confirmados con un binario real.

## Comandos que existen hoy
```sh
npm install                              # única dependencia runtime: zod
npm test                                 # node --test (src/**/*.test.ts y test/**/*.test.ts)
npm run typecheck                        # tsc --noEmit
node scripts/gen-fixtures/generate.mjs   # regenera benchmarks/node (determinista; --seed, --out, --only)
node scripts/validate-cases.mjs          # base falla, referencia pasa, tramposo detectado (--dir, --only, --keep)
```
Todo comando largo conviene lanzarlo con límite: `perl -e 'alarm shift; exec @ARGV' 300 npm test`. Requiere Node 22 (type stripping, sin build).

## Estructura
```
bin/ src/{core,runners,evaluators,evaluators-onyx,workspace,telemetry,store,stats,report,cli,isolation}
benchmarks/{node,onyx}  configurations/{opencode,codex}  experiments/  results/  docs/  test/  scripts/
```
- `docs/GUIA.md` definir Test Case, Configuration y Experiment.
- `docs/ESTADISTICA.md` qué mide cada prueba y cuántas repeticiones hacen falta.
- `docs/SEGURIDAD.md` aislamiento, límites y términos de uso.
- `docs/PILOTO.md` checklist de la sonda real y el piloto.
- `docs/CONTRATOS.md`, `docs/RUNNERS.md`, `docs/INTEGRACION.md` contratos e integración (de otros autores).

## Ejemplo: experimento A/B con el runner falso
1. Dos configuraciones que solo difieren en el skill (`fake-base` y `fake-skill-v1`) y un experimento que las cruza con 3 casos y 5 repeticiones: son los JSON de `docs/GUIA.md`, validados contra `schemas.ts`.
2. El FakeRunner ejecuta un guion JSON (eventos, tokens, parche, retardos, fallos `rate_limit|hang|crash|orphan`, semilla; ver `src/runners/fake/script.ts`) sin tocar ningún modelo.
3. Con los `RunRow` resultantes se compara base contra candidata (código real, con datos sintéticos):

```ts
import { compareConfigs } from "./src/stats/index.ts";
import type { RunRow } from "./src/stats/index.ts";

const rows: RunRow[] = [];
for (const caseId of ["c1", "c2", "c3", "c4", "c5", "c6"]) {
  for (let rep = 0; rep < 5; rep++) {
    rows.push({ caseId, configId: "base",  success: rep < 2, tokens: 10000, durationMs: 60000, outcome: "completed", rep });
    rows.push({ caseId, configId: "skill", success: rep < 4, tokens: 9000,  durationMs: 55000, outcome: "completed", rep });
  }
}
const c = compareConfigs(rows, "base", "skill", { seed: 1, B: 500 });
console.log(c.itt.overall); // "MEJORA"
```
Guárdalo como `ab.ts` y ejecútalo con `node ab.ts`. `writeReport(runs, dir)` (`src/report`) genera el informe completo a partir de `RunResult[]`. Cuando exista la CLI, este flujo será un solo comando; hoy no hay comando `run`.
