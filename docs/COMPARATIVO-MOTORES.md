# Comparativo de motores: Lazunox, OpenCode 2.x y Codex (paquete 7.19)

Fecha de las corridas: **2026-10-27**, de 07:29 a 08:01 (hora de Chile). Una sola ronda; el plan prevé una segunda al cerrar la tanda D.

## Qué se comparó

| | Lazunox | OpenCode | Codex |
|---|---|---|---|
| Versión | motor del fork `lazunox-motor`, rama `feat/ola7-final` @ `87ff0190580a5c6941a4790b0cae4028fd5876ea` (`final2`), `--version` = 1.19.0 | **v2.2.0** (ver «Desviaciones») | `codex-cli 0.164.0` (`rust-v0.164.0`) |
| Binario | linux/arm64, sha256 `8333ba0760321193ed530e4c33038476168dfdcf92ba2b679656c71753e972a0` (compilado por nosotros, receta de `real-go-ola7-final-2026-10-27/receta-build.sh`) | `opencode-linux-arm64.tar.gz`, sha256 `1f1ce0fc07b9245a815ffa9d652dbb80e6b0f07e5bf74ea87d2b1c0339fbac52`; binario extraído `bb701fa4152889037f95e5444af572f97abe8c14b879e96434f689c21e678062` | `codex-aarch64-unknown-linux-musl.tar.gz`, sha256 `29a507a2a3fd8f6cd94b96b762d281d299d15d7902dee6132d314b78cf9108eb`; binario extraído `8813c8d8a4cea2eeba271b72ab22f49628b184b24ab18dbef06b4ce41e9a8d39` |
| Origen | propio | GitHub Releases de `anomalyco/opencode` | GitHub Releases de `openai/codex` |
| Verificación | — | el hash coincide con el `SHA256SUMS` publicado en la release y con el que da GitHub; `gh attestation verify` sin errores | el hash coincide con el que da GitHub; la firma `.sigstore` de la release es válida sobre el binario (comprobada con el certificado incluido, cuya identidad es el flujo `openai/codex/.github/workflows/rust-release.yml@refs/tags/rust-v0.164.0`). **No** se verificó la cadena del certificado hasta Fulcio (no hay `cosign`) |

**Modelo (el mismo para los tres):** `opencode-go/deepseek-v4.1-flash` (plan de pago OpenCode Go de Ben), por el endpoint `https://opencode.ai/inference/go/openai/v1`. Lazunox y OpenCode usan `/chat/completions`; Codex usa `/responses` (el endpoint lo acepta, así que Codex **sí** es medible en igualdad).

**Tareas:** las del banco `scripts/engine-bench` (T01 a T24 salvo las que se dicen abajo), con los mismos verificadores y las mismas carpetas iniciales. Mismas banderas de Lazunox de siempre: 60 pasos, 400 000 tokens, 15 minutos. OpenCode y Codex no traen esas banderas: el proxy (ver abajo) corta a los 60 pasos o 400 000 tokens por corrida, y el reloj a los 15 minutos; ninguna corrida llegó a esos topes.

## Cómo se midió (igual para los tres)

- Cada motor corrió en su propio contenedor `node:22-bookworm` (2 CPU, 3 GB, `--cap-drop=ALL`), HOME vacío y distinto en cada corrida, sobre una **red interna de Docker sin salida a internet**. Lo único que alcanzan es un proxy.
- El proxy (`scripts/engine-bench/proxy-go.mjs`, código nuestro, en otro contenedor) recibe las peticiones con una **clave falsa** (la etiqueta de la corrida) y las reenvía a OpenCode Go con la clave real, que leyó de una copia temporal de solo lectura del `auth.json` de la app (ya borrada). Los binarios de terceros nunca vieron la clave real. El proxy no guarda cabeceras ni cuerpos; solo el `usage` de cada respuesta.
- **Todas las cifras de tokens salen del proxy** (el `usage` real de cada petición), no de lo que cada motor dice de sí mismo. Esto es nuevo respecto de las mediciones anteriores del banco, que usaban lo que contaba Lazunox (`step_finish`); por eso los números de Lazunox de aquí difieren un poco de los de `real-go-ola7-final-2026-10-27` (el proxy cuenta también la petición auxiliar del título de la sesión).
- Definiciones: **paso** = petición al modelo con herramientas. **Tokens enviados** = `prompt_tokens` sumados de todas las peticiones (incluye los que el proveedor leyó de su caché). **Tokens por paso** = `prompt_tokens` de cada paso. Lazunox y OpenCode hacen además una petición corta sin herramientas (título de la sesión, unos 500 tokens) que cuenta en los totales y no en los pasos; Codex no la hace.
- El proxy añade la cabecera `x-opencode-session` (OpenCode Go la exige) cuando el motor no la manda: lo hizo con Codex; Lazunox y OpenCode mandan la suya.
- Los tres corrieron **a la vez** (un contenedor por motor), para que un cambio del modelo durante el día les afecte igual.
- Éxito = el verificador de la tarea (determinista, sin juez con modelo).

