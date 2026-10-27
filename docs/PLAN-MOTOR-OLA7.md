# Plan de la Ola 7 del motor: paridad total con Claude Code, Codex y OpenCode 2.x, y por encima

Fecha: 2026-10-26 (revisado el mismo día tras leer el código de Codex y de OpenCode 2.x). Solo lectura y web; no se tocó código ni git del motor. Continúa `docs/PLAN-MOTOR-OLA6.md` (paquetes 6.1-6.10) y `docs/PLAN-MAESTRO-MOTOR-PARIDAD.md`. Las reglas comunes son las de la §4 del plan maestro: rama por tarea, interruptor `LAZUNOX_<X>=0`, pruebas pesadas en el VPS, nota en `LAZUNOX.md`, grupo `PROBE_ONLY=<x>` en `scripts/engine-probe/run.mjs`.

## 0. De dónde sale este plan

Cuatro lecturas hechas el 2026-10-26:

- **Motor real** (`lazunox-motor`, rama `main`, commit `b3ccb17`, 7 commits después de `lazunox.11`), leído del código y de `LAZUNOX.md`. Los paquetes 6.2-6.10 tienen código.
- **Claude Code** (2.1.311). No es de código abierto: changelog leído de la 2.1.311 a la 2.1.200 y las páginas de docs (hooks, permisos, sandbox, subagentes, costos, contexto, workflows, equipos, puntos de control, herramientas, memoria, skills, worktrees, modelo, tareas programadas y MCP).
- **Codex**: código de `codex-rs` (clon superficial, que trae versión 0.0.0, así que **no se pudo asociar nada a «0.162/0.163/0.164» por número**) más notas de versión.
  La app de escritorio de Codex **no aparece publicada** en ese repositorio ni en la página de código abierto de OpenAI (que sí lista la CLI, el SDK y el `app-server`); lo que la app usa para hablar con el motor, `codex-rs/app-server`, sí está y no se estudió a fondo. Pendiente si se quiere comparar contra nuestro protocolo app↔motor.
- **OpenCode 2.x**: código de la rama `dev` (`package.json` = 2.1.4). Ojo: no hay `packages/opencode`; el núcleo está en `core`, `cli`, `server`, `plugin`, `schema`, `ai` y `codemode`.

**`docs/COMPARATIVA-MOTOR.md` está desactualizada** y no debe usarse como estado actual: formularios MCP, búsqueda diferida, rutas protegidas, ganchos por comando, «siempre» persistente, rebobinar, reinyección tras compactar, LSP estable, modo plan, topes de ayudantes, verificador y revisor ya existen.

**Lo que sigue sin verificar** (cerrarlo antes de implementar lo que dependa de ello):
- Cómo trata CRLF el `Edit` de Claude Code: sus docs no lo dicen.
- Qué cambió exactamente en la «0.164» de Codex (lo del endurecimiento por mayúsculas y minúsculas en macOS **no se encontró en el código**; la normalización de nombres que vimos solo existe para Windows).
- Qué envía el módulo de comentarios de Codex y el comportamiento de los builds oficiales de OpenCode.
- Los ahorros de cada función **en nuestro motor** no están medidos.

## 1. Qué significa «100 %» y cómo se demuestra

Meta fijada por Ben el 2026-10-26: **el mismo nivel que Claude Code, Codex y OpenCode 2.x, y mejor**. Para poder decir «100 %» sin mentir, se fija por escrito qué cuenta:

- **Clase A — local y gratis.** Todo lo que cualquiera de los tres hace sin su nube ni un pago. Se iguala **toda**. Al cerrar la ola, ninguna fila A de la matriz (§2) puede quedar en «Falta». Si una fila no se puede igualar, **se mueve de clase con el motivo escrito**; no se borra.
- **Clase B — depende de su nube, su cuenta o su pago** (modelos y clasificadores propios, rutinas en la nube, voz, memorias con su cuota, tienda de plugins, telemetría). No se copia. Cuando hay un equivalente local, se construye ese y pasa a clase A.
- **Clase C — decisiones de Ben que este objetivo reabre**: red por dominios, subagentes con worktree, tareas programadas, auto-revisión y flujos por script. Cada una vuelve con una versión **acotada y con condiciones de seguridad medibles**; Ben confirma cada una (§6).
- **«Mejor» se demuestra, no se declara.** Hay un comparativo justo (7.19): el mismo modelo gratuito, las mismas tareas y n = 3, contra OpenCode 2.1.4 y Codex con proveedor propio, en el contenedor del VPS. Si el resultado no es mejor, no se dice. Claude Code entra solo si se puede apuntar a un modelo gratuito por una puerta de enlace; si no, se compara por documentación, no por prueba.

**Cierre de la ola**: (1) la matriz sin «Falta» en clase A; (2) el comparativo con éxito ≥ al de ellos y menos tokens enviados por paso; (3) probe 100 % en Mac, Linux y Windows. Mientras no se cumpla, la app no promete «paridad» ni «mejor».

### Dónde ya estamos por delante (y hay que defenderlo)

- **Cero telemetría, con una prueba que la vigila.** La analítica de Codex es opt-out; el motor de OpenCode no envía, pero sus apps sí pueden.
- **Límites seguros por defecto en Code Mode**; OpenCode no pasa ninguno y Codex no fija tope de tiempo ni de llamadas.
- **Aislamiento real fuera del motor**: Seatbelt en Mac y WSL2 en Windows, con proxy de credenciales y de salida. El sandbox de Claude Code viene apagado y no existe en Windows nativo.
- **Rebobinar incluye lo que cambió un comando de shell** (diff por turno con origen `comando`); en Claude Code los cambios por shell no se rastrean.
- **Puerta del plan y rutas protegidas siempre activas**, con zonas intocables vigiladas por prueba.
- **Funciona con modelos gratuitos débiles y lo mide** (banco con verificadores deterministas). Ninguno de los tres publica algo así.
- **En español**, con el aviso de términos de OpenCode donde importa.

## 2. Matriz de paridad (estado al 2026-10-26)

Leyenda: ✅ igual o mejor · 🟡 existe pero apagado o parcial · ❌ falta · 📱 lo cubre la app · 🅱️ clase B · n/v = no verificado. «CC» = Claude Code, «OC2» = OpenCode 2.x. Una celda «n/v» en los competidores no cambia la fila: lo que cuenta es el estado de Lazunox y su paquete.

