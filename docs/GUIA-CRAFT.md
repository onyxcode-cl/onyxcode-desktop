# Guía de uso de las herramientas Craft (Word y PowerPoint)

Rama `exp/craft-office-pruebas`. Complementa `docs/PRUEBA-CRAFT.md` (qué son, licencias, resultados). Aquí queda **cómo se usan** `wordcraft-cli` y `deckcraft-cli` para que un modelo, o la propia app, generen documentos buenos y rápidos. Versión probada: 0.5.0, macOS universal.

## La idea clave

Cada acción es un **comando** (`id` + parámetros JSON). Un documento se arma con una lista de comandos que se ejecuta de una vez:

```bash
deckcraft-cli run --cmd file.new --cmd 'slide.new={"layout":"title","title":"Hola"}' --save salida.pptx
wordcraft-cli run --cmd 'para.heading1' --cmd 'text.insert={"text":"Título"}' --save salida.docx
```

Medido: un informe de 2 páginas y una presentación de 10 diapositivas salen en **0,02–0,05 s** así. Con un modelo descubriendo los comandos por su cuenta tardaron **346 s (PowerPoint) y 479 s (Word)** con `glm-5.3`, y 251 s con un modelo gratis. El tiempo se va en que el modelo tantea comandos (`list_commands`, buscar ids), no en la herramienta.

**Recomendación:** que el modelo solo escriba el _contenido_ (JSON: título, secciones, tabla) y que la app lo convierta a comandos con una plantilla fija. Ejemplos funcionando en `docs/craft-ejemplos/`.

## Servidor MCP (para que un modelo lo use directo)

`deckcraft-cli mcp` y `wordcraft-cli mcp` hablan MCP por stdio. DeckCraft expone estas herramientas: `list_commands`, `run_command`, `batch`, `new_presentation`, `open_presentation`, `save_presentation`, `export`, `inspect_document`, `inspect_slide`, `render_slide`, `add_slide`, `go_to_slide`, `add_shape`, `add_text_box`, `set_text`, `insert_picture`, `insert_table`, `insert_chart`, `select`, y de ratón/teclado (`pointer`, `select_tool`, `key`, `type_text`). `screenshot` y `call_app` solo existen con la app de escritorio. También publica recursos `deckcraft://document` y la lista de comandos.

Flujo que recomienda el propio servidor: `new_presentation` → `add_slide` → `add_shape` / `add_text_box` / `insert_picture` / `insert_chart` → `inspect_slide` (leer ids y cajas) → `render_slide` (mirar el resultado). Usar **`batch`** para mandar muchos comandos en una sola llamada: es lo que más ahorra tiempo.

## DeckCraft (PowerPoint)

- Lienzo 16:9 = **960 × 540 pt**, y hacia abajo. Todo se posiciona en puntos con `rect:[x,y,w,h]`.
- 226 comandos en grupos: `format.*` (39), `shape.*`, `slide.*`, `table.*`, `arrange.*`, `insert.*`, `animation.*`, `transition.*`, `design.*`, `chart.*`, `master.*`, `section.*`, `comment.*`.
- Los comandos de formato (`format.*`, `shape.fill`, `shape.line`) actúan sobre **lo recién insertado / seleccionado**: después de `shape.insert` o `insert.textBox` se puede formatear de inmediato; si no, `edit.select {ids:[..]}`.
- Temas incluidos: DeckCraft, Harbor, Ember, Meadow, Nocturne (oscuro, violeta), Paper, Coral Reef, Slate. `file.new {theme:"Nocturne"}`. Esquemas extra de color (Ocean, Sunset, Forest, Berry…) con `design.colors`, y 9 pares de fuentes con `design.fonts` (Inter, Playfair Display, Montserrat, Poppins…).
- **Camino rápido y limpio:** `slide.new {layout, title, body}` con layouts `title`, `titleAndContent`, `sectionHeader`, `twoContent`, `comparison`, `titleOnly`, `blank`, `contentWithCaption`, `pictureWithCaption`. El cuerpo es un párrafo por línea y las tabulaciones al inicio indentan viñetas.
- **Camino con diseño propio:** `layout:"blank"` + `design.background {color}` + formas. Se puede lograr estética «premium» (ver `docs/craft-ejemplos/presentacion-dots.py`).
- Elementos útiles: `shape.fill` con `gradient` (`kind:"radial"`, `stops`), `pattern` (puntos, rayas), `transparency`; `insert.chart` (+`chart.options {title, legend, dataLabels}`); `insert.table` + `table.style` (`medium2-accent1`…) + `text.set {cell:[r,c]}`; `insert.smartArt {kind: process|cycle|hierarchy|pyramid|matrix|list}`; `transition.set`/`transition.applyAll`; `animation.add`; `slide.notes`.
- Exportar: `file.export {format: pdf|png|pptx|outline}` o `render --all`.

