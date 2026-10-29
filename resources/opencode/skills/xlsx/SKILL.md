---
name: xlsx
description: Crea, edita, revisa, verifica y TRADUCE planillas Excel (.xlsx) profesionales con fórmulas reales, formatos es-CL y gráficos. Crear: escribe el mismo JSON del Chat y genéralo con build_chat_xlsx.py (mismo motor y guía de diseño que el Chat). Para traducir un Excel conservando todo su diseño usa translate_xlsx.py (sección C), no escribas tu propio script.
---

# Skill xlsx (Excel)

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
Diseño del Excel: una tabla por hoja, con el encabezado en la primera fila (corto y sin celdas vacías) y sin filas ni columnas en blanco dentro de los datos; con varias hojas, el resumen va primero y cada hoja se llama por lo que contiene. Ordena las columnas para leer de izquierda a derecha: nombre o identificador, luego cantidades, luego importes y al final los calculados. Los datos son número de JSON de verdad y columnFormats se pone SIEMPRE: currency para plata, integer para cantidades, decimal para medidas y percent para porcentajes (la celda guarda la fracción: 0.22 se ve como 22 %). Los cálculos son fórmulas reales en inglés y con coma (SUM, AVERAGE, IF, VLOOKUP) sobre el rango exacto de los datos (SUM(C2:C9), nunca el total pegado como número), con su value ya calculado; la fila de totales va al final con «Total», «Subtotal», «Suma» o «Promedio» en la primera celda (así sale con fondo y línea propios) y queda fuera del range de un gráfico. Un gráfico solo si muestra algo que la tabla no deja ver (tendencia, partes de un total): column para comparar categorías, line para el tiempo, pie con 5 porciones o menos, area para acumulados; todas las series de un gráfico deben tener la misma unidad y escala (si mezclas unidades con pesos el gráfico queda plano: grafica solo una de las dos), con title claro y at para ponerlo junto a los datos sin taparlos. Textos de celda cortos: un párrafo dentro de una celda se corta. Cada planilla se arma según su propósito, no con una plantilla fija: un presupuesto, un inventario y un registro de gastos no tienen las mismas columnas, totales ni gráficos; piensa qué necesita la persona para decidir y arma eso.

### A2. Ruta de respaldo y casos que el esquema del Chat no cubre
Si `build_chat_xlsx.py` sale con código 3, o si necesitas **filtros, validaciones de datos, formato condicional, hoja de resumen con KPI, fechas con formato, columnas calculadas con `{r}` o gráficos apilados**, usa el generador propio
(`PY $S/build_xlsx.py --example` imprime un ejemplo completo): `PY $S/build_xlsx.py spec.json -o informe.xlsx` → `Creado informe.xlsx (2 hojas: Resumen, Ventas)`. El esquema está más abajo; aplica la misma guía de diseño.

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
3. `PY $S/translate_xlsx.py aplicar libro.xlsx -t traduccion.json -o libro-en.xlsx --informe informe.json` — la salida es SIEMPRE un archivo NUEVO con el sufijo del idioma (`-en`, `-es`, `-fr`…); si ya existe, el script se niega. Al terminar compara la estructura de la copia con el original celda por celda (referencia, estilo, tipo y fórmula) y debe decir `ESTRUCTURA: idéntica al original`; si dice «CAMBIÓ» descarta la copia y repite. El informe lista `sin_traduccion`, `formato_simplificado` y `posible_recorte` (celdas donde la traducción ya no cabe en el ancho de su columna: acórtala).
4. Verifica: `PY $S/recalc_check.py libro-en.xlsx` (las fórmulas siguen dando lo mismo) y `PY $S/check_xlsx.py libro-en.xlsx --render <carpeta nueva>`; MIRA las páginas junto a las del original (títulos de gráfico, encabezados cortados, `#####`).
5. Declara en «Para revisar» lo que NO se traduce: nombres de hoja (las fórmulas los usan), listas de validación escritas dentro de la regla, nombres definidos y textos que son resultado de una fórmula (se recalculan solos). Un texto traducido puede ser más largo que el original.

### Verificar (obligatorio antes de entregar)
Si lo creaste con `documentos_crear`, mira cómo quedó con `documentos_renderizar` (devuelve una imagen por página; también funciona en Windows) y corrige todo de una vez.
- `PY $S/recalc_check.py archivo.xlsx` → calcula las fórmulas con GridCraft (ArtCraft) y lista valores, errores (#DIV/0!, #REF!, #NAME?, #VALUE!)
  y fórmulas que apuntan a celdas vacías. Salida 0 = bien. Revisa que los totales den lo esperado (calcúlalo tú aparte con los datos).
- `PY $S/check_xlsx.py archivo.xlsx --render ./.lazunox/trabajo/render` → estructura, columnas estrechas (#####), números guardados
  como texto, y PNG por página; MIRA las imágenes (¿gráfico legible, títulos y ejes, nada cortado?).
- Si GridCraft (ArtCraft) no está instalado el script lo dice: entonces los valores NO están verificados y debes decirlo en «Para revisar».
- Para volver a renderizar usa una carpeta nueva (`mktemp -d`) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.

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
  En `summary` usa `{total:Hoja:COL}` (celda del total) y `{col:Hoja:COL}` (rango de datos). `total`: `sum|average|count|min|max` o fórmula.
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
- openpyxl NO calcula: los valores se verifican con GridCraft (ArtCraft, `recalc_check.py`); sin él quedan sin verificar y Excel los calculará al abrir.
- NO crea ni conserva bien: tablas dinámicas (pivot), segmentaciones, macros (.xlsm solo se conservan con `keep_vba`, no se crean),
  gráficos combinados/de dos ejes, minigráficos (sparklines), formato condicional con extensiones de Excel 2010+ (barras de datos avanzadas), vínculos externos.
  Al editar un libro con esos elementos el script avisa; si son críticos, no los edites: entrega un libro nuevo y explica.
- Los gráficos se editan solo agregando nuevos; no se modifican los existentes (se pierden detalles finos de su formato al reescribir).
- Archivos protegidos con contraseña o muy grandes (>100 000 filas) no están soportados.
- Fórmulas dinámicas (FILTER, SORT, UNIQUE, XLOOKUP) pueden dar #NAME? en Excel antiguo: verifica con valores.