| Capacidad | CC | Codex | OC2 | Lazunox | Paquete |
|---|---|---|---|---|---|
| **Herramientas** | | | | | |
| Leer, escribir, editar, buscar, parche | ✅ | ✅ | ✅ | ✅ | — |
| Edición tolerante a Unicode y a finales de línea | no (exacta) | ✅ 4 niveles | ✅ por región | 🟡 Unicode ✅; CR solitario y archivos mixtos ❌ | 7.8 |
| Rechazo de archivos no UTF-8 | ✅ | ✅ | ❌ | ❌ **confirmado**: los decodifica con U+FFFD y los reescribe degradados | 7.8 |
| Herramientas en paralelo, con las de efectos en orden | n/v | ✅ lecturas juntas, el resto exclusivo | n/v | 🟡 todo corre en paralelo, lecturas y escrituras; sin exclusión | 7.3 |
| Reparación de la entrada de herramientas | n/v | n/v | ✅ | 🟡 nombre y llamada MCP diferida; argumentos mal tipados ❌ | 7.13 |
| Cuadernos Jupyter | ✅ | n/v | n/v | ❌ | 7.15 |
| Imágenes y PDF | ✅ | ✅ | ✅ | ✅ | — |
| Web: fetch y búsqueda | ✅ | ✅ | ✅ | ✅ (la búsqueda depende del proveedor) | 🅱️ parcial |
| LSP | ✅ | n/v | ❌ (solo esquema) | 🟡 `LAZUNOX_LSP` | 7.2 |
| **Shell** | | | | | |
| Segundo plano, leer y matar | ✅ | ✅ | ✅ | ✅ | — |
| Aviso por línea de salida (Monitor) | ✅ | n/v | n/v | ✅ `avisar_si` | — |
| Salida larga a archivo con vista previa | ✅ | ✅ | ✅ | ✅ 30 KB y archivo completo 7 días | — |
| Análisis de comandos compuestos | ✅ endurecido | ✅ conservador | ✅ | 🟡 sin auditar | 7.7 |
| **Permisos y seguridad** | | | | | |
| Reglas allow/ask/deny por comodín | ✅ | ✅ | ✅ | ✅ | — |
| «Siempre» persistente y editable | ✅ | n/v | ✅ | 🟡 se guarda en disco; **no se puede listar, editar ni borrar** (nadie llama a `olvidar`) | 7.22 |
| Rutas protegidas | ✅ | ✅ | n/v | ✅ | — |
| Modo plan | ✅ | n/v | n/v | 🟡 `LAZUNOX_PLAN` | 7.2 |
| Políticas duras de nivel superior | ✅ ajustes gestionados | n/v | ✅ `policies` | ❌ | 7.20 |
| Auto-revisión de permisos | ✅ modo auto | ✅ guardian | n/v | 🟡 solo sugiere | 7.16 |
| Disyuntor de denegaciones | ✅ | ✅ | — | ❌ | 7.16 |
| Sandbox del sistema | ✅ (apagado; sin Windows nativo) | ✅ | n/v | 📱 Seatbelt y WSL2 | — |
| Red con lista de dominios | ✅ | ✅ | n/v | 📱 solo Tareas | D2 |
| Credenciales: centinela o enmascarado | ✅ `mask` | parcial | n/v | 📱 proxy en Tareas; sanitizador ❌ | 7.5 |
| **Ganchos y extensión** | | | | | |
| Ganchos por comando | ✅ 33 eventos | ✅ 14 | plugins | 🟡 10 eventos | 7.6 |
| Ganchos `mcp_tool`, `prompt`, `http` | ✅ | ✅ `mcp_tool` | ❌ | ❌ | 7.6 |
| `updatedInput`, filtro `if`, `onFailure` | ✅ | ✅ `updatedInput` | n/v | 🟡 `updatedInput` ✅ (validado contra el esquema); `if` y `onFailure` ❌ | 7.6 |
| Confianza de ganchos con hash | n/v | ✅ | — | 🟡 solo el archivo de la app | 7.6 |
| Plugins, skills, reglas por ruta | ✅ | ✅ | ✅ | ✅ | — |
| Instrucciones jerárquicas | ✅ | ✅ | ✅ | ✅ | — |
| `@imports` dentro de las instrucciones | ✅ hasta 4 niveles | n/v | n/v | ❌ confirmado | 7.9 |
| Diferencias de instrucciones | n/v | n/v | ✅ | ❌ | 7.9 |
| Memoria automática | ✅ | ✅ opt-in con cuota | n/v | 📱 | — |
| **Agentes** | | | | | |
| Subagentes definidos por el usuario | ✅ | ✅ TOML | ✅ | ✅ | — |
| Segundo plano, esperar y cancelar | ✅ | ✅ | ✅ | ✅ | — |
| Tope de simultáneos | 20 | 6 | n/v | ✅ 8 | — |
| Fork con la conversación | ✅ por defecto | ✅ | n/v | 🟡 | 7.2 |
| Reanudar por ID | ✅ | ✅ | ✅ | ❌ | 7.10 |
| Resultado parcial al agotar pasos | ✅ | n/v | ✅ último paso | ✅ marca `[PARCIAL]`; en el último paso solo avisa (OC2 además fuerza `toolChoice: none`) | 7.10 |
| Esfuerzo y modelo por llamada | ✅ | ✅ | ✅ modelo | ❌ esfuerzo | 7.10 |
| Ayudantes con su propio worktree | ✅ | n/v | n/v | ❌ | D1 |
| Flujos por script | ✅ workflows | n/v | Code Mode | 🟡 Code Mode y `/lote` | 7.17 |
| Equipos de agentes | experimental | n/v | — | — | 🅱️ experimental allá también |
| Objetivo y presupuesto | ✅ | ✅ `/goal` | n/v | ✅ (prompt a afinar) | 7.14 |
| Verificador y revisor | ✅ | ✅ `/review` | n/v | ✅ | 7.14 |
| **Contexto y sesión** | | | | | |
| Compactación automática y manual | ✅ | ✅ | ✅ | ✅ | — |
| Umbral anticipado y por modelo | ✅ | ✅ | ✅ | 🟡 solo por configuración | 7.2 |
| Reinyección tras compactar | ✅ | ✅ | ✅ | ✅ | — |
| Resumen validado, sin resumen parcial | n/v | ✅ | ✅ plantilla | 🟡 | 7.9 |
| Compactación en segundo plano | n/v | ✅ | experimental | ❌ | 7.9 (medir) |
| Compactación ociosa | ✅ | n/v | n/v | ❌ | 🅱️ depende de la caché de 1 h |
| Búsqueda diferida de herramientas | ✅ por defecto | ✅ BM25 | n/v | 🟡 apagada por defecto; con `auto` exige 4 000 tokens diferibles | 7.2 |
| Puntos de control y rebobinar | ✅ (sin shell) | n/v | ✅ | ✅ incluye shell | — |
| Worktree para la sesión principal | ✅ | ✅ | ✅ | ❌ | 7.11 |
| Tareas programadas y espera | ✅ en sesión | nube | ❌ | ❌ | 7.12 |
| **MCP** | | | | | |
| Cliente, OAuth, tiempos máximos | ✅ | ✅ | ✅ | ✅ | — |
| Formularios (elicitation) | ✅ | n/v | ✅ | ✅ (app 1.7.5) | — |
| Resultados binarios o imágenes de MCP a archivo | ✅ | n/v | ✅ | 🟡 imágenes en base64 al contexto sin tope; audio descartado | 7.21 |
| **Observabilidad y entorno** | | | | | |
| Tokens por paso, aciertos de caché y su causa | ✅ `/cost` | n/v | n/v | 🟡 solo en el banco | 7.18 |
| Telemetría | opcional | opt-out | ninguna en el motor | ✅ ninguna, vigilada | — |
| Respaldo de modelo | ✅ | ✅ | n/v | 🟡 sin configurar | 7.2 |
| Modelos locales (Ollama, LM Studio) | por puerta | ✅ | ✅ | ✅ | — |
| Modo sin interfaz y servidor | ✅ | ✅ | ✅ | ✅ | — |
| Windows nativo | ✅ | ✅ | ✅ | ✅ (`cmd` con acentos ❌) | límite conocido |

Las filas que decían «por comprobar» se cerraron el 2026-10-26 leyendo el código del fork (rama `feat/lazunox12`, commit `b3ccb17`); lo que sigue con «n/v» en la columna de los competidores no se ha verificado.

## 2b. Lo que queda fuera (clase B) y por qué

| Qué | Por qué |
|---|---|
| Clasificador o guardian **de su nube** (modelos de Anthropic o de OpenAI) | Exige su cuenta o su cuota. Se construye uno local (7.16), que es otra cosa |
| Equipos de agentes (CC), tablón de mensajes entre agentes (Codex) | Experimentales también allá; unas 7 veces más tokens. Se reabren con datos del comparativo |
| Memorias de Codex, voz, acceso remoto, rutinas en la nube, tienda de plugins, modelos «free» de OpenCode | Nube, cuenta o cuota de terceros |
| Telemetría y analítica | No se copia; nuestra prueba `sin-red-de-opencode` ya la veta |
| Compactación ociosa | Depende de la caché de 1 hora del proveedor; se reabre si el proveedor muestra aciertos de caché |
| `get_context_remaining` y modo «token budget» de Codex | Ya descartados en la Ola 6: un dato que cambia en cada paso rompe el prefijo de caché |
| Salida estructurada con `--json-schema` | Sin valor para el usuario de la app |
| Renombrar el motor (etapas b, c, d) | Decisión del 2026-10-24: versión aparte |

## 2c. Corrección de suposiciones del primer borrador (tras leer el código)

- **Respuesta cortada**: ni Codex ni OpenCode reintentan a ciegas. OpenCode **le dice al modelo** que parta el trabajo; Codex lo trata como terminal. Por eso 7.4 es guiar, no repetir.
- **Credenciales**: Codex solo enmascara lo que **se muestra**; Claude Code usa un centinela con un proxy, que en Tareas ya tenemos. Por eso 7.5 es un sanitizador.
- **Reparación de entrada** (OpenCode): hallazgo nuevo (7.13).
- **Mayúsculas y minúsculas en macOS** en Codex: no se encontró en el código; no se cuenta como hecho.

## 3. Paquetes

Esfuerzo: S ≤ 3 días, M ≤ 2 semanas, L más. Riesgo = riesgo de seguridad **de implementarlo**.

