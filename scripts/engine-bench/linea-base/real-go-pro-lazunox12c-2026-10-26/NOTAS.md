Modelo opencode-go/deepseek-v4-pro, 9 tareas (T03,T08,T09,T15,T19-T23) x 5 reps x 3 celdas, 2026-10-26, contenedor linux-arm64.
lzx11 = motor lazunox.11; 12c-off = lazunox.12c sin banderas; 12c-on = 12c con LAZUNOX_AYUDANTES_MINIMOS=1, LAZUNOX_RESUMEN_ROBUSTO=1 y config global compaction.umbral=20000.
Reps 1-2 intercaladas (11, 12c-off, 12c-on); la 3 se cortó por reinicio de Colima y reps 3-5 se completaron en 2 contenedores en paralelo.
Corridas crudas en lzx11/, 12c-off/, 12c-on/; comparar-*.txt = salida de run.mjs --comparar.
