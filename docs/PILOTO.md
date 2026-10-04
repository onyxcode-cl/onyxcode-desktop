# Procedimiento: sonda real y piloto

Este documento es un procedimiento. NO se ejecuta automáticamente ni lo ejecuta un agente: cada fase real requiere **aprobación explícita del dueño** (el gasto sale de su suscripción).

## Fase 0: antes de pedir aprobación (sin modelos, sin red de proveedores)
- [ ] `npm test` y `npm run typecheck` en verde.
- [ ] `node scripts/validate-cases.mjs` en verde (base falla, referencia pasa, tramposo detectado).
- [ ] `doctor()` (`src/isolation/doctor.ts`) sin `fail`: node >= 22, git, opencode, disco, sandbox.
- [ ] `pgrep -fl "opencode|node.*agent-bench"` vacío; carga de CPU baja; sin otras cargas pesadas.
- [ ] Existen y funcionan los topes de la CLI/motor (hoy pendientes; sin ellos no se pasa a fase real).
- [ ] Términos de uso de OpenCode Go leídos y la automatización confirmada como permitida (ver `docs/SEGURIDAD.md`).
- [ ] Credencial entregada por el dueño solo por entorno (`OPENCODE_AUTH_CONTENT`), nunca escrita en disco ni en el repo.

## Fase 1: sonda real barata (aprobación del dueño)
Objetivo: confirmar los campos NV de `docs/RUNNERS.md` (eventos SSE, tokens y coste, mensajes de rate limit, esquema sqlite, diff, nombres de herramientas, claves de config), no medir calidad.
Topes sugeridos:
- [ ] 1 caso (el más simple, L1), 1 repetición, 1 configuración, concurrencia 1.
- [ ] `maxCost` pequeño y fijo acordado con el dueño; tiempo 5 min; pasos 20; tokens 200 000.
- [ ] Modelo barato. Sin webfetch ni websearch.
- [ ] Alguien presente durante la ejecución; Ctrl+C debe dejar 0 procesos.
Después:
- [ ] Contrastar cada campo NV con lo observado y corregir `extract.ts`, `config.ts`, `sqlite.ts`.
- [ ] Actualizar los tests de runners con las formas reales y marcar los NV confirmados en `docs/RUNNERS.md`.
- [ ] `pgrep -fl "opencode|node.*agent-bench"` vacío; revisar que ningún artefacto contenga secretos (`containsSecret`).
- [ ] Informar al dueño: coste real, tokens, duración, rate limits vistos.

## Fase 2: piloto (aprobación del dueño, separada de la fase 1)
Objetivo: comprobar que el banco funciona de punta a punta, medir varianza y coste real. NO sirve para concluir que una configuración es mejor (ver advertencia de potencia en `docs/ESTADISTICA.md`).
Topes por defecto:
- [ ] 5 repeticiones, 2 configuraciones (base y candidata), pocos casos (p. ej. 3 a 6, mezcla de dificultades).
- [ ] Diseño `interleaved`, semilla fija registrada, concurrencia 1.
- [ ] `maxCost`, `maxRuns` (muy por debajo de 100/día) y `maxWallSec` fijados con el dueño antes de empezar.
- [ ] Por run: 20 min, 60 pasos, 2 000 000 tokens, 180 s de inactividad.
- [ ] Reintentos de `rate_limited` máx. 3; si se repiten, parar y avisar.
- [ ] Puerta de carga activa (pausa a carga/CPU > 0,6 o poca memoria).
Durante:
- [ ] Vigilar el gasto acumulado frente al tope; abortar con SIGINT si se desvía.
Después:
- [ ] Generar el informe (`writeReport`) y leer ITT y PP; anotar los «SIN EVIDENCIA» como tales.
- [ ] Comprobar tasa de `infra_error` y huérfanos (debe ser 0).
- [ ] Usar la varianza observada para estimar potencia y el número de repeticiones/casos del experimento real.
- [ ] Borrar `~/ab/r/*` restantes y revisar `results/` antes de compartir nada.

## Criterio de parada
Se detiene todo si: se alcanza el tope de coste, aparecen procesos huérfanos, hay credenciales en artefactos, el proveedor devuelve rate limit repetido, o el dueño lo pide.