| # | Paquete | Origen | Esf | Riesgo | Tanda |
|---|---|---|---|---|---|
| 7.1 | Banco: tareas nuevas y línea base de 3 corridas | Ola 6.1 sin cerrar | M | Bajo | A |
| 7.2 | Cerrar las filas «por comprobar» y decidir con datos qué se enciende | Existen y están apagadas | M | Bajo | A |
| 7.3 | Paralelismo seguro: lecturas juntas, herramientas con efectos en orden | Codex | S | Medio | A |
| 7.4 | Respuesta cortada por el límite de salida | OpenCode 2.x | S | Bajo | A |
| 7.8 | Edición más segura | Los tres | S | Bajo | A |
| 7.13 | Reparación de la entrada de herramientas | OpenCode 2.x | S | Bajo | A |
| 7.18 | Observabilidad local: tokens por paso y aciertos de caché | Claude Code | S-M | Bajo | A |
| 7.5 | Credenciales: sanitizador de lo que se muestra y se guarda | Codex, Claude Code | S-M | Medio | B |
| 7.6 | Ganchos completos | Claude Code, Codex | M | Medio | B |
| 7.7 | Auditoría de permisos del shell y del sandbox | Claude Code, Codex | M | Alto (zona intocable) | B |
| 7.20 | Políticas duras de nivel superior | OpenCode 2.x, Claude Code | S-M | Medio | B |
| 7.21 | Resultados binarios de MCP: a archivo y con tope | Claude Code, OpenCode 2.x | S | Bajo | A |
| 7.22 | Gestionar los «siempre» guardados: listar, editar, borrar | OpenCode 2.x, Claude Code | S | Medio | B |
| 7.9 | Contexto: diferencias de instrucciones y robustez de la compactación | OpenCode 2.x, Codex | M | Bajo | C |
| 7.10 | Ayudantes reanudables, parciales y con esfuerzo propio | Los tres | S-M | Medio | C |
| 7.11 | Worktree para la sesión principal | Los tres | M | Medio | C |
| 7.14 | Objetivo y revisor: afinar con lo de Codex | Codex | S | Bajo | C |
| 7.15 | Cuadernos Jupyter | Claude Code | S | Bajo | C |
| 7.12 | Tareas programadas y espera (reabierto, D3) | Claude Code | M | Medio | C |
| 7.16 | Auto-revisión de permisos, local y acotada (reabierto, D4) | Claude Code, Codex | L | **Alto** | D |
| 7.17 | Flujos por script sobre Code Mode (reabierto, D5) | Claude Code | L | Medio | D |
| 7.19 | Comparativo justo contra OpenCode 2.1.4 y Codex | Meta «mejor» | M | Medio (corre código de terceros) | A y D |

### 7.1 Banco: tareas nuevas y línea base (requisito previo)

**Por qué**: sin n = 3 y tareas que no salgan siempre bien, no se mide ninguna mejora. Si 6.1 ya quedó hecho en la rama de la app, solo se reutiliza y se amplía.

**Tareas nuevas** (`scripts/engine-bench/tareas/`, formato `TNN-*.mjs` con verificador determinista):

| Tarea | Qué pide | Qué mide |
|---|---|---|
| T24 | Leer 8 archivos pequeños y resumirlos | Lecturas en paralelo (7.3) |
| T25 | Un proveedor falso que corta la salida (`finish: length`) a mitad de una llamada con un archivo grande | Respuesta cortada (7.4) |
| T26 | Un archivo Latin-1 y otro con CRLF que hay que editar | Edición segura (7.8) |
| T27 | Un modelo falso que manda el objeto como texto, un número como cadena y `null` por opcional | Reparación de entrada (7.13) |
| T28 | Un guion que imprime una clave falsa conocida al hacer `env` | Credenciales (7.5) |
| T29 | AGENTS.md que cambia a mitad de una sesión larga | Diferencias de instrucciones (7.9) |

**Línea base**: motor `lazunox.12` con todo apagado, 3 corridas por tarea, repartidas en varios días (`--reanudar`), anotando fecha e ID del modelo.

**Hecho cuando**: existe `linea-base/real-ola7-<fecha>.json` con n = 3 por tarea, y al menos 2 de las tareas nuevas **no** salen 3/3 con el motor actual (si salen todas 3/3, se endurecen).

**Seguridad**: solo en el contenedor del VPS. Las claves de T28 son falsas y las genera el banco.

### 7.2 Cerrar las filas «por comprobar» y decidir con datos qué se enciende

**Hecho el 2026-10-26 (lectura del código del fork):** las filas «por comprobar» quedaron cerradas y la matriz (§2) las refleja. Resultado: formato de salida del shell ✅, tope de pasos y resultado parcial ✅; `@imports`, gestión de los «siempre» y rechazo de no UTF-8 ❌; MCP binario, reparación de argumentos, paralelismo, búsqueda diferida y ganchos 🟡. Lo que queda aquí es medir y decidir qué se enciende.

**Candidatas** (existen en el fork; qué las enciende):

| Función | Variable o ajuste | Qué se espera |
|---|---|---|
| Búsqueda diferida de herramientas | `LAZUNOX_TOOL_SEARCH=auto` | Menos contexto con muchos MCP. Referencia: Claude Code difiere **todas** las MCP por defecto (con `auto` el umbral es el 10 % de la ventana, y las instrucciones cargadas por adelantado se limitan a 4 096 caracteres); Codex las busca con BM25. Comprobar que el umbral nuestro (`_MIN_TOKENS`) es razonable |
| Ayudantes con contexto mínimo | `LAZUNOX_AYUDANTES_MINIMOS=1` | −35 % en tokens de las hijas (criterio de 6.3) |
| Resumen robusto | `LAZUNOX_RESUMEN_ROBUSTO=1` | Menos resúmenes vacíos |
| Avisos de cambios y diff del shell | `LAZUNOX_AVISOS_CAMBIOS=1` | Menos trabajo sobre copias viejas |
| Ayudante que hereda la conversación | `LAZUNOX_AYUDANTE_HEREDADO=1` | Claude Code lo dejó activo por defecto en la 2.1.232 |
| Umbral de compactación anticipado | `compaction.umbral` | −30 % en p90 de tokens por paso |
| Lista de tareas (`todowrite`) opcional según el modelo | nueva | Claude Code **quitó** las herramientas de tareas en los modelos nuevos (2.1.268), y en nuestra medición `todowrite` causó la regresión de T10. Medir con y sin |
| LSP y modo plan | `LAZUNOX_LSP=1`, `LAZUNOX_PLAN=1` | Valor para el usuario, no necesariamente para tokens |

**Método**: para cada función, banco con la función encendida contra la línea base de 7.1, 3 corridas, con el mismo modelo. Se enciende **solo** si cumple su criterio de éxito de la Ola 6 y no baja una tarea estable de 3/3.

**Regla**: una función que no se pueda demostrar queda apagada y se anota en `LAZUNOX.md` con el dato. No se promete ahorro sin número, como en la 1.7.7.

**Lo que toca a la app** (aparte, no en el motor): pantallas o ajustes para las que pasen la prueba. El modo plan sigue sin revisión independiente del shell restringido; no se enciende hasta tenerla.

**Hecho cuando**: hay una tabla en `LAZUNOX.md` con cada función, su resultado medido y la decisión.

### 7.3 Paralelismo seguro: lecturas juntas, herramientas con efectos en orden

**Lo que se encontró en el motor (cambia el paquete):** el motor **ya** ejecuta las herramientas de un mismo paso en paralelo, pero **todas por igual**: el SDK de IA lanza cada `execute` en cuanto llega su llamada (`LAZUNOX.md` §416-422, con una prueba `paralelo-lectura.test.ts` que no se leyó; el procesador no serializa nada, `session/processor.ts`). No hay marca de «solo lectura» por herramienta. Es decir, el riesgo es el contrario del que asumía el primer borrador: dos `edit` al mismo archivo, o un `shell` con un `write`, pueden correr a la vez.

**Cómo lo hace Codex** (`core/src/tools/parallel.rs`, `tools/src/tool_executor.rs`): cada herramienta declara si admite paralelismo (por defecto no). Las que lo admiten toman un candado de **lectura** compartido y las demás uno **exclusivo**; los resultados se devuelven en el orden pedido. En MCP se paraleliza solo si el servidor lo declara o la herramienta anuncia `readOnlyHint`.

