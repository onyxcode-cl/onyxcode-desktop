# Estadística

Código en `src/stats`, en TypeScript puro y validado con valores de referencia (Wilson 5/10 da [0,2366; 0,7634]; McNemar b=1, c=8 da p=0,0390625; Holm de [0,01; 0,04; 0,03; 0,005] da [0,03; 0,06; 0,06; 0,02]).

## Unidad de análisis
El caso, no el run. Las repeticiones de un mismo caso no son independientes (un caso difícil es difícil siempre). Por eso la inferencia agrupa por caso y la comparación es pareada: la misma lista de casos corre en A y en B.

## Qué mide cada prueba
- **Wilson**: intervalo de una proporción (tasa de éxito). Descriptivo: asume runs independientes.
- **Bootstrap por clúster de caso**: intervalo de la tasa y de las diferencias remuestreando casos. Es el intervalo inferencial.
- **Permutación sign-flip**: p-valor de la diferencia pareada por caso, invirtiendo signos al azar. No supone normalidad.
- **Wilcoxon**: alternativa por rangos para tokens y duración.
- **McNemar**: pares discordantes (caso resuelto solo por A frente a solo por B) cuando hay un run por caso y configuración.
- **Holm / BH**: corrección por comparaciones múltiples (éxito, tokens, duración). Se reporta el p ajustado.
- **pass^k**: probabilidad de que k runs seguidos del mismo caso pasen; mide fiabilidad, no solo promedio.
- **Estabilidad**: por caso, «siempre», «nunca» o «a veces» pasa; más media geométrica y coeficiente de variación de tokens y duración. La dispersión importa tanto como el promedio.
- **Potencia Monte Carlo**: simula el diseño observado para estimar la probabilidad de detectar un efecto dado (tope duro: 5000 simulaciones y 120 s).

## Dos políticas de análisis
- **ITT** (por defecto de lectura prudente): cuenta todos los runs.
- **PP**: excluye `infra_error`, `rate_limited`, `cancelled` y éxitos sin evaluar (no son culpa de la configuración).
Si ITT y PP dan veredicto distinto, el informe lo marca (`policiesDisagree`): la conclusión depende de fallos de infraestructura.

## Regla de decisión (efecto mínimo práctico, MPE)
No basta con p < 0,05: se compara el intervalo de confianza de la ganancia con un margen de efecto práctico. Márgenes por defecto: éxito 5 puntos porcentuales, tokens 10 %, duración 15 %. Para cada métrica:

| Veredicto | Cuándo |
|---|---|
| MEJORA | todo el IC supera el MPE a favor |
| PEOR-REGRESIÓN | todo el IC supera el MPE en contra |
| EQUIVALENTE | el IC cae dentro de ±MPE |
| MEJORA MENOR | el IC excluye 0 a favor, pero no se descarta un efecto menor que el MPE |
| SIN EVIDENCIA | el IC es demasiado ancho para concluir |

Veredicto global: cualquier PEOR-REGRESIÓN manda; si el éxito está en SIN EVIDENCIA el global también (no se afirma nada sin saber la calidad); si no, MEJORA > MEJORA MENOR > EQUIVALENTE. Tokens y duración en SIN EVIDENCIA no cuentan a favor. El score compuesto está desactivado por defecto y nunca oculta las regresiones.

## Qué significa «SIN EVIDENCIA»
No significa «no hay efecto» ni «da igual». Significa que con estos datos no se puede afirmar nada: el intervalo es tan ancho que cabe tanto una mejora como una regresión relevante. La respuesta correcta es más repeticiones o más casos, no elegir el que «parece» mejor. El informe añade el efecto mínimo detectable (MDE) frente al MPE y avisa si el experimento no podía detectar un efecto del tamaño del MPE.

## Cuántas repeticiones hacen falta
Depende de la tasa base, el efecto y el número de casos. Potencia de declarar **MEJORA** con la regla actual (límite inferior del IC bootstrap por caso > MPE de éxito, no solo IC > 0), calculada con `estimatePower` real: tasa base 60 %, concentración Beta 2 (casos muy heterogéneos), `rule: "mpe"`, `margin` 0,05, `minCases` 10, α = 0,05, 199 remuestreos bootstrap por simulación, **1000 simulaciones, semilla 1** (sin truncar por tiempo; tope duro 5000 sims y 120 s). Reproducible con `estimatePower({nCases, reps, baseRate: 0.6, delta, alpha: 0.05, rule: "mpe", margin: 0.05, minCases: 10}, {seed: 1, sims: 1000})`. «Efecto simulado» es la mejora media realmente aplicada: con tasa base 60 % y casos heterogéneos, pB se recorta a 1 y el efecto real es menor que el pedido (en la tabla se muestra).

| Casos | Repeticiones | Mejora pedida | Efecto simulado | Potencia |
|---|---|---|---|---|
| 20 | 5 | 5 pp | 4,7 pp | 0,04 |
| 20 | 5 | 10 pp | 9,0 pp | 0,13 |
| 20 | 5 | 20 pp | 16,4 pp | 0,61 |
| 20 | 10 | 10 pp | 8,9 pp | 0,18 |
| 20 | 10 | 20 pp | 16,4 pp | 0,85 |
| 20 | 20 | 10 pp | 9,0 pp | 0,31 |
| 40 | 5 | 10 pp | 9,0 pp | 0,20 |
| 40 | 5 | 15 pp | 12,9 pp | 0,57 |
| 40 | 5 | 20 pp | 16,4 pp | 0,87 |
| 40 | 10 | 10 pp | 9,0 pp | 0,33 |
| 80 | 5 | 10 pp | 9,0 pp | 0,32 |

