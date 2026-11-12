---
name: xlsx
description: Crea, edita, revisa, verifica y TRADUCE planillas Excel (.xlsx) profesionales con fórmulas reales, formatos es-CL y gráficos. Crear: escribe el mismo JSON del Chat y genéralo con build_chat_xlsx.py (mismo motor y guía de diseño que el Chat). Para traducir un Excel conservando todo su diseño usa translate_xlsx.py (sección C), no escribas tu propio script.
---

# Skill xlsx (Excel)

**Regla 0 (lo primero): si tienes la herramienta `documentos_crear`, crea el documento NUEVO con ella y míralo con `documentos_renderizar`; NO uses los scripts `build_chat_*` ni armes el archivo a mano.** Es el mismo motor del Chat, funciona igual en macOS y en Windows y deja el archivo en la carpeta de la tarea. Los scripts de abajo son solo el respaldo cuando la herramienta no existe (editar un archivo que ya existe, traducir y revisar siguen con las secciones de más abajo).

Nunca dejes «[PENDIENTE…]», «[TODO]» ni «[…]» dentro del documento entregado: si falta un dato, usa un valor de ejemplo plausible marcado como ficticio o estimado («cifras de ejemplo» en una nota o el pie) o redacta sin la cifra; nunca inventes datos reales del usuario (nombres, montos de contratos). `documentos_crear` RECHAZA el documento si trae marcadores («[PENDIENTE…]», «[TODO]», «lorem», «xxx»); solo para una plantilla o formulario que el usuario pidió con campos vacíos, pasa `allow_placeholders: true`. Tampoco sirven los sinónimos («a definir», «por definir», «por confirmar», «n/d», «pendiente» como único contenido de una celda): si falta una cifra, escribe un valor de ejemplo plausible y márcalo como «cifra de ejemplo» en una nota o el pie; quitar la tabla o la cifra solo si no aporta. Si `documentos_crear` rechaza el documento o aparece como «invalid», NO cambies a python ni a scripts: lee el mensaje, corrige el campo que indica (los argumentos son `tipo`, `nombre` y `spec`, un objeto JSON) y vuelve a llamarla. Un script solo si la herramienta dice que falta el motor; esos archivos también se revisan al renderizarlos. Un Excel se crea SIEMPRE con `documentos_crear` tipo xlsx, no con openpyxl ni otro script: así las fórmulas salen con su valor calculado (el respaldo build_xlsx.py también calcula y guarda los valores de las fórmulas soportadas). En una tarea de documentos NUNCA entregues un .html u otro formato en lugar del pedido (presentación, Word, Excel o PDF): si dudas, decide tú con un supuesto razonable y decláralo en «Para revisar»; no uses el paso «Pregunta» salvo imposibilidad real. No dejes archivos de prueba: si creas versiones intermedias, bórralas y nombra el definitivo (el último que creaste) en «Para revisar». Un presupuesto o inversión SIEMPRE lleva cifras (de ejemplo, marcadas); «en evaluación» no vale.