**Qué hacemos**: una marca `soloLectura` por herramienta (lista cerrada: `read`, `glob`, `grep`, `skill`, `task_list`, `tool_search`, y MCP con `readOnlyHint`) y un candado de lectura/escritura alrededor del `execute`. Las lecturas siguen en paralelo; `shell`, `edit`, `write`, `patch`, `task` y el resto toman el candado exclusivo y esperan a las demás. Los permisos se evalúan igual; si dos solicitudes necesitan preguntar, se encolan una a una.

**Restricciones**: no cambia qué herramientas existen ni sus permisos; un fallo no cancela a las demás; interruptor `LAZUNOX_PARALELISMO_SEGURO=0`. Riesgo medio: toca el camino caliente de todas las herramientas, así que lleva sus pruebas de carrera.

**Pruebas**: `test/lazunox/paralelismo-seguro.test.ts` (dos ediciones al mismo archivo no se pisan, tres lecturas corren juntas, el orden de los resultados se conserva, un permiso pendiente no bloquea las lecturas ya lanzadas).

**Hecho cuando**: T24 (lecturas) baja pasos sin bajar el éxito y una tarea nueva con dos escrituras simultáneas al mismo archivo pasa 3/3 con el candado y falla sin él.

### 7.4 Respuesta cortada por el límite de salida

**Cómo lo hacen** (corrige el primer borrador, que decía «reintentar una vez»):
- **OpenCode 2.x** (`core/src/session/runner/llm.ts`, ~l.303-345): si la respuesta termina por límite de salida, cada llamada a herramienta con argumentos incompletos **falla** con un mensaje que pide partir el trabajo en llamadas más chicas y muestra un extracto de 2 048 caracteres de lo que mandó. Si no había llamada, se inyecta un aviso sintético «tu última respuesta llegó al límite de salida, divide el trabajo». Tras **3 respuestas seguidas** con corte, falla con un error propio. Una transmisión cortada a mitad se continúa con un mensaje sintético.
- **Codex** (`core/src/responses_retry.rs`): un corte por límite de salida es **terminal y no se reintenta**. Solo se reintenta la transmisión cerrada sin terminar. Si una llamada queda sin resultado, inserta uno sintético «aborted» (nosotros ya lo hacemos en `message-v2.ts`).

**Qué hacemos**: el diseño de OpenCode (guiar al modelo, no repetir a ciegas), con su tope de 3. Más el respeto de `Retry-After` que ya existe.

**Restricción**: nunca se reejecuta una herramienta con efectos cuyo resultado no se conoce. Interruptor `LAZUNOX_SALIDA_CORTADA=0`.

**Pruebas**: `test/lazunox/salida-cortada.test.ts` y `PROBE_ONLY=salida` con el proveedor falso.

**Hecho cuando**: T25 pasa 3/3 con el mecanismo y falla sin él.

### 7.5 Credenciales: sanitizador de lo que se muestra y se guarda

**Qué hacen**:
- **Codex** (`secrets/src/sanitizer.rs`): cuatro expresiones regulares (`sk-` + 20 o más alfanuméricos, `AKIA` + 16, `Bearer` + 16 o más, y `api_key|token|secret|password` seguido de `:` o `=` y un valor de 8 o más), todas reemplazadas por `[REDACTED_SECRET]`, con límites de palabra y pruebas de falsos positivos. Se aplica al **comando que se muestra en la interfaz**, a las memorias y a los errores de login. **No** lo encontraron aplicado a lo que se envía al modelo.
- **Claude Code**: otro diseño. Con `mode: "mask"` el comando solo ve un valor centinela y el **proxy del sandbox** pone el valor real en las peticiones salientes a hosts permitidos. Requiere terminar TLS en el proxy (experimental) y solo se honra en los ajustes del usuario, nunca en los del repo.

**Qué hacemos**:
1. **Ya lo tenemos en Tareas**: `CredentialProxy` da al motor un valor falso y guarda la clave real fuera del sandbox. No se rehace.
2. **Nuevo**: el sanitizador de Codex (mismas cuatro formas, ampliables con las claves que la app conozca en la sesión) aplicado a lo que **se muestra y se guarda**: comando en la interfaz, historial en disco, registros y diagnóstico.
3. **Opcional y medido**: aplicarlo también a la salida de `shell` que ve el modelo, detrás de un ajuste. Es heurística, no un límite, y se documenta así.

**Pruebas**: `test/lazunox/sanitizar.test.ts`, con casos de falsos positivos («Bearer of good news», hashes, ids largos); `PROBE_ONLY=sanitizar`.

**Hecho cuando**: T28 pasa con la clave falsa fuera de lo mostrado y guardado, y los falsos positivos en el banco son 0. Si toca `docs/SEGURIDAD.md`, se actualiza.

### 7.6 Ganchos completos

**Hoy** (`plugin/lazunox-ganchos.ts`, leído el 2026-10-26): 10 eventos (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `PreCompact`, `PostCompact`, `Stop`, `SessionStart`, `UserPromptSubmit`, `SubagentStop`), desde el archivo que fija la app (`LAZUNOX_HOOKS_FILE`). Entienden `decision: "block"` con `reason`, código de salida 2 (bloquear), `additionalContext`, `updatedToolOutput` (texto, hasta 64 KB; el original va a la carpeta de salidas) y **`updatedInput`, que ya se valida contra el esquema de la herramienta** y se ignora si no vale. `PermissionDenied` solo informa.

**Eventos que faltan** (lista real de Codex, `protocol/src/protocol.rs`): `PermissionRequest`, `SubagentStart`, `Interrupt`, y de Claude Code `PostToolBatch` (`SubagentStop` ya existe). Codex tiene además `PreModelRequest`/`PostModelRequest`, que no se copian de momento.

**Semántica a copiar** (confirmada en código y docs):
- `updatedInput` **reemplaza el objeto de entrada completo** (hay que repetir los campos sin cambios), y los permisos se **reevalúan contra la entrada ya modificada**; un gancho nunca amplía permisos. En Codex, para comandos exige un campo de texto `command`.
- Filtro `if`: **una sola regla** con la sintaxis de permisos (`Bash(git *)`, `Edit(*.ts)`), solo en eventos de herramienta; si no puede analizar el comando, el gancho corre igual. Es de mejor esfuerzo, no una frontera de seguridad.
- `onFailure: "block"`: si el gancho falla, expira o devuelve error, la acción **se bloquea** (falla cerrado). Por defecto, la acción sigue.
- Salida grande: se guarda completa en un archivo de sesión y al modelo llega una vista previa con el principio y el final más la ruta. Codex usa 2 500 tokens (configurable); Claude Code 10 000 caracteres y una vista previa de 2 000.
- Confianza: Codex marca cada gancho como gestionado, no confiable, confiable o modificado, con **hash del contenido**, y solo ejecuta los gestionados o confiables. Nosotros ya solo aceptamos el archivo de la app; se añade el hash para detectar cambios.

**Orden**: 1) `onFailure: block`, 2) filtro `if` (`updatedInput` ya existe), 3) eventos nuevos, 4) volcado a disco.

**Restricción**: un proyecto no puede traer ganchos propios; solo el archivo de la app. **Pruebas**: `test/lazunox/ganchos2.test.ts`; `PROBE_ONLY=ganchos2`. **Hecho cuando**: cada evento se dispara en el probe real y el ejemplo `filtrar-pruebas.cjs` sigue funcionando.

### 7.7 Auditoría de permisos del shell y del sandbox

**Por qué**: Claude Code lleva más de 20 versiones endureciendo esto; Codex tiene un diseño conservador que conviene comparar con el nuestro.

**Batería de casos** (de los arreglos de Claude Code, 2.1.216-2.1.280):
- compuestos con redirecciones dentro de listas `&&` o negaciones;
- comandos ocultos en condicionales `[[ ]]` de zsh;
- reglas `ask` o `deny` saltadas dentro de subshells o sustituciones;
- `deny` de lectura que no cubría valores de opciones (`--ignore-revs-file=.env`, `-f.env`, `@archivo`) ni `cd DIR && cat FILE`;
- `grep -r` o `cp -r` sobre un directorio que contiene un archivo denegado;
- dos `cd`, subshell o `cd` + `git` que saltaban el aviso;
- symlinks (`/etc`, `/tmp`, `/var` en macOS) juzgados por su ruta real, también al escribir y entre la comprobación y el uso;
- un comodín de «comandos excluidos» que eximía todo el comando compuesto.

