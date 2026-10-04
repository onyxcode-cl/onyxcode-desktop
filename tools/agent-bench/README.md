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

CLI unificada (`bin/agent-bench`), motor de experimentos (planificador intercalado por semilla, presupuestos, reintentos, reanudación, load gate, apagado limpio) y almacén JSONL + índice sqlite: cableados de punta a punta con el runner fake (ver `docs/DEMO.md`).

Pendiente: la sonda real y el piloto con OpenCode/Codex (requieren aprobación del dueño; ver `docs/PILOTO.md`). Los campos de OpenCode/Codex marcados NV en `docs/RUNNERS.md` no están confirmados con un binario real.

## Comandos
```sh
npm install                              # única dependencia runtime: zod
npm test                                 # node --test (src/**/*.test.ts y test/**/*.test.ts)
npm run typecheck                        # tsc --noEmit
node scripts/gen-fixtures/generate.mjs   # regenera benchmarks/node (determinista; --seed, --out, --only)

node bin/agent-bench doctor                                   # entorno: node, git, opencode, disco, sandbox
node bin/agent-bench validate-cases                           # base falla, referencia pasa, tramposo detectado
node bin/agent-bench list [scenarios|configurations|experiments|runs [EXP]]
node bin/agent-bench power --cases 6 --reps 3                 # efecto mínimo detectable (Monte Carlo acotado)
node bin/agent-bench plan demo-fake --dry-run                 # orden de runs y estimación; no ejecuta nada
node bin/agent-bench run demo-fake --max-cost 0               # ejecuta (fake); --dry-run, --max-runs, --max-wall, --max-concurrency 1|2
node bin/agent-bench compare demo-fake [--baseline CONFIG]    # tabla y veredictos en pantalla
node bin/agent-bench report demo-fake                         # analysis.json, claims.json, report.html, report.md
node bin/agent-bench report demo-fake --verify-claim ID|all   # recomputa y comprueba una afirmación (0 = reproducible)
node bin/agent-bench clean --dry-run                          # limpia ~/ab/r y ~/ab/validate (solo lo propio)
```
`--json` en todos. Códigos de salida: 0 ok, 1 fallo, 2 uso, 3 rechazado por seguridad, 4 datos no encontrados/inválidos, 130 interrumpido. `run` exige `--max-cost` (USD; 0 con fake). Los runners reales (`opencode`, `codex`) solo se registran con `--allow-real-runner` **y** `AGENT_BENCH_CONFIRM_REAL=yes`, y con el aislamiento del entorno en orden (`doctor`); las configuraciones de `configurations/opencode` y `configurations/codex` son plantillas sin credenciales: no las ejecutes sin aprobación (`docs/PILOTO.md`). Los resultados quedan en `results/<experimento>/` (ignorado por git).
Todo comando largo conviene lanzarlo con límite: `perl -e 'alarm shift; exec @ARGV' 300 npm test`. Requiere Node 22 (type stripping, sin build).

## Estructura
```
bin/ src/{core,runners,evaluators,evaluators-onyx,workspace,telemetry,store,stats,report,cli,isolation}
benchmarks/{node,onyx}  configurations/{fake,opencode,codex}  experiments/  results/  docs/  test/  scripts/
```
- `docs/DEMO.md` ejecución real de punta a punta con el runner fake.
- `docs/GUIA.md` definir Test Case, Configuration y Experiment.
- `docs/ESTADISTICA.md` qué mide cada prueba y cuántas repeticiones hacen falta.
- `docs/SEGURIDAD.md` aislamiento, límites y términos de uso.
- `docs/PILOTO.md` checklist de la sonda real y el piloto.
- `docs/CONTRATOS.md`, `docs/RUNNERS.md`, `docs/INTEGRACION.md` contratos e integración (de otros autores).

## Ejemplo: experimento A/B con el runner falso
`configurations/fake/{baseline,variant-a}.json` solo difieren en el guion y en `solveRate`; `experiments/demo-fake.json` las cruza con 6 casos y 3 repeticiones. Los cuatro comandos `plan`, `run`, `compare` y `report` de arriba lo ejecutan completo (salida real en `docs/DEMO.md`). El FakeRunner ejecuta un guion JSON (eventos, tokens, parche, retardos, fallos `rate_limit|hang|crash|orphan`, semilla; ver `src/runners/fake/script.ts`) sin tocar ningún modelo.
