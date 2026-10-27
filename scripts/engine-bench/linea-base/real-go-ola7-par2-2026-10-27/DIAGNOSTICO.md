# Diagnóstico T22 / T19 / T03 / T20 (n=5, par nuevo)

- Éxito 134/140 (control) y 132/140 (candidato) con modelo real; T25/T27 con proveedor falso: control 5/10, candidato 10/10 (T27 0/5 → 5/5).
- Tokens enviados totales: control 16 264 999, candidato 15 639 925 (-4 %). Salida: 167 387 vs 167 835. Pasos: 1321 vs 1286.
- `--comparar` con n=5: TODAS las tareas «dentro del ruido»; criterio de ola de éxito: se cumple.
- T22: «tokens por paso» 12 k → 22,9 k NO es un efecto del candidato. Con n=5 la distribución es bimodal en LOS DOS motores, según si el modelo vuelca la salida larga a su contexto (resultado de herramienta de ~31,6 KB, ~22,9 k tokens por paso) o filtra con grep/tail (~1,4–8,5 KB, ~9–12 k por paso). Control: 3 de 5 corridas en el modo alto (más 1 de 3 en el n=3 anterior); candidato: 3 de 5 (más 2 de 3 antes). Mismo tamaño de resultado en ambos (31 595–31 894 B vs 31 608–31 737 B): el recorte de salida (7.4) no cambia nada ahí.
- T19: mediana 1 180 855 → 1 022 399 (-13 %), tokens por paso 15,2 k en ambos. T03 -1 %, T20 -6 %.
- Fallos: T28 0/5 en ambos (el verificador detecta la clave en la salida de una herramienta; igual en los dos). T29 4/5 vs 3/5, mismo modo de fallo (`lzx_sumar`, el modelo no atiende el cambio de guía). T23 candidato 4/5: en la corrida fallida el modelo borró él mismo `.sync-iniciado` (`rm -f .sync-iniciado .sync-hecho`) tras dejar el CSV correcto; es un artefacto del verificador, no del motor.
- Interruptores `LAZUNOX_<X>=0`: no hizo falta usarlos (no hay diferencia sostenida).
