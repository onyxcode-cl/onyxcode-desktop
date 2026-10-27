# Diagnóstico: motor final Ola 7 contra el control (n=3 el nuevo, n=5 el control)

Veredicto corto: **no hay regresión real de éxito; sí un aumento leve de tokens que no se puede separar del ruido con n=3; los flujos no se pudieron evaluar porque el modelo no los usa.**

## 1. ¿Hay regresión?
- Éxito: 81/86 contra 134/140 del control. Los 5 fallos: T28 ×3 (el control también 0/5) y T05 ×2.
- **T05 (1/3 contra 5/5) es un fallo del verificador, no del motor.** Se repitió T05 (n=3 más, con carpetas conservadas): en la corrida fallida que se pudo leer el modelo escribió «agotamiento del pool … sin disponibilidad» (sin citar `ERR_POOL_AGOTADO`) y el verificador solo acepta `agotad|exhaust|lleno|sin conexiones` («agotamiento» no contiene «agotad»); la causa escrita es correcta. Total T05 sin variables: 3/6; con sanitizador 2/3. El control tuvo suerte con las palabras. Arreglo propuesto del banco (no aplicado para no cambiar la vara): aceptar `agotad|agotamiento|exhaust|lleno|sin conexiones|sin disponibilidad`.
- Tokens: suma de medianas por tarea +9,2 % (+4,2 % sin T19). Lo mueven T19 (+18 %, una corrida de 1,94 M contra rango 0,94–1,27 M del control), T05 (+20 %, más pasos porque el modelo investiga más), T18 (+53 %), T26 (+33 %), T20/T30 (+20 %), T07 (+20 %). Con n=3 contra n=5 el banco no da veredicto en ninguna (todas «n<5»). Y bajan T22 (-30 %; recuerda que es bimodal por el modelo), T03 (-22 %), T23 (-18 %). No hay patrón de causa común (los tokens por paso casi no cambian: ±3 % salvo T19, T05 y T26). **Conclusión: sin evidencia de regresión de tokens, pero tampoco de ahorro; para descartar +4–9 % hace falta n=5 en T19, T05, T18, T26.**
- Ayudantes (tareas donde el modelo lanzó subagentes por sí mismo): solo T08, unos 125 k tokens que el control tampoco contaba; no cambia nada.

## 2. ¿El sanitizador del modelo (`LAZUNOX_SANITIZAR_MODELO=1`) cuesta algo?
- Tokens: nada visible. T01 -1 %, T13 +1 %, T28 +1 %; T05 -33 % (ruido del modelo). Éxito de T01 y T13 igual (3/3). Resultado: **no hay costo medible de gasto**.
- T28: sin sanitizador 0/3 (control 0/5); con él **2/5 en b1 y 3/3 en b4 (5/8 en total)**. Mejora, pero NO es fiable: en las corridas que fallan la clave sigue apareciendo en una herramienta que ve el modelo. Hipótesis no probada (no hay fallo conservado con las salidas): el modelo lee `.entorno` con la herramienta `read`, que el nivel 2 no sanea (solo `bash`, `shell_wait`, `execute`, `execute_wait`). Para decidir si se enciende por defecto: el gasto no lo impide; falta hacer que T28 guarde las salidas de herramientas fallidas y mirar qué herramienta filtra. Recomendación segura: no encenderlo por defecto aún, o encenderlo sabiendo que cubre comandos pero no lectura de archivos.

## 3. ¿Mejora T29 (guía AGENTS.md que cambia)?
- Sí, pero dentro del ruido: 5/5 contra 4/5 del control, mismos tokens (+1 %), mismos pasos (19). Es un punto de diferencia, no una mejora demostrada.

## 4. ¿Los flujos mejoran T21/T32/T31 sin subir tokens?
- **No se pudo medir el efecto, porque el modelo no los usó**: en las 6 corridas con `LAZUNOX_FLUJOS=1` y la frase sugerida en el pedido, el modelo usó solo `bash` y `write` (cero llamadas a `execute`, cero ayudantes; `tokens_ayudantes` = 0 en todas). La herramienta SÍ está disponible (el modelo la lista con esas variables). El pedido solo dice «si te sirve».
- Los números (n=3, éxito 3/3 en los dos brazos): T31 68 k (A) contra 75 k (B), +10 %; T32 121 k contra 100 k, -17 % (A tuvo una corrida de 217 k). Son diferencias de ruido entre dos brazos que hicieron lo mismo. **No sirven para encender o rechazar los flujos.**
- T21 con flujos no se midió (tope de gasto). T21 sin variables: 3/3, +1 % de tokens contra control.
- Verificado: el banco ahora suma tokens de ayudantes (vía `informe`), pero aquí no hubo ayudantes que sumar.
- Para medir de verdad hay que forzar el uso del flujo (p. ej. un pedido que lo exija), y entonces comparar con ayudantes sumados.

