---
name: xlsx
description: Crea, edita, revisa y verifica planillas Excel (.xlsx) profesionales con fórmulas reales, formatos es-CL, gráficos, filtros y validaciones.
---

# Skill xlsx (Excel)

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Scripts en `scripts/` (abajo `PY` = ese intérprete,
`S` = carpeta `scripts` de esta skill). Escribe SIEMPRE a archivos NUEVOS en la carpeta de la tarea; nunca sobrescribas el original.

## Flujo: 1) Crear/editar  2) Verificar  3) Entregar

### A. Crear un libro nuevo
1. Escribe `spec.json` (esquema abajo; `PY $S/build_xlsx.py --example` imprime un ejemplo completo).
2. `PY $S/build_xlsx.py spec.json -o informe.xlsx`  → `Creado informe.xlsx (2 hojas: Resumen, Ventas)`.
3. Verifica (sección Verificar) y entrega.

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

### Verificar (obligatorio antes de entregar)
- `PY $S/recalc_check.py archivo.xlsx` → calcula las fórmulas con LibreOffice y lista valores, errores (#DIV/0!, #REF!, #NAME?, #VALUE!)
  y fórmulas que apuntan a celdas vacías. Salida 0 = bien. Revisa que los totales den lo esperado (calcúlalo tú aparte con los datos).
- `PY $S/check_xlsx.py archivo.xlsx --render ./.lazunox/trabajo/render` → estructura, columnas estrechas (#####), números guardados
  como texto, y PNG por página; MIRA las imágenes (¿gráfico legible, títulos y ejes, nada cortado?).
- Si LibreOffice no está instalado el script lo dice: entonces los valores NO están verificados y debes decirlo en «Para revisar».

## Esquema JSON de build_xlsx.py
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
- Una tabla por hoja, encabezado en la primera fila de la tabla, sin filas ni columnas en blanco dentro de los datos.
- Números como números (no texto «1.234»). Porcentaje como fracción (0,22 con formato `percent`).
- Hoja `Resumen` primero cuando haya varias hojas.

## Limitaciones (dilas en «Para revisar» si afectan)
- openpyxl NO calcula: los valores se verifican con LibreOffice (`recalc_check.py`); sin él quedan sin verificar y Excel los calculará al abrir.
- NO crea ni conserva bien: tablas dinámicas (pivot), segmentaciones, macros (.xlsm solo se conservan con `keep_vba`, no se crean),
  gráficos combinados/de dos ejes, minigráficos (sparklines), formato condicional con extensiones de Excel 2010+ (barras de datos avanzadas), vínculos externos.
  Al editar un libro con esos elementos el script avisa; si son críticos, no los edites: entrega un libro nuevo y explica.
- Los gráficos se editan solo agregando nuevos; no se modifican los existentes (se pierden detalles finos de su formato al reescribir).
- Archivos protegidos con contraseña o muy grandes (>100 000 filas) no están soportados.
- Fórmulas dinámicas (FILTER, SORT, UNIQUE, XLOOKUP) pueden dar #NAME? en LibreOffice antiguo: verifica con valores.