(La tabla anterior usaba solo IC > 0 y sobrestimaba: p. ej. 20 casos x 5 reps y 10 pp daba 0,29 y ahora 0,13.)

Lectura práctica: con la regla real, 20 casos y 5 repeticiones solo declaran MEJORA con efectos de ~20 pp (potencia 0,61); para 5 a 10 pp ni 80 casos x 5 reps llegan a 0,35, y declarar MEJORA exige un efecto claramente mayor que el MPE. Añadir casos ayuda más que repetir mucho los mismos, porque el caso es la unidad de análisis; repetir sirve sobre todo para medir estabilidad.

## Advertencia de potencia
Un piloto con 5 repeticiones sirve para comprobar que el banco funciona y medir varianza y coste, NO para concluir que A es mejor que B. Un resultado «sin diferencia» de un experimento con poca potencia es SIN EVIDENCIA, no EQUIVALENTE. Con la regla actual (IC inferior > MPE) un piloto de 20 casos x 5 repeticiones tiene potencia ~0,13 para una mejora real de 10 pp: casi nunca declarará MEJORA aunque exista. Antes de gastar presupuesto, estima la potencia del diseño (`estimatePower`, `minimumDetectableEffect` en `src/stats/power.ts`) y decide si el experimento puede responder la pregunta.

## Cambios tras la auditoría
Cambios en `src/stats` y `src/report` (los valores de referencia Wilson 5/10, McNemar b=1 c=8 y Holm siguen pasando).

- **Mínimo de casos y IC degenerado (A8).** Con menos de `minCases` casos pareados (por defecto 10, opción `minCases`) el veredicto es SIN EVIDENCIA y `powered=false`; el informe lo avisa. Si todas las diferencias por caso son iguales (p. ej. techo 100 %/100 %) el bootstrap daba un IC de ancho 0 y un EQUIVALENTE falso: ahora se usa como suelo el error estándar intra-caso (Bernoulli suavizada para éxito, varianza muestral de ln para tokens/duración) y, si sigue siendo 0, `decideMetric` devuelve SIN EVIDENCIA. Las comparaciones con IC válido no cambian.
- **Duplicados (A9).** Antes de analizar se deduplica por (caso, config, repetición) quedándose con el último intento (`finishedAt`, luego `startedAt`, luego `runId`). `analysis.json` registra `data.runsRaw` y `data.duplicatesDiscarded`, y hay un aviso. El `dataHash` se calcula sobre la entrada completa.
- **Coste (M1).** Tokens, duración y coste en USD excluyen siempre `infra_error`, `cancelled` y `rate_limited`, también en ITT: su duración es de arranque o espera, no del agente. ITT solo cambia el tratamiento del éxito (esos runs cuentan como fallo).
- **Holm en los veredictos (M2).** Los p sign-flip de las métricas presentes (éxito, tokens, duración) se ajustan con Holm (`pSignFlipHolm`). Una MEJORA o MEJORA MENOR cuyo p ajustado no es <= alpha se degrada a SIN EVIDENCIA (`holmDowngraded`, con aviso). Las regresiones nunca se suavizan. No hay corrección entre candidatos: con más de un candidato el informe avisa.
- **Potencia (M3).** `estimatePower` simula la regla real de MEJORA: límite inferior del IC bootstrap por caso > MPE (`rule: "mpe"`, por defecto; `rule: "zero"` = IC > 0), con el mínimo de casos. Esto es más estricto que el antiguo sign-flip contra 0, por eso la tabla de arriba se regeneró con la regla `mpe` (la versión anterior usaba la regla antigua y sobrestimaba). El recorte de pB a 1 se mide: `effectiveDelta` y `deltaClipped` avisan cuando el efecto simulado es menor que el pedido. El informe da la potencia de declarar MEJORA para una mejora real de 2 x MPE y, aparte, la de excluir 0 para una mejora igual al MPE; también avisa si acota la tasa base a [5 %, 95 %].
- **Márgenes log (M4).** Para tokens y duración la mejora exige reducir al menos `-ln(1-mpe)` (antes `ln(1+mpe)`: una bajada del 9,1 % contaba como 10 %); la regresión usa `ln(1+mpe)`. Nuevo veredicto **POSIBLE-REGRESIÓN**: el IC excluye 0 en contra pero no supera el MPE (espejo de MEJORA MENOR; antes caía en EQUIVALENTE o SIN EVIDENCIA). `decideOverall`: éxito en POSIBLE-REGRESIÓN gana a cualquier mejora de coste; una POSIBLE-REGRESIÓN de coste sin mejora de éxito también da POSIBLE-REGRESIÓN, y la MEJORA de coste solo se declara con éxito al menos EQUIVALENTE.
- **Menores.** McNemar por caso excluye los empates exactos (tasa 0.5) y los cuenta en `ties`. `holm` y `benjaminiHochberg` ignoran NaN (devuelven NaN en esa posición y no cuentan en m). `normCdf` usa fracción continua en colas (|x| >= 3) con precisión relativa y ya no devuelve 0 para x < -8; nueva `normSf`. Los comandos de `claims.json` usan `node bin/agent-bench report --input ... --verify-claim ID` (sin `.ts`), y si `minCases` no es el de por defecto añaden `--min-cases N`.
