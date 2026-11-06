# Diseño: una sola fuente para la guía de calidad de documentos (a2, y su relación con a5)

Estado: **solo diseño, nada implementado**. Base: commit `f9f4671a` (1.8.10). Leyenda: **[LEÍDO]** = lo comprobé leyendo el código en esa base; **[SUPUESTO]** = lo deduzco y hay que comprobarlo antes de implementar; **[MEDIDO]** = tamaño medido con `wc`/`sed`.

## 1. Resumen

1. La guía de calidad de Word, Excel, PDF y PowerPoint hoy vive en **tres sitios** que dos pruebas obligan a decir lo mismo palabra por palabra.
2. Propongo una carpeta `resources/opencode/guia-documentos/` con **un archivo por formato** y un script que **rellena marcadores** en `chat.md` y en las `SKILL.md`, y **genera un archivo TypeScript** que usa `config.ts`.
3. Una prueba nueva exige «lo generado == lo comprometido»; las pruebas de paridad actuales siguen verdes en todos los pasos.
4. La carga por formato (a5) se puede hacer **después**, sobre la misma fuente, sin rehacer nada.
5. Esfuerzo honesto: a2 solo, unos 3 a 4 días; a2 + a5 con evaluación real de modelos, 6 a 9 días.

## 2. Inventario de hoy

### 2.1 Las tres copias de la guía de diseño

| Formato | `chat.md` | Prompt inline `config.ts` | `SKILL.md` | Tamaño [MEDIDO] |
|---|---|---|---|---|
| PDF | línea 28 («- Diseño del PDF:») | línea 83 | `skills/pdf/SKILL.md` línea 41 | ~4,8 KB |
| Excel | línea 54 | línea 121 | `skills/xlsx/SKILL.md` línea 38 | ~3,8 KB |
| Word | línea 56 | línea 157 | `skills/docx/SKILL.md` línea 39 (bajo `### Guía de diseño`) | ~2,8 KB |
| PowerPoint | líneas 61 a 155 (de `- theme (opcional…` hasta antes de `- REGLA OBLIGATORIA`) | líneas 177 a 258, **versión condensada, no idéntica** | `skills/pptx/SKILL.md` desde la línea 49 | ~11 KB en `chat.md` |

[LEÍDO] Cada guía de PDF, Excel y Word es **una sola línea larga** en las tres copias. La de PowerPoint es un bloque de muchas líneas con sangría.

Otros datos [LEÍDO]/[MEDIDO]:

- `chat.md` pesa 35.109 bytes. Las líneas del prompt inline en `config.ts` (72 a 306) pesan ~36 KB. Las guías de diseño de los cuatro formatos son ~22 KB de esos ~35 KB; el resto son el esquema JSON de cada bloque, la pregunta obligatoria de formato de PowerPoint (líneas 156 a 210 de `chat.md`), los límites y las reglas generales.
- `config.ts` fija `agent.chat.prompt` y el comentario de las líneas 59 y 60 dice que la configuración inline gana sobre la global y la de proyecto. **[SUPUESTO]** Por eso en ejecución el prompt que ve el modelo del Chat es el de `config.ts`, y `chat.md` aporta sobre todo los permisos de su cabecera y sirve de «fuente» para las pruebas. Hay que confirmarlo mirando el prompt real que llega al motor antes de tocar nada.
- `tasks.md` (líneas 106 a 130) y `computer.md` **no copian la guía**: remiten a las skills («carga la skill con la herramienta `skill`… te da el esquema y la guía de diseño»). La prueba de pptx exige que digan `` `pptx` ``, «MANDA el flujo», «pregunta de formato», `build_chat_deck.py`, «el mismo resultado que en el Chat» y `build_pptx.py`. Estas referencias **no hay que generarlas**, solo no romperlas.
- `src/shared/chat-prompt.ts` (1,4 KB) arma un prompt de sistema del Chat desde el renderer y no menciona formatos de documento [LEÍDO]. Es un gancho posible para a5.

### 2.2 Qué exigen las pruebas

`src/main/opencode/skill-office-chat-parity.test.ts` (Word, Excel, PDF):

