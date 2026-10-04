# Demo de punta a punta (solo runner fake)

Todo lo de abajo se ejecutó de verdad con el CLI, el motor y el almacén reales, y con el **runner simulado** (`fake`): sin modelos, sin red de proveedores y sin coste. El FakeRunner reproduce un guion y, con `settings.solveRate`, "resuelve" el caso aplicando el parche de referencia con probabilidad determinista por semilla. Por eso las tasas de éxito de abajo son sintéticas: demuestran la mecánica (orden, ejecución aislada, evaluadores con tests ocultos, almacén, estadística, informes), no la calidad de ningún agente.

Experimento: `experiments/demo-fake.json` = 2 configuraciones (`fake-baseline` con `solveRate` 0.5 y `fake-variant-a` con 0.85) x 6 casos Node (L1 y L2) x 3 repeticiones = 36 runs, `--max-cost 0`, semilla 7, diseño intercalado.

```sh
node bin/agent-bench plan demo-fake --dry-run
node bin/agent-bench run demo-fake --max-cost 0 --dry-run
node bin/agent-bench run demo-fake --max-cost 0
node bin/agent-bench compare demo-fake
node bin/agent-bench report demo-fake
node bin/agent-bench report demo-fake --verify-claim rate.fake-variant-a
```

## plan / run --dry-run
```
Experimento demo-fake: 6 casos x 2 configuraciones x 3 repeticiones = 36 runs
Diseño interleaved, semilla 7, concurrencia 1, tope por run 120s
Presupuesto: coste <= 0 USD, runs <= 40, tiempo <= 4500s
Runners: fake
Estimación: 60000 tokens/run (supuesto), ~120 s/run, tiempo total ~4320 s, coste 0.00 USD
Orden (primeros 20 de 36):
     1. node-l2-001-cart-total  fake-variant-a  rep 2
     2. node-l2-001-cart-total  fake-baseline  rep 2
     3. node-l2-002-emitter  fake-baseline  rep 2
     ...
```
(La estimación de tiempo usa el supuesto por defecto de 120 s/run; el fake tarda unos 0,7 s por run.)

## run (real, con fake)
36 runs en unos 25 s, uno a la vez, cada uno en su `~/ab/r/<id>/` borrado al terminar:
```
Terminado (completado): 36/36 runs (0 reanudados, 0 pendientes), 19 con éxito, coste n/d (el runner no lo informa), huérfanos 0.
Resultados: results/demo-fake
```
Volver a lanzar el mismo comando no ejecuta nada: reanuda y omite los 36 runs ya hechos.

## compare
```
Experimento demo-fake: 36 runs, 6 casos, 2 configuraciones
  fake-baseline     éxito   38.9%  tokens(med) 14094  duración(med) 151 ms  [base]
  fake-variant-a    éxito   66.7%  tokens(med) 10251  duración(med) 150 ms
Veredictos:
  fake-variant-a frente a fake-baseline: ITT MEJORA, PP MEJORA
  aviso: Baja potencia (ITT, success): efecto mínimo detectable 0.238 mayor que el efecto práctico mínimo 0.050; un resultado nulo no prueba equivalencia.
  aviso: Potencia estimada 1 % para detectar 5 pp de éxito con 6 casos x 3 repeticiones (objetivo 80 %).
```
Los avisos de potencia son honestos: con 6 casos x 3 repeticiones solo se detectan diferencias grandes (ver `docs/ESTADISTICA.md`).

## report y --verify-claim
`report` escribe `results/demo-fake/report/{analysis.json,claims.json,report.html,report.md}`. `--verify-claim` recomputa el análisis desde los runs del almacén y compara el valor y el hash de datos:
```
Reproducible: 1 afirmación(es) recomputadas desde 36 runs.
  ok      rate.fake-variant-a = 0.6666666666666666  (Tasa de éxito (ITT) de fake-variant-a: 12/18)
```
Con una afirmación adulterada en `claims.json` el comando sale con código 1 y muestra `rate.fake-variant-a: 0.9 != 0.6666...` (cubierto por `test/cli/cli.test.ts`).

## Comprobaciones al terminar
`pgrep` sin procesos propios, `~/ab/r` vacío (el motor borra cada workspace), código de salida 0.
