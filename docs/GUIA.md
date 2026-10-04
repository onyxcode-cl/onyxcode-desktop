# Guía: Test Case, Configuration y Experiment

Todo se describe con JSON validado por `src/core/schemas.ts` (zod). Todo esquema lleva `"schemaVersion": "1"`. Regla de oro: un dato desconocido es `null`, nunca `0`.

Las tres piezas son independientes: el **Test Case** dice qué problema, la **Configuration** dice quién lo resuelve y con qué, y el **Experiment** dice cuáles combinar, cuántas veces y con qué presupuesto. Para comparar A contra B se cambia SOLO la Configuration.

## 1. Test Case (`ScenarioSchema`)

```json scenario
{
  "schemaVersion": "1",
  "id": "node-l1-001-paginate",
  "description": "pageSlice devuelve la página equivocada (las páginas empiezan en 1).",
  "category": "node",
  "difficulty": "L1",
  "fixture": { "path": "benchmarks/node/node-l1-001-paginate/repo", "commit": null },
  "task": "pageSlice(items, page, size) en src/paginate.ts devuelve la página equivocada. Arréglalo sin tocar los tests.",
  "constraints": {
    "allowedPaths": ["src/**"],
    "forbiddenPaths": ["test/**", "package.json"],
    "maxChangedFiles": 3
  },
  "evaluators": [
    { "kind": "tests-visible", "command": ["node", "--test", "test/**/*.test.ts"], "timeoutSec": 60 },
    { "kind": "tests-hidden", "command": ["node", "--test", "test-hidden/**/*.test.ts"], "timeoutSec": 60 },
    { "kind": "restrictions" },
    { "kind": "anti-cheat", "params": { "protectedPaths": ["test/**", "package.json"] } }
  ],
  "hiddenTests": "benchmarks/node/node-l1-001-paginate/hidden",
  "referencePatch": "benchmarks/node/node-l1-001-paginate/reference.patch",
  "cheatPatch": "benchmarks/node/node-l1-001-paginate/cheat.patch",
  "metadata": { "seed": 20260101 }
}
```

Campos clave:
- `id`: minúsculas, dígitos, `.`, `_`, `-`.
- `difficulty`: `L1` (atómico), `L2` (local), `L3` (repositorio), `L4` (ambiguo), `L5` (adversarial) o `ctx` (eficiencia de contexto).
- `fixture.path`: carpeta del repo base, relativa al banco. `commit` es `null` si no aplica.
- `constraints`: globs permitidos/prohibidos y tope de archivos cambiados; vacío = sin restricción.
- `evaluators` (mínimo 1): `kind` es uno de `tests-visible, tests-hidden, build, typecheck, git_diff, restrictions, anti-cheat, trace_rules, fs_diff, canary, escalation, lang, plan_order`. `timeoutSec` por defecto 120, `weight` 1, `params` libre.
- `hiddenTests`: se inyectan solo después de que muera el árbol de procesos del agente, para que no pueda optimizar contra ellos.
- `referencePatch` y `cheatPatch`: sirven para validar el caso (la referencia debe pasar, el parche tramposo debe ser detectado, la base debe fallar).

Nota: los casos ya generados en `benchmarks/node/*/case.json` y `benchmarks/onyx/cases/*` usan el formato en disco de sus generadores (por ejemplo `evaluators[].type`, `files.allowed`); el adaptador de `src/evaluators/adapt.ts` los traduce a los tipos del núcleo. Para escribir casos nuevos a mano, usa el formato de arriba.

Los casos Node se regeneran con `node scripts/gen-fixtures/generate.mjs` y se validan con `node scripts/validate-cases.mjs` (acepta `--dir`, `--only ID`, `--keep`; trabaja en `~/ab/validate/<pid>/` y lo borra).

## 2. Configuration (`ConfigurationSchema`)

Describe por completo el sistema bajo prueba. Ejemplo base (sin skill) y variante (con skill versionado); solo difiere `skills`:

```json configuration
{
  "schemaVersion": "1",
  "id": "fake-base",
  "name": "Fake sin skill",
  "runner": "fake",
  "provider": null,
  "model": "fake-model",
  "skills": [],
  "subagents": [],
  "prompts": [],
  "settings": {},
  "tags": ["baseline"]
}
```

```json configuration
{
  "schemaVersion": "1",
  "id": "fake-skill-v1",
  "name": "Fake con skill-dotnet v1",
  "runner": "fake",
  "provider": null,
  "model": "fake-model",
  "skills": [{ "name": "skill-dotnet", "version": "v1", "path": "configurations/skills/skill-dotnet-v1" }],
  "subagents": [],
  "prompts": [{ "name": "agents/chat.md", "version": "2026-10-03", "path": null }],
  "settings": { "reasoning": "medium" },
  "tags": ["candidata"]
}
```

- `runner`: `"fake"`, `"opencode"` o `"codex"`. `provider` y `model` pueden ser `null`.
- `skills`, `subagents`, `prompts`: listas de `{ name, version, path|null }`. Versionar permite comparar v1/v2/v3.
- `settings`: ajustes libres (razonamiento, permisos). No inventes claves: cada runner solo lee las que documenta `docs/RUNNERS.md`.

## 3. Experiment (`ExperimentSchema`)

```json experiment
{
  "schemaVersion": "1",
  "id": "ab-fake-skill-v1",
  "description": "A/B con el runner falso: base contra skill v1.",
  "scenarios": ["node-l1-001-paginate", "node-l1-002-leap-year", "node-l1-003-slugify"],
  "configurations": ["fake-base", "fake-skill-v1"],
  "repetitions": 5,
  "seed": 1,
  "design": "interleaved",
  "limits": { "timeoutSec": 1200, "maxSteps": 60, "maxTokens": 2000000, "inactivitySec": 180 },
  "budget": { "maxCost": 0, "maxRuns": 30, "maxWallSec": 3600 },
  "concurrency": 1,
  "alpha": 0.05
}
```

- `scenarios` y `configurations` son ids; el experimento NO repite las definiciones.
- `repetitions` por defecto 5. Mira `docs/ESTADISTICA.md` para saber cuántas necesitas.
- `design`: `interleaved` (por defecto) mezcla las configuraciones en orden aleatorio por semilla, para que la deriva del proveedor afecte a todas por igual; `blocked` las agrupa.
- `limits` (por run): 1200 s, 60 pasos, 2 000 000 tokens y 180 s sin actividad por defecto.
- `budget.maxCost` es **obligatorio** (USD; `0` con el runner falso). `maxRuns` y `maxWallSec` son opcionales (`null`).
- `concurrency`: 1 o 2 (máximo 2). `alpha` por defecto 0,05.

## Verificar tus JSON

Cada bloque de esta guía se comprobó contra `schemas.ts`. Para los tuyos:

```sh
node --input-type=module -e "
import { ScenarioSchema } from './src/core/schemas.ts';
import { readFileSync } from 'node:fs';
console.log(ScenarioSchema.parse(JSON.parse(readFileSync(process.argv[1], 'utf8'))).id);
" ruta/al/caso.json
```

(Cambia `ScenarioSchema` por `ConfigurationSchema` o `ExperimentSchema` según el caso.) Si falta un campo o sobra un valor, zod muestra la ruta exacta del error.