- `norm()` quita las comillas invertidas (`` ` ``) y colapsa todo el espacio en blanco. Toma de `chat.md` la línea que empieza con `- Diseño del Word:` (y las otras dos), con `trimStart`.
- Exige que esa línea normalizada esté **contenida** en el prompt inline (`JSON.stringify(buildInlineConfig())` con `\"` convertido en `"`, normalizado) y en la `SKILL.md` normalizada. También que mida más de 900 caracteres y que contenga unas frases clave por formato (`total_row`, `columnFormats se pone SIEMPRE`, `@page { size: A4`…).
- Exige que ciertos puntos del esquema (`columnFormats`, `"currency"`, `total_row`, `widths_cm`, `toc:true`, `"hoy"`…) estén en las tres copias: `chat.md`, inline y la skill.
- Exige que los límites de la skill de Word y de Excel coincidan con `src/shared/chat-doc-spec.ts` (300 bloques, hojas, filas, columnas, caracteres).
- Además prueba que cada skill ponga primero `build_chat_*.py`, conserve el respaldo y explique el código 3; y corre scripts de Python/empaquetado. **Eso no tiene que ver con la guía** y no se toca.

`src/main/opencode/skill-pptx-chat-parity.test.ts`:

- `chatDesignGuide()` corta `chat.md` desde la cadena exacta `  - \`theme\` (opcional` hasta la cadena `- REGLA OBLIGATORIA`. Exige >5000 caracteres y que `SKILL.md` normalizada (aquí `norm` **no** quita las comillas invertidas) lo contenga entero.
- Para el prompt inline solo exige unas palabras clave (`layout:"free"`, `960 de ancho × 540 de alto`, `como mucho 40`, `Tahoma`, `palette`, `fillTo`) en las tres copias. **El inline no es copia literal**, por eso la fuente única de pptx es distinta (ver 3.3).
- Exige en la skill la pregunta de formato («Antes de empezar: pregunta el formato (obligatorio)», `Editable (.pptx)`, `Diseño libre (HTML)`, `herramienta \`question\``, `Ruta HTML`, «inventa uno distinto cada vez»), el camino principal y los respaldos.

Lección [LEÍDO]: las pruebas dependen de **cadenas literales de delimitación** (`  - \`theme\` (opcional`, `- REGLA OBLIGATORIA`, `- Diseño del Word:`) y de detalles de normalización. La fuente generada debe producir exactamente esa forma.

## 3. Propuesta

### 3.1 La fuente

```
resources/opencode/guia-documentos/
  pdf.md   xlsx.md   docx.md   pptx.md
```

Cada archivo es Markdown con **partes marcadas**, para no mezclar lo que va en todas partes con lo que va en una sola:

```
<!-- parte:guia -->
Diseño del Word: estructura primero. Portada mínima … (una sola línea, texto idéntico al de hoy)
<!-- /parte -->
<!-- parte:esquema -->   (el JSON del bloque, solo para Chat; las skills ya tienen el suyo)
<!-- parte:corta -->     (solo pptx: versión condensada que usa hoy config.ts)
```

Decisiones:

- **Se genera solo la `guia`** al principio (la parte que las pruebas obligan a igualar). El esquema JSON de cada bloque y los límites quedan donde están hasta la fase 2: es más pequeño el cambio y más claro el riesgo.
- **Regla de una línea**: las guías de PDF, Excel y Word se mantienen en **una sola línea**, sin saltos ni barras invertidas. Motivo [LEÍDO]: el inline se compara tras `JSON.stringify` y solo se deshace `\"`; un salto de línea o una barra en el texto produciría `\n` o `\\` y la prueba fallaría. La prueba nueva de generación debe comprobar que las partes `guia` de pdf/xlsx/docx no contienen `\n` ni `\`.
- **PowerPoint** es distinto: `chat.md` y la skill llevan el bloque entero (11 KB con sangría de lista) y `config.ts` una versión condensada. La fuente de pptx tiene dos partes: `guia` (la completa, para `chat.md` y `SKILL.md`) y `corta` (la del inline, que hoy se mantiene a mano). La parte `corta` solo está protegida por las seis palabras clave de la prueba, así que **no promete el mismo texto**; hay que decidir (pregunta 3 de la sección 8) si en la fase 2 se unifica o se deja asumido como dos niveles.

### 3.2 Cómo se genera cada copia

Un script `scripts/build-doc-guide.mjs` (Node, sin dependencias nuevas, en el estilo de `scripts/build-chat-office.mjs`):

1. **`chat.md`**: entre marcadores `<!-- guia:docx -->` … `<!-- /guia:docx -->` el script escribe la parte `guia`. Los marcadores son comentarios HTML, así que no cambian lo que lee el modelo y la prueba, que toma «la línea que empieza con `- Diseño del Word:`», ve exactamente la misma línea. Para Word/Excel/PDF el script antepone `- ` (y la sangría de dos espacios) a la línea; para pptx indenta cada línea con dos espacios, como hoy. **[SUPUESTO]** Los comentarios HTML dentro de una lista Markdown no afectan al modelo ni a OpenCode; confirmar que el motor no los trata distinto al leer el `.md` con su cabecera.
2. **`SKILL.md`** de docx, xlsx, pdf y pptx: lo mismo, con marcadores en el lugar de hoy (sección `### Guía de diseño` en docx, la línea 38 en xlsx, la 41 en pdf, el bloque desde la 49 en pptx). Sin sangría de lista en la skill (hoy no la llevan).
3. **`src/main/opencode/chat-guide.generated.ts`** (comprometido en el repositorio, con cabecera «NO EDITAR»): exporta `GUIA_PDF`, `GUIA_EXCEL`, `GUIA_WORD`, `GUIA_PPTX_CORTA` como cadenas. `config.ts` deja de llevar esos tramos y los concatena en su lugar (`... + GUIA_WORD + ...`). El texto se escribe con `JSON.stringify` para evitar problemas con comillas invertidas y comillas.
4. Los tramos del prompt inline que son esquema o reglas generales (líneas 72 a 306 menos las guías) **no se tocan** en la fase 1.

Modo de ejecución: `node scripts/build-doc-guide.mjs` escribe; `node scripts/build-doc-guide.mjs --check` solo compara y sale con error si algo difiere.

### 3.3 Prueba «generado == comprometido»

Un `scripts/build-doc-guide.test.mjs` o `src/main/opencode/guia-generada.test.ts`: ejecuta la generación en memoria y compara con los archivos comprometidos (`chat.md`, las cuatro `SKILL.md`, `chat-guide.generated.ts`). Mismo patrón que `i18n-core-keys.json` [LEÍDO: `src/renderer/remote/i18n-core.test.ts` falla con un mensaje que dice cómo regenerar; aquí sería `node scripts/build-doc-guide.mjs`]. Debe comprobar además: marcadores balanceados y sin duplicar, y la regla de una línea del 3.1.

### 3.4 Decisión: ¿generar en el build o comprometer lo generado?

**Recomiendo comprometer lo generado.** Razones: `chat.md` y las `SKILL.md` son lo que lee un humano y lo que copian las instalaciones a `userData` [LEÍDO: `electron-builder.yml` empaqueta `resources/opencode/agents` y `skills`]; un archivo generado solo en el build no se vería en `git diff` ni en la revisión, y las pruebas de paridad leen estos archivos directamente del repositorio sin pasar por el build. Costo: hay que acordarse de regenerar; la prueba del 3.3 lo obliga.

## 4. Cargar la guía de un formato solo cuando se pide (a5)

Problema: el Chat lleva ~35 KB en cada conversación aunque nadie pida un PDF. Lo que más pesa son las guías (~22 KB, PowerPoint ~11 KB). La fuente única hace a5 barato **porque ya habrá un archivo por formato**.

Restricción [LEÍDO]: el agente `chat` tiene `'*': deny` y solo permite web, `question` y un `read` centinela que no lee nada; **no tiene la herramienta `skill`**. Así que «que el modelo la pida» no existe hoy. Tres caminos:

| Opción | Cómo funciona | Ventajas | Riesgos |
|---|---|---|---|
| A. La app añade la guía según el mensaje | Un detector de palabras (Word, docx, Excel, hoja de cálculo, PDF, PowerPoint, presentación…), mirando el mensaje y la conversación (si ya hay un bloque ```docx se mantiene Word), añade la guía de ese formato al prompt de sistema de esa conversación. El gancho natural es `src/shared/chat-prompt.ts` (`buildChatSystemPrompt`) **[SUPUESTO: hay que ver cómo viaja ese texto al motor y si cambiarlo a mitad de conversación rompe la caché del prompt]** | Predecible, sin ronda extra del modelo, no depende de que el modelo obedezca | El detector falla con pedidos indirectos («arma una cotización para imprimir»); cambiar el prompt de sistema a mitad de conversación puede invalidar la caché de prefijo |
| B. Herramienta `guia_documento(formato)` | Una herramienta nueva (en el servidor MCP de documentos o uno nuevo) que devuelve la guía; se permite al Chat | El modelo decide; cubre pedidos indirectos | Los modelos chicos pueden **no llamarla** (justo los que más necesitan la guía); una ronda más por documento |
| C. Híbrida | Núcleo corto siempre (esquema mínimo y una línea «para Word pide la guía»), A como camino principal y B como respaldo | Lo más robusto | Más piezas |

Mi recomendación: **A, con un núcleo siempre presente de ~8 a 10 KB** (reglas generales, límites, la pregunta de formato de pptx y el esquema mínimo), y las guías por formato como carga adicional. Meta realista: de ~35 KB a ~10 KB en conversaciones sin documentos, y a ~13 a 21 KB cuando se pide uno. **[SUPUESTO]** Las cifras son estimaciones por lo medido; el esquema JSON también pesa y quizás no se pueda sacar sin que el modelo escriba mal el bloque, hay que medirlo.

Lo que **no** debe hacerse sin probar: sacar el esquema del bloque junto con la guía. El modelo necesita el esquema para escribir el bloque; la guía solo para escribirlo bien.

Relación con las pruebas de paridad: a5 cambia lo que el inline contiene y rompe «el prompt inline contiene la guía». Esa prueba pasaría a decir «la guía de cada formato está disponible por el mecanismo elegido» (ver paso 5 de la migración). Por eso a5 va **después** de a2 y no a la vez.

## 5. Plan de migración (4 pasos mas uno opcional, commits pequeños)

Regla para todos: tras cada paso, `npx vitest run src/main/opencode/skill-office-chat-parity.test.ts src/main/opencode/skill-pptx-chat-parity.test.ts` debe estar verde, y también `visible-terms`, `legacy-terms`, `i18n-coverage` y `no-secrets` (las que más muerden en cambios de texto).

| Paso | Qué cambia | Cómo se mantiene verde | Riesgo |
|---|---|---|---|
| 1. Fuente + script, sin efecto | Crear `guia-documentos/*.md` copiando el texto **exacto** de hoy (sacado de `chat.md`), y `build-doc-guide.mjs` solo con `--check`/escritura en memoria. No se toca ningún archivo existente. Prueba: la fuente reproduce las guías actuales. | No cambia ningún archivo que lean las pruebas de paridad | Bajo. El texto de pptx de `chat.md` (sangría de lista) hay que reconstruirlo exactamente |
| 2. Marcadores en `chat.md` y las `SKILL.md` | Añadir los comentarios de marcador alrededor de las guías y que el script los rellene; salida idéntica byte a byte a la actual. Prueba nueva «generado == comprometido» para esos cinco archivos. | `git diff` de contenido = solo los marcadores. La normalización colapsa el espacio y quita el resto igual | Medio: **marcadores en una lista con sangría** y la cadena `  - \`theme\` (opcional` que usa el corte de la prueba de pptx deben quedar exactamente donde hoy. Verificar que `chatDesignGuide()` devuelve lo mismo antes y después |
| 3. `chat-guide.generated.ts` y `config.ts` | `config.ts` concatena las constantes en vez de llevar las guías. Prueba de generación ampliada al `.ts`. | La prueba compara `JSON.stringify(buildInlineConfig())`: si el texto no cambia, el resultado es idéntico. Comparar antes/después el JSON completo con una prueba de «instantánea» temporal | Medio: el texto en `config.ts` está dividido en trozos `'...' +`; una espacio faltante entre trozos cambia el prompt sin romper la prueba de paridad (que colapsa espacios). Comprobar el prompt **sin normalizar** antes y después |
| 4. Simplificar las pruebas de paridad | Las pruebas ya no necesitan comparar tres textos: pasan a comprobar que el generador está al día (la prueba del 3.3) y conservan solo las comprobaciones que **no** son de copia (puntos del esquema, límites contra `chat-doc-spec.ts`, camino principal, código 3, pregunta de pptx). | Se hace solo cuando 1 a 3 llevan al menos un ciclo de uso sin sorpresas | Bajo, pero quitar una prueba pierde una red: conservar una prueba de humo de que el prompt inline contiene las frases clave |
| 5. (opcional, a5) Carga por formato | Implementar la opción A o C del apartado 4 sobre las constantes por formato. Cambia el inline: la prueba de paridad se reescribe al nuevo mecanismo. Evaluación con modelos grandes y chicos antes de publicar. | Se reemplazan pruebas en el mismo commit, nunca se borran sin sustituto | **Alto**: cambia cómo piensa el Chat. Requiere medición real |

Riesgos que atraviesan todo:

- **La normalización `norm()` es indulgente con el espacio y quita las comillas invertidas** [LEÍDO]. Un generador que pierda un espacio entre trozos no lo detectan estas pruebas, pero el modelo sí lo nota. Por eso el paso 3 pide comparación del prompt sin normalizar.
- **Una barra o un salto dentro de la guía** rompe la comparación del inline (apartado 3.1).
- **Windows**: las skills corren en WSL y `agents-win` vive aparte [LEÍDO en `electron-builder.yml`]. **[SUPUESTO]** No se copia la guía en `agents-win`, pero hay que verificarlo; no está en el inventario.
- **Copias en `userData`**: `agents` y `skills` se copian al arrancar. Una versión nueva con marcadores debe sobreescribir la anterior sin dejar mezclas; **[SUPUESTO]** el mecanismo de copia ya lo hace por versión, comprobarlo.
- **Concurrencia con P1 (guía corta para Code)**: si en la misma ola alguien edita las guías en `chat.md`, el paso 2 hace conflicto. Hacer a2 después de integrar la 1.8.11, o congelar las guías mientras dure.

## 6. Code también

Hoy Code (y Overdrive) obtienen la guía **cargando la skill** con la herramienta `skill` (`tasks.md` línea 106 y siguientes). Con la fuente única la skill se regenera, así que Code recibe la misma guía sin cambios. Si se quisiera una guía corta propia de Code (paquete P1), saldría de una tercera parte `corta` por formato en la misma fuente, no de una copia más.

## 7. Estimación honesta de esfuerzo

Para alguien que conoce el código; incluye pruebas, pero no una publicación.

| Trabajo | Días |
|---|---|
| Paso 1 (fuente y script) | 0,5 |
| Paso 2 (marcadores y prueba) | 0,5 a 1 |
| Paso 3 (`config.ts` y constantes) | 0,5 a 1 |
| Paso 4 (simplificar pruebas) | 0,5 |
| **Total a2** | **~3 a 4** (con imprevistos de formato de pptx y de empaquetado) |
| Paso 5 / a5 (detector o herramienta, medir tamaño, probar con modelos chicos y grandes, reescribir pruebas) | 3 a 5, más tiempo de pruebas manuales con modelos reales |

Lo que más puede alargarlo: la guía de pptx (bloque grande con sangría y dos versiones), confirmar qué prompt llega de verdad al motor, y la evaluación de a5, que es de calidad del modelo y no de código.

## 8. Preguntas para Ben

1. **¿Generar en el build o comprometer lo generado?** Recomiendo comprometer lo generado (apartado 3.4).
2. **¿Cargar la guía de un formato solo cuando se pide (a5)?** Si sí, recomiendo la opción A (la app lo decide por el mensaje) con núcleo siempre presente (apartado 4); es la decisión que más cambia la experiencia del Chat y conviene hacerla en una versión aparte.
3. **¿La guía de pptx se unifica (inline = texto completo, ~11 KB más en el prompt) o se acepta una versión corta aparte?** Solo tiene sentido unificar si a5 se hace; sin a5 son 11 KB más en cada conversación.
4. **¿Dónde vive la guía para Code: en la skill (como hoy) o en las `instructions` del servidor de documentos?** Recomiendo dejarla en la skill: ya se regenera con la fuente y el modelo la carga solo cuando hace falta.

## 9. Lo que no verifiqué

- No ejecuté la app ni las pruebas; todo es lectura de código y `wc`/`sed`. No corrí el generador (no existe).
- No confirmé cuál de `chat.md` o el prompt inline gana en ejecución, ni cómo viaja `buildChatSystemPrompt` al motor, ni el efecto de cambiar el prompt a mitad de conversación en la caché.
- No revisé `agents-win` ni el mecanismo de copia a `userData`.
- Las cifras de «de 35 KB a 10 KB» son estimaciones, no mediciones del prompt reducido.