**Reglas de su documentación a imitar**: cada subcomando debe coincidir por separado; `deny` y `ask` coinciden si **cualquier** subcomando coincide; un comando colgante (`cmd &&`) no es analizable; envoltorios que se quitan antes de comparar (`timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`), mientras que `watch`, `setsid`, `ionice`, `flock` y `find` con `-exec`/`-delete` no se autoaprueban.

**De Codex** (`shell-command/src/bash.rs`, `execpolicy`, `seatbelt.rs`):
- solo se auto-reconoce una secuencia de **palabras simples** unidas por `&&`, `||`, `;` o `|`; paréntesis, redirecciones, sustituciones y control de flujo se rechazan (se pide permiso);
- para `bash -lc` se desenvuelve el script, y los literales extraídos de scripts complejos **solo sirven para detectar peligro, nunca para probar que algo es seguro**;
- más de 8 niveles de envoltorios se marca peligroso;
- el sandbox rechaza raíces escribibles con componentes que son symlinks, y existe una comprobación de integridad de las dependencias de contención;
- endurecimiento del proceso: sin volcados de memoria, sin `ptrace`, y se borran `LD_*` y `DYLD_*` del entorno (comprobar contra nuestro `lazunox-env`).

**De OpenCode** (`shell/scan.ts`): marca como «opacos» los comandos con sustitución, heredoc o `eval`, y guarda el «siempre» por prefijo con una tabla de aridad (`git commit` = 3 palabras).

**Procedimiento (zona intocable, `AGENTS.md` §7)**:
1. Escribir la batería como pruebas que **documenten** el comportamiento actual, sin tocar `sandbox-profile.ts` ni `sandbox.ts`.
2. Si aparece un fallo real, cambio mínimo con prueba, revisión independiente de un agente que no lo escribió, y `npm run zonas:actualizar -- "motivo"`.
3. Lo del motor (análisis del shell) va en el fork; lo del sandbox va en la app.

**Hecho cuando**: hay un informe con cada caso, su resultado y qué se corrigió; ningún caso queda sin dueño.

### 7.8 Edición más segura

**Qué hace cada uno**:
- **Claude Code**: `Edit` se niega (archivo intacto) si el archivo no es UTF-8 válido, salvo que empiece con BOM UTF-16 LE; `Write` guarda en UTF-8 y se niega si el contenido nuevo trae U+FFFD. CRLF: no documentado.
- **Codex**: `apply_patch` detecta CRLF, CR y LF por línea y los conserva; la lectura falla si no es UTF-8.
- **OpenCode 2.x**: compara contra una vista LF y reescribe **preservando los finales de línea por región** (incluso en archivos mixtos) y el BOM; los bytes inválidos se degradan a U+FFFD, **sin protección**.

**Qué hacemos**:
1. **Comprobado el 2026-10-26 en el código:** `edit` detecta CRLF si el archivo tiene al menos un `\r\n` y convierte **todo** el texto nuevo a ese final (un CR solitario no se trata, y en archivos mixtos las líneas LF pueden no coincidir); conserva el BOM; y **no rechaza los archivos que no son UTF-8: los decodifica con U+FFFD y los reescribe degradados** (`util/bom.ts`, `TextDecoder` sin `fatal`). `write` y `apply_patch` hacen lo mismo. Eso es **pérdida de datos real**, no solo una brecha: se arregla primero, con pruebas que documenten el comportamiento actual antes de cambiarlo.
2. Negarse a editar o escribir si el archivo no es UTF-8 válido (mensaje claro), y si el contenido nuevo trae U+FFFD.
3. Conservar CRLF, CR, LF y BOM por región, como OpenCode.
4. `read` de un archivo grande solo con una bandera explícita del modelo.

**Pruebas**: `test/lazunox/edicion-segura.test.ts`. Interruptor `LAZUNOX_EDICION_SEGURA=0`. **Hecho cuando**: T26 pasa 3/3 y ningún archivo del banco cambia de codificación o de finales de línea sin pedirlo.

### 7.9 Contexto: diferencias de instrucciones y robustez de la compactación

**Diferencias de instrucciones** (OpenCode, `core/src/instructions/index.ts`, `session/instruction-state.ts`): cada fuente (AGENTS.md, habilidades, fecha, entorno) tiene una clave y un valor con hash. Por sesión se guarda una **línea base fija** y los valores actuales; en cada turno se calcula la diferencia de hashes y, si hay cambio, se publica **un mensaje con solo lo añadido, cambiado o quitado**. La línea base **no se mueve**, así la caché del prompt se conserva. Las habilidades tienen su propio aviso («hay habilidades nuevas», «ya no está disponible: …»).

**Qué hacemos**: lo mismo sobre `session/instruction.ts` y la lista de habilidades, comprobando primero cuánto cuesta hoy un cambio de AGENTS.md a mitad de sesión (T29). Interruptor `LAZUNOX_INSTRUCCIONES_DIFF=0`.

**Robustez de la compactación** (comparar con `session/compaction.ts` nuestro antes de cambiar):
- Codex: el historial se reemplaza **solo si la compactación termina bien**; un resumen vacío es error (no queda un resumen parcial). Si el contexto se excede al compactar, quita el elemento más antiguo y reintenta.
- OpenCode: si la petición de resumen es demasiado grande, la reduce por pasos (85 %, 70 %, 50 %, 35 %) y recorta primero las salidas de herramientas. Ya tenemos `ajustarConversacion` y el resumen robusto (6.4); aquí solo se comparan los casos de borde.
- Claude Code: tras compactar, el estado de git que se muestra es el actual, no el del inicio.

**`@imports` en las instrucciones** (comprobado ❌ en `session/instruction.ts`): Claude Code deja que `AGENTS.md`/`CLAUDE.md` incluya otros archivos con `@ruta`, hasta 4 niveles. Qué hacemos: lo mismo, con **detección de ciclos**, tope de 4 niveles, solo dentro de la carpeta del proyecto (nunca `~`, `.env`, claves ni rutas fuera) y un tope de bytes por archivo y en total. Interruptor `LAZUNOX_IMPORTS=0`; pruebas `test/lazunox/imports.test.ts` (ciclo, profundidad, ruta fuera, archivo sensible).

**Compactación en segundo plano**: **solo se mide**. En OpenCode es experimental: empieza al 85 % del techo y con al menos 64 000 tokens, guarda un resumen por sesión (máx. 2 fallos) y solo lo usa si la cola nueva es corta (≤ 2 veces `keep`). Gasta tokens si no se usa.

**Compactación ociosa**: descartada (§1).

**Hecho cuando**: T29 mejora sin bajar el éxito, y la lista de casos de borde de la compactación tiene su prueba.

### 7.10 Ayudantes reanudables y resultados parciales

**Qué hacen**:
- **Claude Code**: reanudar por el ID del ayudante (`SendMessage`) retoma **todo su historial**; Explore y Plan son de un solo uso; reanudar toma un cupo nuevo sin comprobar el límite. Si un ayudante llega a `maxTurns`, devuelve un resultado marcado «parcial» con la pista para continuarlo (2.1.246). Los resultados llegan bajo una cabecera «salida de subagente» e indentados, para que no se confundan con instrucciones (2.1.277).
- **OpenCode**: la herramienta `subagent` acepta el `sessionID` de una hija propia (debe ser hija de la sesión actual) y continúa esa conversación. En el **último paso** no quita las herramientas (para no romper la caché): manda `toolChoice: none` y un aviso para que resuma.
- **Codex**: `resume_agent` solo reabre si no hay un proceso vivo.

**Qué hacemos**:
- `task` gana `esfuerzo` por llamada (Claude Code 2.1.296) y `session_id`. La sesión debe ser hija de la actual; **conserva los permisos con que nació** (nunca más que la sesión que la lanza) y **cuenta contra el tope** de ayudantes.
- **El resultado `[PARCIAL]` ya existe** (`agent/parcial.ts`, `tool/task.ts`); solo falta añadirle el `session_id` para poder continuarlo. En el **último paso** el motor hoy solo agrega el aviso de pasos agotados y deja todas las herramientas (`session/prompt.ts`); OpenCode 2.x además fuerza `toolChoice: none`, y conviene copiarlo, conservando la lista de herramientas para no romper la caché.
- Su informe sigue acotado a 4 096 bytes, ya marcado como no confiable; se añade la cabecera y la indentación.