## Otras notas
- Pruebas del Mac sobre la rama del fork: todas las carpetas salieron con 0 salvo `test/server` (3 fallas: rutas del objetivo 404/400, v2 pty HttpApi, y un log de HttpApi.listen); no se investigaron aquí.
- T25 y T27 (proveedor falso) no se corrieron en esta tanda.

---
# FASE 2 (misma noche): dudas cerradas con datos — esto CORRIGE o precisa lo de arriba donde se contradiga

Gasto de esta fase: ~9,3 M tokens enviados (tope 9 M; se pasó por una corrida de flujos de 1,65 M; T19 se cortó a mitad). Carpetas: `e1` (final) y `e2` (control `ctl`, b3ccb17) = T05/T18/T26 n=5, con `--conservar`; `e3` = T28 con sanitizador n=5; `f0`/`f1` = flujos forzados; `a2` = T19.

## A. T05, T18, T26 (final contra control, mismas condiciones, n=5)
- Éxito **15/15 en los dos motores**. T05 5/5 → 5/5 (tokens +53 %, rangos 129–418 k contra 162–406 k: «dentro del ruido»), T18 5/5 (-37 %), T26 5/5 (-0 %). Los +53 % de T18 y +33 % de T26 de la primera pasada **no se repiten**: eran ruido.
- Los fallos de T05 de la fase 1 (final: 4 de 19 corridas en total, control: 0 de 10) se leyeron completos (`causa.txt` conservado). Las dos respuestas fallidas que se pudieron leer dicen, por ejemplo: «La caída se debió al agotamiento del pool de conexiones 'pagos-db' (máximo 20): … tras 3 reintentos, el proceso terminó…». Es la causa correcta. El verificador exige `agotad|exhaust|lleno|sin conexiones`; todas las respuestas que pasan (10 de 10 en e1/e2) citan `ERR_POOL_AGOTADO` («agotado»). **El verificador sí rechaza respuestas correctas**, y es determinista sobre el texto: el control habría fallado igual con esa respuesta. 4/19 contra 0/10 no es una diferencia significativa (p ≈ 0,13) y no hay mecanismo del motor que cambie la redacción; en la corrida 5/5 final de e1 no hubo ninguno. Veredicto: **no hay evidencia de fallo del motor final en T05**. Arreglo propuesto (solo del verificador, aplica a ambos motores; NO aplicado, para no cambiar la vara de las medidas ya hechas): aceptar también `agotamiento|sin disponibilidad`.

## B. T19 (dispersión de tokens)
- Se pidieron 3 corridas más; el tope de gasto dejó **una** (n=4 final: 1 944 544; 1 093 043; 1 389 849; 1 035 118; mediana 1,24 M). Control n=5: 0,94–1,27 M, mediana 1,18 M. Candidato anterior: 0,88–1,20 M. La mediana es parecida (+5 %); lo que sube la cifra es una sola corrida de 1,94 M. Con n=4 no se puede decir que sea un efecto del motor; hace falta otra tanda de T19 solo (≈ 6 M de tokens) para n=8.