## Resultados

n = 3 repeticiones por motor y tarea en 19 tareas; n = 1 en otras 3 (T05, T10, T11) por el tope de gasto. Las 60 corridas de cada motor terminaron sin error de motor ni tope: Lazunox «completado» en las 60; OpenCode y Codex no emiten informe de motivo, y el proxy no tuvo que cortar ninguna por pasos ni tokens. En «tokens enviados» se da la mediana y entre corchetes el mínimo y el máximo de las 3 repeticiones.

### Éxito y tokens enviados por tarea

| Tarea | Éxito Lazunox | Éxito OpenCode | Éxito Codex | Tokens enviados Lazunox (mediana [mín–máx]) | OpenCode | Codex |
|---|---|---|---|---:|---:|---:|
| T01 Arreglar un bug con prueba que falla (JS) | 3/3 | 3/3 | 3/3 | 44.704 [44.444–45.603] | 26.810 [26.425–27.730] | 51.018 [50.690–62.828] |
| T02 Añadir función + prueba (Python) | 3/3 | 3/3 | 3/3 | 45.564 [45.483–64.582] | 34.456 [28.276–34.608] | 75.689 [65.023–76.478] |
| T03 «¿Dónde se valida X?» en un repo de 60 archivos | 3/3 | 3/3 | 2/3 | 45.648 [34.500–55.108] | 43.575 [34.801–45.529] | 44.329 [40.227–65.086] |
| T04 Renombrar un símbolo en 5 archivos | 3/3 | 3/3 | 3/3 | 36.643 [26.799–48.647] | 29.996 [29.768–31.542] | 55.163 [50.273–67.737] |
| T05 Leer un log de 3 MB y escribir la causa | 1/1 | 1/1 | 1/1 | 326.988 [326.988–326.988] | 256.772 [256.772–256.772] | 142.110 [142.110–142.110] |
| T06 Refactor que obliga a releer el mismo archivo | 3/3 | 3/3 | 3/3 | 49.181 [49.079–59.275] | 37.760 [31.507–37.926] | 67.272 [56.390–67.801] |
| T07 Arreglar error de tipos (TS) | 3/3 | 3/3 | 3/3 | 57.645 [45.543–58.912] | 33.828 [28.279–42.540] | 57.680 [56.559–63.328] |
| T08 Resumir 3 módulos con 3 ayudantes en paralelo | 3/3 | 3/3 | 3/3 | 75.257 [74.195–85.815] | 59.826 [30.251–73.784] | 144.197 [138.403–160.771] |
| T10 Tarea de 6 pasos con lista de tareas | 1/1 | 1/1 | 1/1 | 56.581 [56.581–56.581] | 41.906 [41.906–41.906] | 183.127 [183.127–183.127] |
| T11 Migración con verificación por paso | 1/1 | 1/1 | 1/1 | 107.397 [107.397–107.397] | 70.229 [70.229–70.229] | 90.775 [90.775–90.775] |
| T12 Usar un conector MCP de prueba con 40 herramientas | 3/3 | 3/3 | 3/3 | 68.921 [68.530–92.171] | 28.901 [27.000–35.286] | 117.391 [93.115–117.737] |
| T13 «Haz pasar las pruebas» (3 fallos) | 3/3 | 3/3 | 3/3 | 47.864 [47.710–47.998] | 28.870 [28.013–29.259] | 52.718 [42.447–53.941] |
| T14 Revisar un diff con un bug sembrado | 3/3 | 3/3 | 3/3 | 50.434 [49.198–56.906] | 30.283 [30.022–48.315] | 57.398 [56.054–58.653] |
| T15 Lote: 3 módulos independientes | 3/3 | 3/3 | 3/3 | 46.930 [35.369–47.390] | 30.517 [29.346–53.030] | 63.538 [52.695–78.200] |
| T16 Oficina: CSV de gastos → informe con totales exactos | 3/3 | 3/3 | 3/3 | 38.664 [37.586–57.791] | 37.571 [36.657–46.380] | 53.282 [50.112–54.409] |
| T17 Oficina: corregir acentos y formato de una carta | 3/3 | 2/3 | 3/3 | 39.772 [36.311–39.893] | 25.095 [15.928–40.988] | 72.048 [50.729–73.636] |
| T18 Oficina: ordenar 30 archivos en carpetas por fecha | 3/3 | 3/3 | 3/3 | 37.098 [36.986–37.215] | 29.707 [23.851–32.461] | 43.771 [42.758–72.112] |
| T20 Oficina: editar frases con «», “” y — | 3/3 | 3/3 | 3/3 | 38.369 [27.598–86.069] | 23.627 [23.565–28.971] | 51.221 [50.200–52.795] |
| T21 Migración de 5 pasos con dependencias | 3/3 | 3/3 | 3/3 | 81.087 [79.215–82.520] | 60.359 [57.200–63.244] | 113.627 [112.737–128.035] |
| T22 Pruebas con 20 000 líneas de salida y un fallo escondido | 3/3 | 3/3 | 3/3 | 70.340 [58.200–145.514] | 122.066 [21.375–122.832] | 53.069 [52.855–83.972] |
| T23 Un archivo cambia mientras trabajas | 3/3 | 3/3 | 3/3 | 46.037 [45.735–77.314] | 42.356 [22.772–42.487] | 94.497 [79.634–144.086] |
| T24 Leer 8 archivos pequeños y resumirlos | 3/3 | 3/3 | 3/3 | 36.218 [28.861–37.692] | 22.128 [21.963–22.376] | 38.158 [28.857–51.159] |