**Pruebas**: `test/lazunox/ayudante-reanudable.test.ts`; `PROBE_ONLY=reanudar`. **Hecho cuando**: una hija reanudada conserva su contexto y no puede ampliar permisos, y el resultado parcial se puede continuar.

### 7.11 Worktree para la sesión principal

**Qué hacen**:
- **Codex** (`worktree/src/lib.rs`): crea con `git worktree add --detach --no-checkout` bajo una raíz configurada; deshace si falla; al borrar exige que sea uno gestionado, que no sea el actual y que no tenga archivos ignorados locales; se limpia solo guardando los 15 últimos.
- **OpenCode** (`tool/plugin/opencode.ts`): `worktree_create`, `worktree_list` y `worktree_remove`; borrar exige permiso de **edición** sobre el directorio y falla si hay cambios, salvo `force`.
- **Claude Code**: entrar a una ruta fuera de `.claude/worktrees/` pide una aprobación que ninguna regla salta. Dentro del worktree bloquea ediciones y comandos hacia el checkout principal y las redirecciones de git (`-C`, `--git-dir`, `GIT_DIR`), pero **no rastrea `cp` ni redirecciones del shell**.

**Qué hacemos**: herramientas `worktree_entrar` y `worktree_salir` que cambian el directorio de la **sesión principal** (no de ayudantes). El worktree vive dentro de la carpeta ya autorizada; borrar exige aprobar la edición y se niega si hay cambios; el plan-gate y las rutas protegidas siguen aplicando. Los límites de Claude Code se documentan como límites propios.

**Por qué cabe**: el motivo para descartar los subagentes con worktree propio era que sus eventos saldrían por el canal de otra carpeta. Aquí la sesión principal no cambia de canal.

**Antes de empezar**: confirmar con la app que el directorio de la sesión puede cambiar sin romper `conn.directory` ni los puntos de restauración. Si no se puede, el paquete se descarta.

### 7.12 Tareas programadas y espera (reabierto por la meta del 100 %; decisión D3)

**Qué hace Claude Code**: `CronCreate`/`CronList`/`CronDelete` (cron de 5 campos, recurrente o una vez, hasta 50 por sesión), atadas a la sesión: solo disparan con la sesión abierta e inactiva, se encolan entre turnos, caducan a los 7 días, llevan un retraso aleatorio y no recuperan disparos perdidos. `/loop` y `ScheduleWakeup` (de 1 minuto a 1 hora; sin reprogramar, un respaldo de unos 20 minutos y termina). Para algo persistente recomienda rutinas en la nube, que no usamos. Codex y OpenCode no tienen un equivalente local.

**Qué hacemos (mejor que ellos)**:
1. `programar`, `listar_programadas` y `borrar_programada` con la misma semántica acotada, y `esperar_y_continuar` (de 60 s a 1 h, con respaldo).
2. Lo programado se guarda como metadato de la sesión; **lo persistente lo ejecuta Rutinas de la app**, que ya existe y ya pide el aviso de términos de OpenCode antes de correr algo sin sesión. Así lo programado sobrevive a un reinicio sin nube.

**Restricciones**: cada disparo pasa por la puerta del plan y por los permisos como cualquier turno; un disparo no puede usar herramientas que el usuario no haya permitido; tope de 50; sin disparos si la sesión está ocupada; todo apagable con `LAZUNOX_PROGRAMADAS=0`. **Si Ben no confirma D3, el paquete no se hace.**

**Hecho cuando**: prueba de disparo en reloj falso, sin recuperación de perdidos, con permisos intactos, y la persistencia vía Rutinas probada en la app.

### 7.13 Reparación de la entrada de herramientas

**Qué hace OpenCode 2.x** (`core/src/plugin/tool-input-repair.ts`): antes de rechazar una llamada, la repara según el esquema: un objeto o arreglo que llegó como texto, un número o booleano que llegó como texto, `null` en lugar de un opcional, tuplas, etc. Para modelos débiles es una fuente muy frecuente de pasos perdidos.

**Hoy**: tenemos `experimental_repairToolCall` (`session/llm.ts`) que solo corrige mayúsculas y minúsculas del nombre y pasa a `invalid`.

**Qué hacemos**: reparación de los argumentos por esquema, en el mismo punto, con lista cerrada de reparaciones seguras (nunca inventar un valor obligatorio).

**Restricciones**: la entrada reparada pasa por los permisos igual que cualquier otra; si la reparación es ambigua, se rechaza con un mensaje claro. Interruptor `LAZUNOX_REPARAR_ENTRADA=0`.

**Pruebas**: `test/lazunox/reparar-entrada.test.ts` (cada caso reparable y los no reparables); `PROBE_ONLY=reparar`. **Hecho cuando**: T27 pasa 3/3 con la reparación.

### 7.14 Objetivo y revisor: afinar con lo de Codex

**`/goal` de Codex** (`ext/goal`): el modelo decide que terminó, pero la plantilla `continuation.md` le exige una **auditoría de cierre**: derivar los requisitos, buscar evidencia actual de cada uno, contar la evidencia débil como no lograda y no marcar completo por agotar el presupuesto. «Bloqueado» solo tras 3 turnos seguidos con el mismo bloqueo. Hay chequeos de «sin progreso» y de «espera verificada». El objetivo admite hasta 4 000 caracteres y estados activo, pausado, bloqueado, limitado por uso o presupuesto, y completo.

**Revisión de Codex** (`prompts/templates/review/rubric.md`): solo errores **introducidos por el cambio**, accionables y discretos.

**Qué hacemos**: comparar con `session/objetivo.ts` y los prompts del revisor, y adoptar las partes que mejoren la precisión (auditoría de cierre, regla de 3 bloqueos, rúbrica de bugs introducidos). Solo texto de prompts y topes; no cambia permisos.

**Hecho cuando**: en el banco (T14 y una tarea de objetivo) el falso «terminado» baja sin bajar el éxito.

### 7.15 Cuadernos Jupyter

**Qué**: herramienta `cuaderno_editar` para archivos `.ipynb` (Claude Code tiene `NotebookEdit`): reemplazar, insertar o borrar celdas por identificador o índice. **No ejecuta nada.**

**Restricciones**: valida el JSON antes y después; conserva metadatos, versión de formato y salidas de las celdas que no toca; permiso `edit`; respeta las rutas protegidas y la política de carpetas.

**Pruebas**: `test/lazunox/cuaderno.test.ts` (celdas de código y de texto, índice fuera de rango, JSON roto, archivo grande). **Hecho cuando**: el banco edita un cuaderno de ejemplo sin perder salidas.

### 7.16 Auto-revisión de permisos, local y acotada (reabierto; decisión D4)

**Qué hacen**: Claude Code (modo auto, hoy el predeterminado en interactivo) usa un clasificador con un modelo de Anthropic que revisa cada acción; descarta las reglas de permiso demasiado amplias al entrar, y se pausa tras 3 bloqueos seguidos o 20 en total. Codex (`approvals_reviewer = auto_review`) lanza un subagente aislado que ve una transcripción acotada (por ejemplo 900 tokens por mensaje raíz), con disyuntor de 3 denegaciones seguidas o 10 en una ventana de 50; su modelo es de OpenAI y, si no está, cae al del padre con esfuerzo bajo.

**Qué hacemos (mejor que ellos)**: un revisor **local**, con el modelo gratuito que la persona ya eligió, y con un techo de seguridad que ninguno de los dos tiene:
- solo actúa sobre solicitudes que hoy terminarían en «preguntar» y son de **clase baja**; nunca sobre las de `NEVER_ALONE_PERMISSIONS`, rutas protegidas, fuera de la carpeta autorizada, red nueva, borrado ni control del equipo;
- puede **aprobar o negar**, pero nunca ampliar una regla ni guardar un «siempre»;
- ve una transcripción acotada sin razonamiento oculto; el texto de herramientas y archivos va marcado como no confiable;
- disyuntor: tras 3 negaciones seguidas, o 10 en 50, vuelve a preguntar a la persona;
- queda registrado cada veredicto (sin secretos), visible en la app.

**Condición de entrega** (la que lo hace «mejor», no solo «igual»): una batería de ataques (inyección en el texto de un archivo, comando que parece inocente, ruta con symlink, etc.) donde el revisor **no aprueba nada indebido en ninguna corrida** (falsa aprobación = 0, n ≥ 3). Si con los modelos gratuitos no se logra, el paquete se queda en «solo sugerir» (lo que ya existe) y se documenta así. Apagado por defecto. Es zona de seguridad: cambio mínimo, revisión independiente de un agente que no lo escribió y registro del motivo.