### Trampas aprendidas

- `file.new` ya crea una diapositiva; con `blank:true` no. Si no, quedará una vacía al inicio (`slide.delete {index:0}`).
- `insert.table` con `style` solo acepta los nombres internos (`medium2-accent1`, `light1-accent2`, `dark1-tx1`, `grid`, `none`), no los de Office.
- En **SmartArt** las palabras largas se parten por la mitad: usar textos cortos.
- Un gráfico sin `chart.options {title}` muestra «Chart Title». En fondo oscuro sus etiquetas salen grises y tenues.
- Los emojis pueden no pintar en el render headless; preferir formas y números.
- Medir el texto: no hay autoajuste fiable. Dejar cajas generosas y **renderizar y mirar** (`render --all`), como hace el flujo de `inspect_slide` + `render_slide`.

## WordCraft (Word)

- Documento lineal con un cursor: se escribe en orden. 460 comandos.
- Base: `text.insert {text}`, `text.newParagraph`, `para.heading1|2|3`, `para.style {style:"Normal"}`, `para.alignCenter|Left|Right|Justify`, `format.bold {value}`, `format.color {color:"RRGGBB"|"auto"}`, `para.bullets` (activar, escribir elementos, `para.bullets {off:true}`), `list.define` (numeradas), `insert.table {rows,cols}`.
- **Tablas:** tras `insert.table` el cursor queda en la primera celda; `text.tab` pasa a la siguiente celda. Colorear cada celda con `table.shading {color}` justo antes de escribir en ella; `format.color` para la letra; `table.borders`, `table.cellAlign`, `table.repeatHeader`, `table.formula`. Después de la tabla, `caret.docEnd` para seguir debajo.
- Imágenes/gráficos, referencias (`references.toc`, índices), comentarios y cambios con autor (`--author`).
- Convertir y revisar: `convert in out` (docx, pdf, odt, rtf, html, md, tex, txt, png), `info`, `inspect`, `render file out.png --page N`.

### Trampas aprendidas

- `table.nextCell` no existe: se usa `text.tab`.
- `insert.table {style}` solo acepta estilos que existen en el documento (`Table Grid`); para color propio, `table.shading`.
- Texto largo en una celda estrecha puede recortarse en la última fila: acortar o ampliar columnas (`table.columnWidth`).
- `render --page N` cuenta desde **1** (con 0 devuelve la página 1).

## Cómo usarlo dentro de Lazunox (propuesta, sin implementar)

1. El modelo devuelve el **contenido** como JSON (título, secciones, tabla, notas).
2. Un módulo de la app traduce ese JSON a comandos con una plantilla de diseño (la del ejemplo `dots`: fondo oscuro, acento violeta, tarjetas, puntos de colores) y ejecuta `deckcraft-cli run` / `wordcraft-cli run`.
3. Se renderiza una vista previa y se muestra al usuario; opción de «cambiar tema» (`file.new {theme}` / `design.colors`).
4. El binario se descarga bajo demanda con hash fijado y se ejecuta con carpetas XDG aisladas, igual que en las pruebas (ver `docs/PRUEBA-CRAFT.md`). Pendiente de decisión: licencias (MIT/Apache) y firma (Developer ID «Learning Machines LLC»).

## Resultado de la prueba con plantilla (módulo `src/main/office/craft/`)

`deck-builder.ts` convierte el contenido (JSON con 10 tipos de diapositiva) en comandos con el diseño «dots»; `deck-runner.ts` ejecuta `deckcraft-cli` sin shell, con tope de tiempo y carpetas aisladas. 15 pruebas unitarias (incluida una con el binario real, con `DECKCRAFT_CLI=ruta`). La guía que se le da al modelo está en `docs/craft-ejemplos/guia-para-el-modelo.md`.

Misma petición (presentación de 9 diapositivas sobre «dots», el modelo escribe solo el JSON):

| Modelo                          | Tiempo | Antes (sin plantilla)                            |
| ------------------------------- | ------ | ------------------------------------------------ |
| `deepseek-v4-flash` (Go)        | 28 s   | —                                                |
| `claude-haiku-5-5` (Go)         | 47 s   | —                                                |
| `glm-5.3` (Go)                  | 60 s   | 346 s                                            |
| `mimo-v2.6-flash-free` (gratis) | 102 s  | ~40 s con 3 diapositivas, mucho más para el Word |