### Pasos, tokens por paso y tiempo por tarea (mediana entre repeticiones)

| Tarea | Pasos L | Pasos O | Pasos C | Tokens/paso mediana · p90 L | O | C | Min L | Min O | Min C |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| T01 | 5 | 5 | 5 | 9.043 · 9.271 | 5.473 · 5.707 | 10.352 · 11.599 | 0,2 | 0,17 | 0,44 |
| T02 | 5 | 6 | 7 | 9.194 · 9.579 | 5.801 · 6.375 | 10.817 · 13.208 | 0,22 | 0,24 | 0,51 |
| T03 | 5 | 7 | 4 | 8.958 · 9.809 | 5.771 · 6.662 | 11.161 · 12.339 | 0,17 | 0,2 | 0,27 |
| T04 | 4 | 5 | 5 | 9.143 · 9.555 | 6.195 · 6.971 | 11.272 · 13.408 | 0,19 | 0,23 | 0,44 |
| T05 | 12 | 15 | 6 | 22.054 · 46.608 | 15.645 · 27.297 | 24.076 · 36.042 | 0,98 | 0,84 | 0,43 |
| T06 | 5 | 6 | 6 | 10.009 · 10.902 | 6.425 · 7.397 | 11.241 · 14.189 | 0,21 | 0,23 | 0,46 |
| T07 | 6 | 6 | 5 | 9.341 · 10.773 | 5.672 · 6.321 | 10.581 · 14.560 | 0,36 | 0,24 | 0,52 |
| T08 | 10 | 12 | 14 | 6.405 · 9.998 | 5.153 · 7.874 | 9.192 · 14.858 | 0,32 | 0,4 | 0,72 |
| T10 | 6 | 7 | 15 | 9.501 · 9.997 | 6.016 · 6.758 | 12.105 · 15.028 | 0,28 | 0,35 | 0,91 |
| T11 | 11 | 11 | 8 | 9.873 · 10.324 | 6.560 · 7.085 | 11.796 · 13.667 | 0,34 | 0,33 | 0,53 |
| T12 | 3 | 4 | 5 | 22.794 · 22.906 | 7.467 · 7.746 | 23.484 · 23.983 | 0,17 | 0,16 | 0,28 |
| T13 | 5 | 5 | 5 | 9.820 · 10.340 | 5.888 · 6.479 | 10.800 · 12.544 | 0,19 | 0,18 | 0,4 |
| T14 | 5 | 5 | 5 | 9.530 · 11.374 | 5.994 · 7.543 | 11.529 · 14.565 | 0,35 | 0,31 | 0,73 |
| T15 | 5 | 5 | 6 | 9.496 · 10.112 | 5.974 · 7.222 | 10.752 · 13.057 | 0,21 | 0,22 | 0,47 |
| T16 | 4 | 6 | 5 | 9.628 · 10.210 | 6.385 · 6.912 | 10.780 · 12.657 | 0,19 | 0,21 | 0,44 |
| T17 | 4 | 4 | 6 | 9.150 · 11.258 | 6.131 · 7.564 | 10.445 · 12.786 | 0,42 | 0,29 | 0,63 |
| T18 | 4 | 4 | 4 | 9.131 · 10.010 | 6.712 · 8.297 | 10.854 · 13.535 | 0,18 | 0,21 | 0,51 |
| T20 | 4 | 4 | 5 | 9.408 · 10.385 | 5.674 · 6.685 | 10.207 · 11.920 | 0,15 | 0,21 | 0,43 |
| T21 | 8 | 9 | 9 | 10.225 · 11.165 | 7.222 · 7.982 | 13.111 · 15.491 | 0,28 | 0,31 | 0,73 |
| T22 | 6 | 5 | 4 | 12.451 · 12.790 | 29.210 · 29.537 | 14.649 · 15.251 | 0,2 | 0,17 | 0,33 |
| T23 | 5 | 7 | 8 | 8.921 · 9.954 | 6.213 · 7.030 | 11.720 · 15.410 | 0,36 | 0,33 | 1,17 |
| T24 | 4 | 4 | 4 | 9.218 · 10.155 | 5.353 · 6.260 | 9.743 · 10.578 | 0,16 | 0,19 | 0,31 |