### 7.17 Flujos por script sobre Code Mode (reabierto; decisión D5)

**Qué hace Claude Code** (workflows): el modelo escribe un guion que lanza decenas o cientos de subagentes en segundo plano (hasta 16 a la vez y 1 000 por corrida), con los resultados intermedios en variables del guion y no en el contexto; se puede reanudar y guardar como comando. Gasta muchos tokens.

**Qué hacemos**: exponer dentro de Code Mode las funciones `ayudante()`, `en_paralelo()` y `esperar()`, apoyadas en `task`, `task_wait` y `task_cancel` que ya existen. Los resultados intermedios viven en variables y solo el resumen vuelve al contexto.

**Restricciones**: nuestros topes (8 simultáneos y los límites de Code Mode), no los de ellos; cada ayudante hereda los permisos del padre y nunca más; los informes siguen acotados y marcados como no confiables; apagable con `LAZUNOX_FLUJOS=0`.

**Condición de entrega**: T21 (migración con dependencias) y una tarea nueva de fan-out mejoran con el flujo y los tokens no suben más de lo que ahorra el aislamiento del contexto. Si no, se queda como está (Code Mode, `/lote` y `task_wait`).

### 7.18 Observabilidad local: tokens por paso y aciertos de caché

**Qué hace Claude Code**: `/cost` muestra una línea de caché del prompt (aciertos, fallos y causa probable), y `/usage` desglosa los bucles. Nuestro banco ya calcula tokens enviados por paso, pero solo en el banco.

**Qué hacemos**: la sesión lleva estas cifras y una ruta del motor (`GET /session/:id/uso`) las devuelve: tokens enviados por paso (mediana y p90), aciertos de caché y la causa probable de un fallo (cambió la lista de herramientas, cambió el sistema, caducó), tokens por ayudante. **Todo queda en la máquina.**

**Para qué**: es el instrumento con el que se mide todo lo demás (7.2, 7.9, 7.19) y con el que la app puede mostrar «por qué gastó tanto» sin prometer ahorros.

**Pruebas**: `test/lazunox/uso.test.ts`; `PROBE_ONLY=uso`. **Hecho cuando**: la cifra coincide con la del banco en las mismas corridas.

### 7.19 Comparativo justo contra OpenCode 2.1.4 y Codex

**Por qué**: «mejor» solo vale si se mide en igualdad. Sin APIs de pago.

**Método**:
- Contenedor del VPS, **sin red salvo el proveedor del modelo gratuito**, con una clave de prueba y un HOME vacío. Nada de esto corre en el Mac.
- Mismo modelo gratuito fijado por ID, mismas tareas (T01-T29 más las del banco duro), n = 3, repartido en varios días por la cuota.
- Motores: `lazunox` (la versión a medir), OpenCode 2.1.4 (binario oficial) y Codex con proveedor propio. Se descargan en el contenedor y se verifican por hash antes de usarlos; son código de terceros y se tratan como no confiables.
- Se comparan: éxito por tarea, tokens enviados por paso (mediana y p90), pasos, tiempo, y gasto total.
- Claude Code solo si se puede apuntar a un modelo gratuito por una puerta de enlace compatible; si no, queda fuera de la prueba y se compara por documentación.

**Dos corridas**: una al cerrar la tanda A (para saber dónde estamos) y otra al cerrar la D (para poder decir «mejor»).

**Hecho cuando**: hay una tabla en `docs/` con fecha, ID del modelo, versión de cada motor y los resultados, con sus límites dichos (el modelo gratuito cambia, la cuota limita las corridas).

### 7.20 Políticas duras de nivel superior

**Qué hacen**: OpenCode 2.x (`policies`) puede quitar por completo proveedores, servidores MCP y habilidades, y forzar «denegar» en una herramienta, por encima de todo lo demás. Claude Code lo logra con ajustes gestionados.

**Qué hacemos**: un archivo de política que fija la app (`LAZUNOX_POLICY_FILE`, como los ganchos) con `deny` de proveedores, MCP, herramientas, habilidades y agentes. **Gana a cualquier regla y un proyecto no puede aflojarlo.** Se coordina con la política de la organización de la app (`docs/POLITICA-ORGANIZACION.md`) y con `disableWslTasks`.

**Pruebas**: `test/lazunox/politicas.test.ts` (un repo hostil no puede quitar la política; archivo ausente = sin política; archivo roto = falla cerrado). **Hecho cuando**: el probe confirma que lo denegado no aparece ni se puede invocar.

### 7.21 Resultados binarios de MCP: a archivo y con tope

**Lo que se encontró** (`mcp/invocar.ts`): una imagen devuelta por una herramienta MCP entra al contexto como adjunto `data:` en base64 **sin tope de tamaño**; un recurso binario solo entra si su tipo está en una lista y no pasa un máximo, y si no, queda una nota; el **audio se descarta en silencio**. Solo el texto está acotado (25 000 tokens, el resto a archivo). Una captura grande puede costar decenas de miles de tokens de golpe, que es justo lo que se quiere evitar.

**Qué hacen**: Claude Code (2.1.283) y OpenCode 2.x guardan las imágenes y recursos binarios de los resultados MCP en archivos.

**Qué hacemos**: guardar el binario en la carpeta de salidas del motor (misma retención de 7 días), darle al modelo la ruta, el tipo y el tamaño, y adjuntar la imagen al contexto **solo si el modelo la soporta y pesa menos que un tope** (configurable). El audio se guarda y se avisa, en vez de descartarse.

**Restricciones**: nombres de archivo generados por el motor (nunca el que dice el servidor MCP); tipo comprobado; sin ejecutar nada. Interruptor `LAZUNOX_MCP_BINARIOS=0`. **Pruebas**: `test/lazunox/mcp-binarios.test.ts`. **Hecho cuando**: una captura grande ya no entra entera al contexto y el modelo puede abrirla por ruta.

### 7.22 Gestionar los «siempre» guardados: listar, editar, borrar

**Lo que se encontró** (`permission/siempre-disco.ts`): solo exporta `cargar`, `guardar` y `olvidar`; `olvidar` borra el archivo entero de una carpeta y **nadie la llama**; las rutas HTTP de permisos son solo `list` y `reply`. Una regla guardada por error **no se puede quitar** desde la app, y eso es una trampa de seguridad: un «siempre» mal dado dura para siempre.

**Qué hacen**: OpenCode 2.1.0 permite editar las acciones guardadas (con error de conflicto); Claude Code las guarda en reglas editables.

**Qué hacemos**: rutas del motor para **listar** los «siempre» de una carpeta, **borrar uno** y **borrar todos**, con la prueba de que un `NEVER_ALONE_PERMISSIONS` nunca se puede guardar. La pantalla es de la app (Ajustes). Interruptor `LAZUNOX_PERMISSION_PERSIST` ya existe y sigue apagado por defecto hasta que esta gestión exista.

**Pruebas**: `test/lazunox/siempre-gestion.test.ts` (listar, borrar uno, borrar todos, archivo corrupto, regla prohibida). **Hecho cuando**: la app puede mostrar y quitar un «siempre» y el probe lo confirma. Es un requisito para poder encender 7.2.

## 4. Tandas

| Tanda | Paquetes | Condición para pasar a la siguiente |
|---|---|---|
| A | 7.1, 7.2, 7.3, 7.4, 7.8, 7.13, 7.18, 7.21, y la **primera corrida** de 7.19 | Línea base hecha; filas «por comprobar» cerradas; decisiones de 7.2 en `LAZUNOX.md`; probe en Mac, Linux y Windows |
| B | 7.5, 7.6, 7.7, 7.20, 7.22 | Revisión independiente de 7.7; sin cambios sin registro en `docs/zonas-intocables.json` |
| C | 7.9, 7.10, 7.11, 7.14, 7.15, 7.12 | Decisiones D1 y D3 de Ben; compactación en segundo plano medida |
| D | 7.16, 7.17 y la **segunda corrida** de 7.19 | Decisiones D4 y D5; batería de ataques de 7.16 con falsa aprobación = 0 |

