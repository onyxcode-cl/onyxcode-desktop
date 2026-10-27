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