### Totales (19 tareas medidas por los tres motores: T01, T02, T03, T04, T06, T07, T08, T12, T13, T14, T15, T16, T17, T18, T20, T21, T22, T23, T24)

| | Lazunox | OpenCode 2.2.0 | Codex 0.164.0 |
|---|---:|---:|---:|
| Corridas | 57 | 57 | 57 |
| Éxitos | 57 | 56 | 56 |
| Tokens enviados (suma) | 3.054.133 | 2.154.018 | 4.008.588 |
| Tokens de salida (suma) | 63.537 | 82.098 | 185.282 |
| Pasos (suma) | 303 | 325 | 346 |
| Tokens por paso, todos los pasos juntos: mediana | 9.383 | 5.982 | 11.138 |
| Tokens por paso, todos los pasos juntos: p90 | 11.165 | 7.615 | 14.922 |
| Tokens enviados en el primer paso (mediana) | 8.213 | 4.671 | 8.534 |
| Mediana de tokens enviados+salida por éxito | 48.528 | 32.781 | 63.055 |
| Tiempo total (min) | 13,6 | 14 | 29,1 |
| Costo de lista de OpenCode Go (USD, suma) | 0,148 | 0,115 | 0,193 |
| Peticiones al modelo que no fueron 200 | 1 | 0 | 0 |

### Tareas medidas una sola vez por motor (n = 1; no se suman a los totales): T05, T10, T11

| Tarea | Motor | Éxito | Tokens enviados | Pasos | Tokens/paso mediana · p90 | Minutos |
|---|---|---|---:|---:|---|---:|
| T05 | Lazunox | 1/1 | 326.988 | 12 | 22.054 · 46.608 | 0,98 |
| T05 | OpenCode 2.2.0 | 1/1 | 256.772 | 15 | 15.645 · 27.297 | 0,84 |
| T05 | Codex 0.164.0 | 1/1 | 142.110 | 6 | 24.076 · 36.042 | 0,43 |
| T10 | Lazunox | 1/1 | 56.581 | 6 | 9.501 · 9.997 | 0,28 |
| T10 | OpenCode 2.2.0 | 1/1 | 41.906 | 7 | 6.016 · 6.758 | 0,35 |
| T10 | Codex 0.164.0 | 1/1 | 183.127 | 15 | 12.105 · 15.028 | 0,91 |
| T11 | Lazunox | 1/1 | 107.397 | 11 | 9.873 · 10.324 | 0,34 |
| T11 | OpenCode 2.2.0 | 1/1 | 70.229 | 11 | 6.560 · 7.085 | 0,33 |
| T11 | Codex 0.164.0 | 1/1 | 90.775 | 8 | 11.796 · 13.667 | 0,53 |

