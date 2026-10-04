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
Depende de la tasa base, el efecto y el número de casos. Potencia estimada con `estimatePower` (tasa base 60 %, casos heterogéneos, 1000 simulaciones, semilla 1, α = 0,05):

| Casos | Repeticiones | Mejora real | Potencia |
|---|---|---|---|
| 20 | 5 | 5 pp | 0,08 |
| 20 | 5 | 10 pp | 0,29 |
| 20 | 5 | 20 pp | 0,76 |
| 20 | 10 | 10 pp | 0,53 |
| 20 | 10 | 20 pp | 0,98 |
| 20 | 20 | 10 pp | 0,85 |
| 40 | 5 | 10 pp | 0,57 |
| 40 | 5 | 15 pp | 0,87 |

Lectura práctica: con 20 casos y 5 repeticiones solo se detectan mejoras grandes (cercanas a 20 pp). Para efectos de 5 a 10 pp hacen falta muchos más casos o repeticiones. Añadir casos ayuda más que repetir mucho los mismos, porque el caso es la unidad de análisis; repetir sirve sobre todo para medir estabilidad.

## Advertencia de potencia
Un piloto con 5 repeticiones sirve para comprobar que el banco funciona y medir varianza y coste, NO para concluir que A es mejor que B. Un resultado «sin diferencia» de un experimento con poca potencia es SIN EVIDENCIA, no EQUIVALENTE. Antes de gastar presupuesto, estima la potencia del diseño (`estimatePower`, `minimumDetectableEffect` en `src/stats/power.ts`) y decide si el experimento puede responder la pregunta.