Después de cada tanda: motor nuevo (`lazunox.13` en adelante) con compilación reproducible, probe 100 % en las 3 plataformas, y **publicar solo con la confirmación de Ben**. La app no dice «paridad» ni «mejor» hasta que se cumpla el cierre de la §1.

### Estado de la tanda A (2026-10-26, noche)

Hecho en el fork (ramas locales sin push; integradas en `feat/ola7-a` y probadas en el Mac, typecheck limpio): **7.3, 7.4, 7.8, 7.9 (`@imports`), 7.13, 7.18, 7.21 y 7.22**. Pruebas de la integración: `test/lazunox` 1285, `test/session` 420, `test/tool` 349, `test/permission` 106, `test/mcp` 65, `test/patch` 39, todas sin fallos; `test/server` tiene 2 fallos que **ya existen en la base** (PTY y registros HTTP); el ejercicio de cobertura HTTP da 226/226 en sus tres modos. Una primera corrida de `test/lazunox` mostró 2 fallos intermitentes (uno por tiempo de espera, 5 s, bajo carga) que no se repitieron al correr la carpeta de nuevo: se anotan como intermitentes, sin causa confirmada.
Hecho en la app: **7.1** (tareas T24-T30 y proveedor falso, rama `feat/ola7-banco`).
**Pendiente de la tanda A:** 7.2 (medir y decidir qué se enciende) y la línea base real de 7.1, ambas con modelo, y la primera corrida de 7.19. Nada de esto está publicado ni integrado en la app: faltan las rutas nuevas (`/permission/siempre`, `/session/:id/uso`) en `api-routes.json` y en la política remota.

### Estado de las tandas B, C y D (2026-10-27, madrugada)

Todo vive en ramas locales del fork (`feat/ola7-final` integra A+B+C+D); nada está publicado ni subido. Suites del motor en verde (lazunox 1728, session 420, tool 349, permission 106, mcp 65, agent 49, provider 742, skill 24; en `test/server` solo fallan 2 pruebas que ya fallaban en la base `b3ccb17`).

| Paquete | Estado | Por defecto |
|---|---|---|
| 7.5 sanitizador | Hecho; el nivel del modelo cubre shell, Code Mode, `read` y `grep`. T28 pasa 4/5 con la opción | Mostrado/guardado: encendido. Para el modelo: **apagado** (contrapartida con `edit` sin decidir) |
| 7.6 ganchos | Hecho (onFailure, `if`, 4 eventos nuevos, derrame a disco, hash de confianza) | Encendido |
| 7.7 auditoría del shell | Hecho, 245 casos, revisión independiente hecha. Sin cubrir: `bash <<< 'rm x'` y `command -v rm` bajo un `deny rm` | Encendido (solo añade preguntas o negaciones) |
| 7.20 políticas | Hecho en el motor; **la app aún no fija `LAZUNOX_POLICY_FILE`** | Sin archivo = sin política |
| 7.15 cuadernos | Hecho (`cuaderno_editar`) | Solo si el proyecto tiene `.ipynb` |
| 7.9 instrucciones por diff + compactación segura | Hecho. T29 5/5 (control 4/5, dentro del ruido) | Encendido |
| 7.10 ayudantes reanudables | Hecho; esfuerzo por llamada apagado | Parcial |
| 7.14 objetivo/revisor | Hecho (solo prompts y un tope) | Encendido |
| 7.12 tareas programadas | Hecho en memoria; sin Rutinas ni ruta HTTP | **Apagado** |
| 7.11 worktree de la sesión principal | **No se hizo**: casi todo el estado del motor vive por carpeta; debe hacerse en la app (crear worktree, bifurcar la sesión, mandar peticiones con esa carpeta) | — |
| 7.17 flujos por script | Hecho y funciona de punta a punta, pero **no cumple la condición D5**: gasta de +43 % a +612 % de tokens según la tarea | **Apagado** |
| 7.16 auto-revisión local | **No se hizo**: exige una batería de ataques con falsa aprobación = 0 y revisión independiente, y no debe correr sin supervisión | — |
| 7.19 comparativo | **No se hizo**: exige descargar y ejecutar binarios de terceros (OpenCode 2.1.4, Codex); espera la autorización explícita de Ben | — |

Banco con modelo real (`opencode-go/deepseek-v4.1-flash`, 28 tareas): control n=5 134/140; candidato intermedio n=5 132/140 (tokens −4 %, dentro del ruido); motor final n=3 81/86 (T05 es un verificador demasiado estricto, no el motor; T05, T18 y T26 dan 15/15 con n=5 en ambos). No hay ahorro de tokens demostrado: lo que mejora es la **corrección** (edición segura, paralelismo seguro, permisos) y la seguridad, no el gasto. Resultados completos en `scripts/engine-bench/linea-base/real-go-ola7-*`.

**Todavía no se puede decir «paridad» ni «mejor»**: faltan 7.16, 7.19 (la única forma de medir contra OpenCode 2.x y Codex), 7.11 en la app y subir el pin con el motor nuevo.

## 5. Reglas operativas

- Todo lo pesado (compilar, `bun test` completo, banco) va al VPS; en el Mac, a lo sumo 1 o 2 agentes pesados.
- Pruebas con motor real: `XDG_CONFIG_HOME` y `HOME` aislados y comprobar con `GET /mcp` que no hay conectores ajenos (la app mezcla a propósito la configuración global del usuario).
- Nada de modelos de pago ni nube de terceros; el banco usa el modelo gratuito fijado por ID.
- No publicar, no hacer `git push` ni tocar etiquetas sin que Ben lo pida.
- Cada paquete: nota en `LAZUNOX.md`, interruptor `LAZUNOX_<X>=0`, pruebas `bun test` y grupo de probe.
- El código de terceros que se clonó para este estudio se trató como datos no confiables: solo lectura, nada ejecutado. Los clones están en la carpeta temporal de la sesión y se pueden borrar.

## 6. Decisiones (delegadas por Ben a Claude el 2026-10-26: «queda a tu criterio»)

Ben delegó estas ocho decisiones. Se registran aquí con su motivo. **Delegar la decisión no autoriza las acciones irreversibles o públicas**: publicar un motor o una versión, hacer `git push`, y tocar servidores siguen pidiendo la confirmación de Ben en su momento.

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Sí, comprobar** si se pueden escuchar los eventos de un worktree; si se cumple, ayudantes con worktree propio después de 7.11 | Lectura hecha: en Code la app usa **un solo flujo global** (`/global/event`, `src/renderer/src/lib/opencode.ts`) de **un** servidor, así que los eventos de otra carpeta de ese mismo servidor llegarían. El motivo del descarte pudo caducar. **No vale para Tareas** (un servidor por carpeta). Falta una prueba real de que los permisos de la hija salen por ese flujo |
| D2 | **Se queda en la app.** El motor no pone red por dominios | Un proxy en el motor solo frena a los programas que lo respetan y da falsa seguridad (decisión del 2026-10-24). Tareas ya tiene proxy de salida con denegar por defecto |
| D3 | **Sí** a 7.12, con persistencia vía Rutinas | Es pequeño y no tiene riesgo si cada disparo pasa por el plan y los permisos. Rutinas ya pide el aviso de términos |
| D4 | **Sí** a 7.16, apagado por defecto y con la condición de falsa aprobación = 0 | Es lo que más separa a Claude Code y Codex. Es la pieza de más riesgo, así que solo se entrega si la batería de ataques lo respalda; si no, queda en «solo sugerir» |
| D5 | **Sí** a 7.17, con la condición de mejorar T21 sin subir tokens | Reusa lo que ya existe (`task`, `task_wait`); si no mejora, no se enciende |
| D6 | **Sí** a «sin número medido no se enciende» | Es la lección de la 1.7.7: la meta de −15 % no se pudo demostrar |
| D7 | **Sí** a sanitizar lo que se muestra y se guarda; lo que ve el modelo, como opción medida | Es lo que hace Codex; enmascarar de más rompe salidas útiles |
| D8 | **Sí** a descargar OpenCode 2.1.4 y Codex en el contenedor del VPS, **cuando llegue 7.19**, con hash verificado, sin red salvo el proveedor del modelo gratuito y sin claves reales | Sin esto «mejor» sería solo una opinión. Es código de terceros: nunca en el Mac. Se avisa a Ben antes de la descarga |

**Pendiente de verdad de Ben**: nada bloquea empezar la tanda A. Lo único que se le preguntará más adelante es publicar cada motor nuevo y cada versión de la app.