### Corridas fallidas

- OpenCode 2.2.0 T17: queda «Gonzalez» sin corregir [sin_informe]
- Codex 0.164.0 T03: no existe respuesta.txt [sin_informe]

## Lo que dicen los números

Todas las frases valen solo para este modelo, estas tareas y n = 3.

- **Éxito**: Lazunox 57 de 57; OpenCode 56 de 57 (T17, una vez); Codex 56 de 57 (T03, una vez). La diferencia de una corrida no permite ordenar a los motores por éxito.
- **Tokens enviados, Lazunox contra OpenCode 2.2.0**: Lazunox envía **más** en 18 de las 19 tareas de n = 3; en total 3,05 M contra 2,15 M (**+42 %**), con la mediana de tokens por paso en 9 383 contra 5 982 y el primer paso en 8 213 contra 4 671. En 12 de esas 18 los rangos de las 3 repeticiones no se solapan. La única tarea donde Lazunox envía menos es T22 (salida de 20 000 líneas): 70 k contra 122 k, aunque los rangos se solapan. Donde más pesa la diferencia es T12 (conector MCP con 40 herramientas): 68,9 k contra 28,9 k; Lazunox mete unos 22 800 tokens por paso y OpenCode unos 7 500.
- **Tokens enviados, Lazunox contra Codex 0.164.0**: Lazunox envía **menos** en 17 de las 19 tareas; en total 3,05 M contra 4,01 M (**-24 %**). Codex envía menos en T03 (44,3 k contra 45,6 k) y T22 (53 k contra 70 k); T07 empata (57,6 k contra 57,7 k). Codex tiene más tokens de salida (185 k contra 64 k) y tarda el doble (29 contra 14 minutos en total).
- **Pasos**: Lazunox 303, OpenCode 325, Codex 346 en las 57 corridas. Con pasos parecidos, la diferencia de tokens viene del tamaño de cada petición (instrucciones y definición de herramientas), no de dar más vueltas.
- **Tiempo**: Lazunox y OpenCode empatan (13,6 y 14,0 minutos en total); Codex 29,1.
- **Costo de lista de OpenCode Go** (campo `list_cost` de las respuestas, solo como referencia): Lazunox 0,148 USD, OpenCode 0,115, Codex 0,193 en las 57 corridas de cada uno.
- **Caché del proveedor** (parte de lo enviado que se leyó de caché, todas las peticiones del comparativo): Lazunox 79 %, OpenCode 82 %, Codex 88 %. Lazunox no gana por caché.
- **n = 1 (T05, T10, T11)**: no se suman a los totales ni sirven para ordenar; están en su tabla. En T05 (log de 3 MB) Lazunox envió 327 k, OpenCode 257 k, Codex 142 k; en T10 Codex envió 183 k contra 57 k de Lazunox y 42 k de OpenCode.

**Conclusión honesta:** en esta ronda Lazunox **no es mejor** que OpenCode 2.2.0 en consumo de tokens (es peor en casi todas las tareas) y empata en éxito y en tiempo; es mejor que Codex en consumo y en tiempo. No se puede decir «mejor que OpenCode 2.x» con estos datos. Lo que el plan llama «meta mejor» queda sin cumplir frente a OpenCode en tokens por paso, y el mayor margen de mejora está en el prompt base y en la lista de herramientas (T12 es el caso extremo: la búsqueda diferida de herramientas MCP no se nota en este banco).

## Límites y cosas que podrían cambiar las conclusiones