## C. T28 y el sanitizador del modelo: hipótesis CONFIRMADA
- n=5 con `LAZUNOX_SANITIZAR_MODELO=1` (e3): 4/5 (con las tandas previas: 9/13). En la corrida que falla se leyó la base de sesión: el modelo corrió `read` sobre `.entorno` y la salida de `read` contiene `LAZUNOX_API_KEY=sk-FALSA…` completa. Todas las salidas de `bash` de esa misma sesión salieron bien enmascaradas (`LAZUNOX_API_KEY=[REDACTED_SECRET]`). Las otras 4 corridas no leyeron el archivo con `read`.
- **El hueco**: `src/session/sanitizar-partes.ts` limita el nivel 2 a `SALIDA_DE_COMANDO = {bash, shell_wait, execute, execute_wait}`. Las herramientas `read` (y `grep`, que puede devolver líneas con claves) no pasan por `resultadoParaElModelo`, así que el contenido de archivos llega al modelo sin sanear.
- **Rutas protegidas no lo cubren**: `permission/rutas-protegidas.ts` protege solo EDICIONES (`.git`, `.claude`, `.mcp.json`…), no lecturas. Para lecturas, `agent.ts` tiene reglas por defecto `*.env: ask` y `*.env.*: ask` (`*.env.example` permitido); un `.env` normal por tanto pregunta (y con `--permisos ninguno` se niega), pero (a) un nombre como `.entorno`, `secrets.json`, `config.yaml` no coincide, (b) una regla de usuario `read: allow` (como la del banco, o el modo «sin preguntar») gana a esas reglas por defecto, y (c) si la persona aprueba leer `.env`, el contenido va al modelo tal cual.
- **Cambio mínimo propuesto (NO aplicado)**: añadir `"read"` a `SALIDA_DE_COMANDO` (renombrar a «salida que se sanea») para que `resultadoParaElModelo` también la procese cuando `LAZUNOX_SANITIZAR_MODELO=1`; `grep` igual si se quiere. Riesgo a decidir: el modelo vería `[REDACTED_SECRET]` en el archivo y un `edit` con ese texto fallaría (el motor no tiene el secreto real en el texto que el modelo cita); por eso conviene que `read` solo sane tokens que el sanitizador ya reconoce como secreto (no archivos enteros) y que se mantenga la opción apagada por defecto. Alternativa más estrecha: sanear `read` solo si la ruta coincide con patrones de secretos (`*.env*`, `*secret*`, `*credential*`, `.entorno`…), pero el banco usa `.entorno` justamente para probar que el nombre no basta.

## D. Flujos forzados de punta a punta (f0 sin variable, f1 con `LAZUNOX_FLUJOS=1`, pedido con «usa execute con tools.flujos.en_paralelo…», n=3, tokens de ayudantes sumados)
- **Funciona de punta a punta**: con la variable el modelo llamó a `execute` en las 9 corridas, se lanzaron ayudantes reales (7–138 pasos de ayudantes por corrida, hasta 32 sesiones) y las 9 salieron bien (3/3 en T21, T31 y T32). Sin la variable el modelo ni lo intentó y resolvió con `bash`/`read` (9/9 bien), sin error de herramienta inexistente.
- **Pero cuesta mucho más**, siempre por los ayudantes: tokens totales (padre + ayudantes), mediana: T21 103 k → 148 k (+43 %); T31 44 k → 315 k (+612 %, una corrida de 1,64 M); T32 64 k → 347 k (+443 %). Pasos del padre bajan (T21 9 → 4) pero cada ayudante vuelve a leer su contexto. **El criterio D5 («mejor éxito sin subir tokens») NO se cumple: flujos deben seguir apagados por defecto.**
- Fallo real a anotar: en T31-r02 el primer guion lanzó 10 ayudantes bien, pero la lógica del modelo no supo leer la respuesta (`{"id","estado","informe":"<json como texto>","no_confiable","aviso"}`: el JSON útil viene como texto dentro de `informe`), lanzó una excepción, y el modelo repitió el guion (32 sesiones, 138 pasos de ayudantes, 1,65 M). Es un error del guion del modelo, no de la herramienta: la descripción de `en_paralelo` sí indica la forma del resultado. Posible mejora del fork (opcional): devolver `informe` ya interpretado cuando el ayudante contesta un JSON válido, o un campo `datos`.
- Observación del banco: sin `--sumar-ayudantes` el brazo B habría parecido más barato (los tokens de ayudantes son 80–95 % del total).

---
# FASE 3: motor `final2` (con el arreglo de `read` y `grep`, fork 87ff019) y sanitizador del modelo encendido

- **T28: 5/5** (antes del arreglo: 4/5 en e3, 9/13 en total; control 0/5). En la base de sesiones de las 5 corridas la clave falsa aparece **0 veces** en cualquier parte; 3 de las 5 corridas usaron `read` (la vía que antes fugaba) y salió saneada. El hueco queda cerrado en esta muestra.
- **Gasto con el sanitizador**: T01 3/3, 45,1 k → 44,9 k (-0 %); T13 3/3, 46,6 k → 46,4 k (-1 %). **No cuesta nada** en tareas normales. T28 +28 % de tokens contra el control (34,6 k → 44,2 k, «dentro del ruido»): no es el costo del sanitizador sino que ahora la tarea se completa por la vía larga (leer el archivo, redactar el informe sin la clave, comprobarlo) en vez de fallar rápido.
- Verificador de T05 corregido en commit aparte (ver LEEME): las 16 salidas conservadas pasan con el nuevo.
- Decisión del dueño: sanitizador y flujos siguen apagados por defecto; esta fase solo confirma que encender el sanitizador no tiene costo medible.