La app arma el archivo en ~30 ms. Calidad visual pareja en los cuatro. Problemas vistos: el modelo inventa cifras si la guía no se lo prohíbe, y los textos largos se pisaban (corregido con `fitSize`, que reduce la letra según el largo).

## Comparación con LibreOffice (12 oct 2026)

Mismos archivos dibujados con DeckCraft/WordCraft y con LibreOffice 26.8.1 (el que instala la app). Archivos: 3 presentaciones hechas por otras herramientas, 1 hecha con DeckCraft, y 5 Word (2 documentos reales de la empresa, uno con foto de portada y encabezados).

|                                           | ArtCraft                                                                    | LibreOffice                    |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| Velocidad (4 presentaciones / 5 Word)     | < 1 s / 1 s                                                                 | 6 s / 2 s                      |
| Textos, formas, tablas, colores, imágenes | prácticamente idénticos                                                     | referencia                     |
| Nº de páginas de los Word reales          | igual (8 y 2)                                                               | igual                          |
| Gráficos                                  | sin etiquetas de datos y sin colores por barra (**peor**)                   | muestra etiquetas y colores    |
| Salto de página en Word                   | puede dejar un título al pie con su tabla en la página siguiente (**peor**) | mantiene título y tabla juntos |
| Encabezado/pie de página                  | los pinta más pálidos (**peor**)                                            | correcto                       |
| Fuente que no está instalada              | cae a serif y puede cambiar símbolos (p. ej. «+»); se evita usando Arial    | igual                          |

Lección: en los documentos que creamos hay que fijar una fuente que exista en todos lados (Arial). El diseño dots ya lo hace. La plantilla de Word también (`design.themeFonts`).

Conclusión: **ArtCraft sirve para crear** (rápido, ligero, buen diseño) y para revisar a ojo; **LibreOffice sigue siendo la referencia** para revisar fielmente documentos ajenos con gráficos, saltos de página y encabezados, para convertir a PDF y para Windows.

## Estado de la integración en la app (rama de pruebas)

- Un solo botón en Ajustes › Tareas instala **DeckCraft y WordCraft** (≈ 147 MB; si ya está uno, baja solo el que falta). Pin en `resources/craft/pin.json` (URL de GitHub de cada proyecto, tamaño exacto, SHA-256, equipo de Apple `DJ6XS33FX8`).
- Skill `pptx`: `scripts/build_dots.py` (diseño dots; misma plantilla que `src/main/office/craft/deck-builder.ts`, con prueba de paridad).
- Skill `docx`: `scripts/build_word_craft.py` usa el MISMO JSON que `build_docx.py` (no hay esquema nuevo para el modelo) y sale con código 3 si WordCraft no está instalado. Prueba: `tests/test_craft.py`.
- Trampas de WordCraft vistas al hacerlo: `insert.header/footer` dejan el cursor dentro de ellos (cerrar con `insert.closeHeader`), `insert.picture` deja la imagen seleccionada (mover el cursor con `caret.docEnd` o el texto siguiente la reemplaza) y `para.restartNumbering` solo funciona con el cursor ya dentro de la lista.
- Los programas se buscan en `$LAZUNOX_BIN_DIR/craft-<versión>/` aunque se instalen con el motor del agente ya arrancado.

## GridCraft: lo que cubre y lo que no

GridCraft 0.5.0 (`gridcraft-cli`, macOS universal, firma DJ6XS33FX8) recalcula y dibuja las hojas `.xlsx` en la skill xlsx antes que LibreOffice (`_shared/render_grid.py`). Si no está o no es fiable para ese libro, cae a LibreOffice. Medido contra LibreOffice 26.8.1 con 78 y 96 fórmulas de prueba: coinciden SUM, AVERAGE, ROUND, IF, IFERROR, COUNTIF(S), SUMIF(S), VLOOKUP, INDEX/MATCH, PMT, FV, PV, NPV, RATE, STDEV, VAR, MEDIAN, PERCENTILE, fechas (DATE, EOMONTH, EDATE, DATEDIF, NETWORKDAYS) y los errores #DIV/0!, #N/A, #REF!, #VALUE!, #NUM!. El recálculo sale con precisión completa (el CSV de GridCraft solo trae 15 cifras).

Diferencias concretas:

- `=IRR(A1:A3)` sin solución y `=SQRT(-1)`: GridCraft da `#NUM!` (como Excel); LibreOffice da `#N/A` y `#VALUE!`.
- Decimales en texto: `=TEXT(1234.5,"#,##0.00")`, `=FIXED(…)`, `="x"&1.5` salen con punto en GridCraft (`1,234.50`, `x1.5`) y con coma en LibreOffice porque aquí usa configuración española (`1.234,50`, `x1,5`). `=VALUE("3,5")`: GridCraft `#VALUE!`, LibreOffice `3.5`. Depende de la configuración regional, no del libro.
- `=TEXT(D2,"0.0%")` con 0,125: GridCraft `12.5%`, LibreOffice `13%` (interpreta el punto como separador de miles).
- Funciones modernas escritas sin prefijo `_xlfn.` (TEXTJOIN, XLOOKUP, IFS, MAXIFS, DAYS, XOR, STDEV.S…): openpyxl las escribe así; Excel y LibreOffice muestran `#NAME?` y GridCraft las calcula. `recalc()` no usa GridCraft con ellas: cae a LibreOffice, que es lo que verá Excel. Es un fallo real del libro, no del motor.
- Matrices dinámicas (`FILTER`, `SORT`, `UNIQUE`, o `=A1:A3` en una celda): GridCraft devuelve «Spill» y no derrama, así que se usa LibreOffice.
- `#NAME?` con una función que está en el catálogo de GridCraft aunque no la calcule: cae a LibreOffice. Si la función no está en el catálogo, el `#NAME?` se acepta tal cual.
- `=DATE(2024,1,31)` y `=TIME(12,0,0)` en el recálculo dan el número de serie (45322, 0,5); LibreOffice con formato de fecha da fecha/hora.
- Render: tipografía propia (no la de Office), separadores en formato inglés y el número de páginas coincidió en el libro de prueba (3 y 3). No se ha comparado la paginación de libros largos ni con gráficos, formato condicional o validaciones.
- No probado: Windows (el binario es solo macOS), modo Sandbox de Tareas y libros con más de unas pocas hojas.

Dónde está: `resources/opencode/skills/_shared/render_grid.py` (búsqueda `LAZUNOX_GRIDCRAFT` → `$LAZUNOX_BIN_DIR/craft-*/*/gridcraft-cli` con su marca) y pruebas `_shared/tests/test_craft_grid.py` (con un `gridcraft-cli` falso; la real necesita `GRIDCRAFT_CLI=ruta`).

## Vista en el panel con la versión web (rama de pruebas)

El panel de documentos del Chat muestra Excel y PowerPoint con la versión **web** del propio programa (GridCraft y DeckCraft; WordCraft queda instalada pero el Chat aún no genera Word): el mismo motor y la misma pantalla que el programa de escritorio, con datos, fórmulas, gráficos y diseño reales y editable. Se descarga con el mismo botón de Ajustes (zips fijados en `pin.json › web`, tamaño exacto + SHA-256, sin enlaces simbólicos).

- `src/main/office/craft/web-server.ts`: servidor HTTP solo en `127.0.0.1`, solo GET/HEAD, ruta contenida en la carpeta (sin `..` ni enlaces), cabecera `Host` exacta (contra DNS rebinding) y CSP que permite solo el script en línea de `index.html` por su hash y prohíbe cualquier conexión externa.
- `src/main/office/craft/web-view.ts`: `WebContentsView` con partición propia en memoria, sin Node, sin preload, permisos y descargas denegados, y red cancelada salvo ese servidor. El archivo se entrega al motor desde el proceso principal simulando que se suelta en el lienzo (`DragEvent` con el archivo); el motor web no tiene una API de apertura.
- Si la versión web no está instalada o falla, el panel usa la vista previa en PDF de GridCraft/DeckCraft y, si tampoco, el visor de siempre.
- Lo que se descarga sigue siendo el archivo real. Pendiente: Word en el Chat, Windows real, y pasar `sandbox`/CSP por una revisión de seguridad formal antes de publicar.

## Trampa: el prompt del Chat vive en DOS lugares

El agente de Chat tiene sus instrucciones en `resources/opencode/agents/chat.md` **y** copiadas dentro de `src/main/opencode/config.ts` (config inline que recibe `opencode serve`). La inline **gana**. Un cambio solo en `chat.md` no llega al Chat: hay que aplicarlo también en `config.ts` (y se comprueba renderizando `buildInlineConfig()`). Esto hizo que el modelo dijera «no puedo poner gráficos en el Excel» aunque GridCraft sí los soporta.