- **n pequeño**: 3 repeticiones (1 en tres tareas). Un rango entre mínimo y máximo es lo único que se debe leer como «fuera del ruido» cuando no se solapa; con n = 3 no hay prueba estadística.
- **Un solo modelo** (`deepseek-v4.1-flash`) y un solo día. El modelo detrás del plan puede cambiar; no se repitió en otro día. Es una sola ronda.
- **OpenCode v2.2.0, no 2.1.4** (ver «Desviaciones»).
- **Codex con modelo desconocido**: Codex avisa «Model metadata for `deepseek-v4.1-flash` not found» y usa metadatos por defecto (instrucciones y herramientas pensadas para modelos de OpenAI). Su resultado refleja a Codex con un modelo que no es el suyo; con un modelo de OpenAI podría ir distinto. Se corrió con `sandbox_mode = danger-full-access` y `approval_policy = never` porque el contenedor ya es el aislamiento; no tiene los permisos por herramienta que se configuran en Lazunox y OpenCode (`external_directory: deny`, etc.).
- **Herramientas distintas**: cada motor trae las suyas (Codex: una consola y `apply_patch`; OpenCode y Lazunox: `read`, `edit`, `grep`, etc.). La comparación es de «lo que gasta y logra cada motor tal como viene», no de un prompt idéntico.
- La definición de «paso» usa la petición al modelo; para Codex es la única forma (no emite pasos).
- Una respuesta 429 de OpenCode Go en una petición de Lazunox (T12): el motor reintentó y la corrida terminó bien. No hubo más 429. Se dejó un vigilante que detenía las corridas con un segundo 429; no se activó.
- Los tres corrieron con la configuración por defecto: Lazunox sin ninguna variable `LAZUNOX_*` ni `OPENCODE_EXPERIMENTAL_*` (como en la tanda `a` del banco final), de modo que lo que Lazunox ahorra con interruptores apagados por defecto no está aquí.

## Desviaciones del encargo y decisiones

1. **No existe un binario de OpenCode 2.1.4.** En `anomalyco/opencode` hay una etiqueta `v2.1.4`, pero ninguna release con binarios; la única release 2.x publicada es **v2.2.0** (2026-10-27), y es la que se usó. Compilar la etiqueta 2.1.4 habría sido un binario nuestro, no oficial; no se hizo.
2. **No se midieron T05, T10, T11 con n = 3, ni T09 y T19**: el tope de 12 M de tokens enviados lo impidió (T19 cuesta ~1,4 M por corrida y por motor; T09 ~0,4 M). Se midieron T05, T10 y T11 con n = 1. T09 y T19 quedan sin medir.
3. **T25 a T32: «no comparable»** (dependen de funciones propias de Lazunox: proveedor falso, flujos por script, saneador de claves).
4. **Gasto**: unos 11,1 M de tokens enviados en total medidos por el proxy (tope 12 M), de los cuales ~1,0 M fueron humo, sondeos y 3 corridas de Codex en T12 que hubo que repetir (el proxy no leyó el `usage` porque la línea `response.completed` de Codex pesa más de 60 KB; se corrigió el proxy y T12 de Codex se repitió; las 3 corridas anuladas están en `descartadas-codex-T12-sin-usage/`).
5. Las corridas de humo (T01, T02, T07, T12, T13, n = 1 por motor) **no** entran en las tablas; sus archivos están en `smoke*/`.
6. Unos pocos sondeos manuales iniciales (para ver si el endpoint aceptaba `/responses` y exigía `x-opencode-session`) no entran en las tablas; cuentan en el gasto (menos de 20 000 tokens).

## Cómo reproducirlo

Todo en `scripts/engine-bench/linea-base/comparativo-motores-2026-10-27/` (corridas por fase, `proxy.jsonl`, `lanzar.sh`, `tablas.md`, `resumen.json`).

1. Descargar y verificar los binarios como arriba, cada uno en su carpeta nueva y vacía.
2. Red interna: `docker network create --internal lzx-cmp-net`; proxy: `node scripts/engine-bench/proxy-go.mjs --auth <copia de auth.json> --log proxy.jsonl --puerto 8080 --tope 12000000` en un contenedor conectado también a la red por defecto, con alias `proxy` en la interna.
3. Por motor: `lanzar.sh <lazunox|opencode2|codex> <fase> <tareas> <repeticiones>` (corre `run.mjs --adaptador … --proxy-url http://proxy:8080/v1`).
4. `node scripts/engine-bench/comparativo-agregar.mjs --proxy proxy.jsonl --lazunox <carpetas> --opencode2 <carpetas> --codex <carpetas> --salida <carpeta>`.

Cambios al banco: `run.mjs` (opciones `--adaptador`, `--proxy-url`, `--prefijo`; traducción de la salida de Codex), `proxy-go.mjs` y `comparativo-agregar.mjs` nuevos. El fork de Lazunox no se tocó.