**Ciclo obligatorio de calidad (crear → renderizar → mirar → corregir):**
1. **Crea** con `documentos_crear` siguiendo la guía de diseño (reglas numéricas y lista de «no hagas esto»).
2. **Renderiza** con `documentos_renderizar` el archivo creado y **mira TODAS las imágenes**, no solo la primera ni la última.
3. Anota los defectos **por prioridad**: (a) texto cortado o fuera de la página, (b) elementos montados unos sobre otros, (c) contraste bajo o letra menor que el mínimo, (d) márgenes y separaciones apretados, (e) desalineación, páginas casi vacías o tablas partidas, (f) restos de plantilla («lorem», «TODO», «[insert») y errores de fórmula (#REF!, #DIV/0!…).
4. **Corrige todo junto**: vuelve a crear el documento con otro nombre aplicando TODAS las correcciones en una sola vuelta (no arregles de a uno). Corrige en el contenido (`spec` o `html`), no a mano sobre el archivo.
5. Vuelve a renderizar. **Máximo 3 rondas** en total; si la segunda ronda no mejora, para y declara en «Para revisar» lo que sigue mal. La primera vuelta casi siempre trae errores reales: nunca entregues sin mirar.
6. Si la vista previa es la **VISTA SIMPLIFICADA** (no verificada), no concluyas nada sobre píxeles (caja gris, tipografía o gráfico simplificado no son errores): comprueba el contenido y la revisión ✔/✘, y escribe en «Para revisar» que el aspecto visual **no está verificado**.


Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Scripts en `scripts/` (abajo `PY` = ese intérprete,
`S` = carpeta `scripts` de esta skill). Escribe SIEMPRE a archivos NUEVOS en la carpeta de la tarea; nunca sobrescribas el original.

## Flujo: 1) Crear/editar  2) Verificar  3) Entregar

### A. Crear un libro nuevo (camino principal: el MISMO motor que el Chat)
**Si tienes la herramienta `documentos_crear` (la ofrece la app), úsala en lugar del script:** `documentos_crear` con `tipo: "xlsx"`, `nombre` (sin extensión) y `spec` (el JSON del esquema de abajo: sheets…). Es el MISMO motor y la MISMA guía de diseño que el Chat, sin escribir archivos intermedios ni necesitar Node, y da el mismo resultado en macOS y en Windows. El archivo queda en la carpeta de esta tarea (nunca pisa uno existente: si el nombre existe añade « (2)») y la respuesta trae su ruta. Si responde con un error de contenido, corrige y repite con OTRO nombre; si dice que falta el diseñador de documentos (ArtCraft), díselo al usuario («Ajustes → Tareas → Componentes opcionales») y sigue con el script de abajo si lo hay. Cada `crear` deja un archivo NUEVO: crea y revisa como mucho 2 veces (corrige TODO de una vez, no por partes) y en «Para revisar» di cuál es el archivo definitivo, para no dejar un montón de versiones. Sin la herramienta, usa el script.
En el Chat el modelo solo escribe un bloque con JSON y la app arma el Excel con GridCraft (que además calcula las fórmulas); aquí es igual, y por eso el resultado es el mismo.
1. Escribe `spec.json` con el esquema del Chat (abajo), siguiendo la guía de diseño.
2. `PY $S/build_chat_xlsx.py spec.json informe.xlsx` → `Creado: informe.xlsx (2 hojas, motor del Chat)`. Valida con el mismo validador del Chat (si algo no cumple lo dice y no genera nada) y nunca sobrescribe.
   Códigos: 0 ok · 1 corrige el contenido según el mensaje y repite con OTRO nombre de salida · 2 uso · **3 = GridCraft, Node o el motor no están en este equipo: no insistas, sigue con A2**.
3. Verifica (sección Verificar) y entrega.

Esquema del Chat: `{"sheets":[{"name":"Nombre de hoja","rows":[["Encabezado 1","Encabezado 2"],["dato",123]],"columnFormats":[null,"currency"]}]}` — la primera fila de cada hoja es el encabezado y sale en negrita sola, con fondo propio. Los números van como número de JSON de verdad (nunca como texto, nunca con puntos o comas de miles). `columnFormats` es un array alineado con las columnas (null = sin formato) con alguno de estos valores por columna: "currency" (peso/moneda, con $ y separador de miles), "integer" (separador de miles sin decimales), "decimal" (dos decimales), "percent" — úsalo SIEMPRE que una columna sea plata, cantidad o porcentaje. Para un total u otro cálculo usa una fórmula de Excel de verdad: en vez de un número, la celda va como `{"formula":"SUM(B2:B5)","value":1100000}` — formula es la fórmula (sin el = adelante, en inglés: SUM, AVERAGE, etc.) y value el resultado YA calculado por ti (Excel la recalcula sola al abrir el archivo; value es solo para que la vista previa muestre algo mientras tanto). Hasta 10 hojas, 5.000 filas y 60 columnas por hoja, 2.000 caracteres por celda; un texto que empieza con = se guarda como texto, solo `{"formula":…}` es fórmula.
Gráficos nativos (se editan en Excel): cada hoja puede traer `"charts":[{"type":"column","range":"A1:C7","title":"Ventas y costos (millones CLP)"}]`. type es column, bar, line, pie o area. range es un rango CONTINUO con encabezados: la primera columna son las categorías (p.ej. los meses) y cada columna siguiente es una serie, con su encabezado como nombre — NO incluyas la fila de total, y si solo quieres graficar algunas columnas, ordénalas una al lado de la otra en la hoja. Opcionales: at (celda de la esquina del gráfico, p.ej. "F2"; sin esto va a la derecha de los datos) y width/height (en puntos, entre 120 y 1200; por defecto 520×300). Hasta 4 por hoja.

#### Guía de diseño (la misma del Chat)
Diseño del Excel: una tabla por hoja, con el encabezado en la primera fila (corto y sin celdas vacías) y sin filas ni columnas en blanco dentro de los datos; con varias hojas, el resumen va primero y cada hoja se llama por lo que contiene. Ordena las columnas para leer de izquierda a derecha: nombre o identificador, luego cantidades, luego importes y al final los calculados. Los datos son número de JSON de verdad y columnFormats se pone SIEMPRE: currency para plata, integer para cantidades, decimal para medidas y percent para porcentajes (la celda guarda la fracción: 0.22 se ve como 22 %). Los cálculos son fórmulas reales en inglés y con coma (SUM, AVERAGE, IF, VLOOKUP) sobre el rango exacto de los datos (SUM(C2:C9), nunca el total pegado como número), con su value ya calculado; la fila de totales va al final con «Total», «Subtotal», «Suma» o «Promedio» en la primera celda (así sale con fondo y línea propios) y queda fuera del range de un gráfico. Un gráfico solo si muestra algo que la tabla no deja ver (tendencia, partes de un total): column para comparar categorías, line para el tiempo, pie con 5 porciones o menos, area para acumulados; todas las series de un gráfico deben tener la misma unidad y escala (si mezclas unidades con pesos el gráfico queda plano: grafica solo una de las dos), con title claro y at para ponerlo junto a los datos sin taparlos. Textos de celda cortos: un párrafo dentro de una celda se corta. Cada planilla se arma según su propósito, no con una plantilla fija: un presupuesto, un inventario y un registro de gastos no tienen las mismas columnas, totales ni gráficos; piensa qué necesita la persona para decidir y arma eso. Reglas numéricas: encabezados de hasta 25 caracteres y textos de celda de hasta 60; hasta 12 columnas por hoja para que se lea sin desplazarse hacia los lados; nombres de hoja de hasta 31 caracteres y sin los símbolos : / ? * [ ]; entre 1 y 2 gráficos por hoja y hasta 5 series por gráfico; los supuestos (tasas, metas, factores) van en celdas propias, rotuladas, y las fórmulas las referencian en vez de repetir el número dentro de la fórmula. Opciones nativas de la hoja (todas opcionales): freeze congela al desplazarse (row = encabezado, que es lo normal; column = primera columna; both; none); columnWidths da el ancho en caracteres por columna (6 a 80, null = automático) y solo se usa si el ajuste automático no basta; filter true pone filtros en el encabezado de tablas de más de 20 filas; conditional (hasta 6) resalta valores importantes sin marcar a mano, cada uno con range sin la fila de encabezado (D2:D20), rule (above o below el promedio, greater o less con value, between con value y value2, text con text, duplicates, scale para escala de color, bars para barras de datos) y color red, green o amber; validations (hasta 6) restringe lo que se escribe después, con range y type list con values (hasta 20 textos cortos, sin comas ni comillas), whole o decimal con min y max. Úsalas cuando ayudan a decidir (semáforo de estados, metas, listas de estados), no por adorno. La revisión compara cada value que declaras con el que calcula el programa: si no coincide, en tu resumen usa el valor del archivo, no el tuyo. Cero errores: ninguna fórmula puede devolver #REF!, #DIV/0!, #NAME?, #VALUE! o #N/A (usa IF para evitar dividir por cero) y nunca se mezclan pesos con unidades en una misma suma. No hagas esto: números pegados como texto, totales escritos a mano, filas o columnas en blanco dentro de los datos, celdas combinadas, un párrafo dentro de una celda, columnas de ancho desproporcionado, un gráfico que repite lo que ya dice la tabla, un gráfico de torta con más de 5 porciones y hojas de relleno sin datos.

### A2. Ruta de respaldo y casos que el esquema del Chat no cubre
Si `build_chat_xlsx.py` sale con código 3, o si necesitas **filtros, validaciones de datos, formato condicional, hoja de resumen con KPI, fechas con formato, columnas calculadas con `{r}` o gráficos apilados**, usa el generador propio
(`PY $S/build_xlsx.py --example` imprime un ejemplo completo): `PY $S/build_xlsx.py spec.json -o informe.xlsx` → `Creado informe.xlsx (2 hojas: Resumen, Ventas)`. Calcula y guarda los valores sin GridCraft, conservando las fórmulas para que Excel recalcule. Camino corto: **construir → verificar una vez → entregar**; solo repite si hay un defecto concreto. El esquema está más abajo; aplica la misma guía de diseño.

### B. Editar un libro existente (siempre crea copia `-v2`)
1. Mira qué hay: `PY $S/inspect_xlsx.py original.xlsx` (hojas, rangos, fórmulas, formatos, gráficos) o
   `PY $S/inspect_xlsx.py original.xlsx --sheet Hoja1 --cells A1:F20`.
2. Escribe `ops.json` y ejecuta `PY $S/edit_xlsx.py original.xlsx --ops ops.json -o original-v2.xlsx`
   (`--help-ops` lista las operaciones). Ejemplo:
```json
[{"op":"set_cells","sheet":"Ventas","cells":{"B2":150,"F1":"IVA"}},
 {"op":"add_column","sheet":"Ventas","header":"IVA","header_row":4,"formula":"=D{r}*0.19","format":"clp"},
 {"op":"append_rows","sheet":"Notas","rows":[["Revisado","2026-09-27"]]},
 {"op":"add_chart","sheet":"Ventas","type":"column","title":"Ventas","categories":"A5:A8","series":["C4:C8"],"anchor":"J3"},
 {"op":"format","sheet":"Ventas","range":"A4:G4","bold":true,"fill":"DCE6F4"}]
```
   `add_column` no incluye la fila «Total». `{r}` = número de fila. Los estilos, anchos, otras hojas y gráficos existentes se conservan.

### C. Traducir un Excel conservando todo su diseño
Usa SIEMPRE `translate_xlsx.py` (no abras y guardes el libro con openpyxl: perdería gráficos e imágenes, y no regeneres el libro con `build_xlsx.py`). Trabaja sobre una COPIA y cambia SOLO los textos: las celdas, números, fechas, fórmulas, estilos, anchos, combinaciones, filtros, validaciones, formato condicional, gráficos e imágenes quedan como estaban (las demás partes del archivo se copian byte a byte). El original nunca se toca.
1. `PY $S/translate_xlsx.py extraer libro.xlsx -o segmentos.json` (código 2 = sin texto). Lista cada texto con su id (`s12` cadena de celda, `i1-3` texto en línea, `c1-0` comentario, `g1-0` texto de gráfico, `d1-0` cuadro de texto) y, para las celdas, dónde está (`celdas`: `Hoja!A1`) para dar contexto. El script deja el texto por traducir en ese JSON de pares: tú solo traduces texto.
2. Traduce cada `texto` y guarda `traduccion.json` = `{"s12": "texto traducido", ...}` (mismos ids). Un texto con formato mixto viene con etiquetas `<r1>…</r1><r2>…</r2>`: consérvalas alrededor de la parte equivalente. No traduzcas nombres propios, códigos, SKU, cifras, rutas ni correos; usa el mismo término para lo mismo en todo el libro y traduce por tandas de ~40 textos. Encabezados de columna y etiquetas de celda: cortos (el ancho de las columnas NO cambia).
3. `PY $S/translate_xlsx.py aplicar libro.xlsx -t traduccion.json -o libro-en.xlsx --informe informe.json` — la salida es SIEMPRE un archivo NUEVO con el sufijo del idioma (`-en`, `-es`, `-fr`…); si ya existe, el script se niega. Antes de escribir compara en memoria la estructura de la copia con el original celda por celda (referencia, estilo, tipo y fórmula) y debe decir `ESTRUCTURA: idéntica al original`; si dice «CAMBIÓ» no crea la copia: corrige la traducción y repite. El informe lista `sin_traduccion`, `formato_simplificado` y `posible_recorte` (celdas donde la traducción ya no cabe en el ancho de su columna: acórtala).
4. Verifica: `PY $S/recalc_check.py libro-en.xlsx` (las fórmulas siguen dando lo mismo) y `PY $S/check_xlsx.py libro-en.xlsx --render <carpeta nueva>`; MIRA las páginas junto a las del original (títulos de gráfico, encabezados cortados, `#####`).
5. Declara en «Para revisar» lo que NO se traduce: nombres de hoja (las fórmulas los usan), listas de validación escritas dentro de la regla, nombres definidos y textos que son resultado de una fórmula (se recalculan solos). Un texto traducido puede ser más largo que el original.

### Verificar (obligatorio antes de entregar)
**Revisión de calidad (obligatoria, antes de decir «listo»):** `"$PY" "$S/../../_shared/verificar_office.py" archivo.xlsx` (local y gratis; imprime una lista ✔/✘). **Si creaste el archivo con `documentos_crear`, su respuesta YA trae esta revisión (lista ✔/✘, hecha por la herramienta): no hace falta correr el script, salvo que la respuesta diga «NO corrida».** Comprueba: totales con fórmula viva (no número pegado), ninguna celda con error (#REF!, #DIV/0!…), rangos de total que cubren las filas de datos y valores guardados comparados con un cálculo nuevo. `build_xlsx.py` y `edit_xlsx.py` guardan los resultados calculados localmente. **Una revisión basta**: si da OK, entrega; si aparece ✘, corrige las celdas indicadas en una copia nueva y vuelve a verificar. Un AVISO de fórmula no soportada no es un fallo: di en «Para revisar» qué celdas quedan sin verificar; no reconstruyas el libro ni repitas comprobaciones por la ausencia de GridCraft.
Si lo creaste con `documentos_crear`, mira cómo quedó con `documentos_renderizar` (devuelve una imagen por página; también funciona en Windows y sirve para un archivo que hiciste con `bash`: ruta relativa a la carpeta de la tarea) y corrige todo de una vez.
- `PY $S/recalc_check.py archivo.xlsx` es diagnóstico opcional: recalcula y compara sin modificar el archivo (la revisión anterior YA lo hace). Indica la celda si falta un valor o no coincide y qué corregir; salida 0 = OK, con avisos separados para fórmulas no soportadas. No rellena ni repara valores: para eso vuelve a construir o editar en una copia nueva.
- `PY $S/check_xlsx.py archivo.xlsx --render ./.lazunox/trabajo/render` → estructura, columnas estrechas (#####), números guardados como texto y PNG si hay motor de render; MIRA las imágenes disponibles (gráfico legible, títulos y ejes, nada cortado). Sin GridCraft la ausencia de vista previa no invalida el cálculo local; declara solo el aspecto visual sin verificar.
- Para volver a renderizar usa otra carpeta DENTRO de `./.lazunox/trabajo/` (`render2`, `render3`…; nunca `mktemp`, `/tmp` ni `$TMPDIR`: quedan fuera de la tarea y piden un permiso que no se puede conceder) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.

## Esquema JSON de build_xlsx.py (ruta A2)
```json
{ "output": "ventas.xlsx",
  "properties": {"title": "Ventas 2026", "author": "Lazunox"},
  "summary": {"name": "Resumen", "title": "Resumen", "subtitle": "CLP",
     "kpis": [{"label": "Ventas totales", "formula": "={total:Ventas:C}", "format": "clp"}],
     "charts": [{"type": "pie", "title": "Participación", "data_sheet": "Ventas", "categories": "A", "series": ["C"], "anchor": "E3"}]},
  "sheets": [{
     "name": "Ventas", "title": "Ventas por producto", "subtitle": "Primer semestre", "tab_color": "1F3864",
     "columns": [
        {"header": "Producto", "width": 22},
        {"header": "Unidades", "format": "integer", "total": "sum"},
        {"header": "Ventas", "format": "clp", "total": "sum"},
        {"header": "Precio unit.", "format": "clp", "formula": "=C{r}/B{r}"},
        {"header": "Margen", "format": "percent", "total": "average"},
        {"header": "Cierre", "format": "date"}, {"header": "Estado"}],
     "rows": [["Notebook", 120, 96000000, null, 0.22, "2026-06-30", "Cerrado"]],
     "total_row": true, "total_label": "Total", "freeze": true, "autofilter": true, "zebra": true,
     "conditional": [{"column": "E", "rule": "less_than", "value": 0.2, "fill": "FFC7CE", "font_color": "9C0006"},
                     {"column": "C", "rule": "data_bar"}],
     "validations": [{"column": "G", "type": "list", "values": ["Pendiente", "Cerrado"], "extra_rows": 20},
                     {"column": "E", "type": "decimal", "min": 0, "max": 1}],
     "charts": [{"type": "column", "title": "Ventas por producto", "x_title": "Producto", "y_title": "CLP",
                 "categories": "Producto", "series": ["Ventas"], "anchor": "I3"}] }] }
```
- `format`: `text integer number clp usd eur uf percent percent0 date date_long datetime month` o un código Excel (`0.00"%"`).
  Se guarda como código Excel estándar y se ve con la región del usuario (es-CL: `1.234,5`, `$1.234`, `27-09-2026`).
- Filas: listas (en el orden de `columns`) o diccionarios `{"Producto": ...}`. `null` en una columna con `formula` la rellena. Fechas: `"2026-09-27"`.
- Fórmulas: texto que empieza con `=`, funciones en INGLÉS (`SUM`, `IF`, `VLOOKUP`), separador `,`; `{r}` = fila actual.
  Usa en cualquier fórmula `{total:Hoja:COL}` (celda del total) y `{col:Hoja:COL}` (rango exacto de datos, independiente de títulos y subtítulos). `total`: `sum|average|count|min|max` o fórmula; prefiere `total: "sum"` o `=SUM({col:Ventas:C})` a números de fila fijos. El constructor rechaza totales simples que no cubran las filas de datos.
- Gráficos: `type` = `column` (vertical), `bar` (horizontal), `line`, `pie`, `stacked_column`; `categories`/`series` por letra (`"B"`) o texto
  del encabezado; `data_sheet` si el gráfico va en otra hoja; siempre pon `title` y, salvo torta, `x_title` e `y_title`.
- `conditional.rule`: `greater_than less_than equal not_equal between(value,value2) text_contains color_scale data_bar`.
- Códigos de salida: 0 ok, 1 fallo al guardar, 2 spec inválida (mensaje en español dice qué corregir).

## Buenas prácticas
- Cálculos con FÓRMULAS (`=SUM(B2:B9)`), nunca el resultado pegado como número. Datos de entrada en celdas, no dentro de la fórmula.
- Funciones modernas (TEXTJOIN, XLOOKUP, IFS, SWITCH, CONCAT, MAXIFS, MINIFS, XMATCH, DAYS, XOR, STDEV.S…): escríbelas con su nombre normal; `build_xlsx.py` y `edit_xlsx.py` les añaden solas el prefijo `_xlfn.` que exige el formato (sin él salen como `#NAME?`). Las de matrices dinámicas (FILTER, SORT, UNIQUE, SEQUENCE) no se soportan: evítalas.
- Una tabla por hoja, encabezado en la primera fila de la tabla, sin filas ni columnas en blanco dentro de los datos.
- Números como números (no texto «1.234»). Porcentaje como fracción (0,22 con formato `percent`).
- Hoja `Resumen` primero cuando haya varias hojas.

## Limitaciones (dilas en «Para revisar» si afectan)
- El cálculo local cubre aritmética, referencias A1 y rangos entre hojas, SUM, SUMIF/SUMIFS, COUNT/COUNTA/COUNTIF/COUNTIFS, AVERAGE, MAX, MIN, ROUND, IF/IFERROR, INDEX con MATCH exacto (tercer argumento 0), VLOOKUP exacto (cuarto argumento FALSE), DATE, ABS, AND/OR/NOT y TRUE/FALSE. Sin dependencias nuevas. Las demás fórmulas y las que dependan de ellas se avisan por celda, sin inventar un valor. GridCraft puede ampliar la verificación si está instalado. No se calculan localmente referencias a columnas completas, nombres definidos, vínculos externos, matrices ni rangos mayores de 200 000 celdas. Excel conserva el recálculo automático al abrir.
- NO crea ni conserva bien: tablas dinámicas (pivot), segmentaciones, macros (.xlsm solo se conservan con `keep_vba`, no se crean),
  gráficos combinados/de dos ejes, minigráficos (sparklines), formato condicional con extensiones de Excel 2010+ (barras de datos avanzadas), vínculos externos.
  Al editar un libro con esos elementos el script avisa; si son críticos, no los edites: entrega un libro nuevo y explica.
- Los gráficos se editan solo agregando nuevos; no se modifican los existentes (se pierden detalles finos de su formato al reescribir).
- Archivos protegidos con contraseña o muy grandes (>100 000 filas) no están soportados.
- Fórmulas dinámicas (FILTER, SORT, UNIQUE, XLOOKUP) pueden dar #NAME? en Excel antiguo: verifica con valores.
