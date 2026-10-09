---
name: docx
description: Crear, inspeccionar, editar y revisar documentos Word (.docx) profesionales: informes, cartas, contratos, actas, con tablas, imágenes, listas, comentarios y verificación visual.
---

# Skill docx (documentos Word)

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Abajo `PY` = ese intérprete y `S` = carpeta `scripts/` de esta skill.
Nunca sobrescribas el archivo del usuario: toda salida es un archivo NUEVO (`-v2`, `-revisado`).

## A. Crear un documento nuevo
1. Escribe el contenido en un JSON (esquema abajo), por ejemplo `contenido.json`, en la carpeta de la tarea.
2. Genera: `PY S/build_docx.py contenido.json informe.docx`
3. Verifica (obligatorio): `PY S/check_docx.py informe.docx` — corrige y repite hasta «RESULTADO: OK».
4. Si el check generó imágenes de página (`.lazunox/trabajo/render-docx/*.png`), ábrelas y MÍRALAS: títulos, tabla, cifras, imagen, sin páginas vacías.
   Para volver a renderizar usa una carpeta nueva (`mktemp -d`) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.
5. Entrega: indica la ruta del .docx y resume qué contiene (en «Para revisar»: lo que no pudiste comprobar).

### Esquema del JSON
Campos de nivel superior (todos opcionales salvo `blocks`): `title`, `subtitle`, `author`, `date` (texto, o `"hoy"` → «9 de octubre de 2026»),
`header` (texto arriba a la derecha), `footer` (texto en el pie), `page_numbers` (por defecto true: «Página X de Y»),
`toc` (true = índice), `page` (`{"size":"letter"|"a4","margin_cm":2.5,"landscape":false}`),
`theme` (`font`, `size`, `accent`, `table_header_bg`, colores en hex sin #). Por defecto: Carta, 2,5 cm, Calibri 11, azul marino sobrio.

Bloques (`blocks`, en orden):
| type | campos |
|---|---|
| `heading` | `level` 1-3, `text` |
| `paragraph` | `text` (usa `**negrita**`, `*cursiva*`), `align` (left/right/center/justify) |
| `bullets` / `numbered` | `items`: textos; una lista dentro de la lista = subnivel. Cada bloque `numbered` reinicia en 1 |
| `table` | `columns`, `rows`, `align` (por columna), `widths_cm`, `total_row` (última fila sombreada y en negrita), `zebra`, `decimals`, `caption` |
| `image` | `path` (relativa al JSON), `width_cm`, `caption` |
| `page_break` | — |

Los números (no texto) en celdas se formatean es-CL (`1234567.5` → `1.234.567,50`) y las columnas numéricas se alinean a la derecha solas.

Ejemplo mínimo completo:
```json
{"title":"Informe de ventas","subtitle":"Primer semestre 2026","author":"Equipo Comercial","date":"hoy","toc":false,
 "blocks":[
  {"type":"heading","level":1,"text":"Resumen"},
  {"type":"paragraph","text":"Las ventas crecieron **12,5%** frente a 2025."},
  {"type":"bullets","items":["Norte lidera","Centro estable"]},
  {"type":"table","columns":["Región","Ventas (CLP)"],"rows":[["Norte",1234567],["Centro",2345678],["Total",3580245]],
   "total_row":true,"caption":"Tabla 1. Ventas por región"}
 ]}
```
Salida: `Documento creado: informe.docx (4 bloques, 0 imágenes)`.

## B. Editar un documento existente
1. Entiende primero su estructura: `PY S/inspect_docx.py original.docx` (o `--json`). Muestra cada párrafo con su estilo, tablas, imágenes, comentarios y secciones.
2. Aplica los cambios a una COPIA (varias operaciones en una sola llamada, se ejecutan en orden):
```
PY S/edit_docx.py original.docx original-v2.docx \
  --reemplazar "2025" "2026" \
  --parrafo-despues "Vigencia" "Texto del párrafo nuevo con **negrita**" \
  --tabla-despues "Resumen" tabla.json \
  --imagen-despues "Figura" grafico.png 12 \
  --borrar-parrafo "BORRADOR" \
  --estilo "Introducción" "Heading 1"
```
   - `--reemplazar` actúa en cuerpo, tablas, encabezados y pies, conserva el formato aunque el texto esté partido en varios runs; reemplaza TODAS las apariciones.
   - `tabla.json` = un bloque `table` (`{"columns":[...],"rows":[...]}`). Para muchas operaciones usa `--ops ops.json` (lista de `{"op":"reemplazar","buscar":..,"por":..}`, `parrafo_despues`, `tabla_despues`, `imagen_despues`, `borrar_parrafo`, `estilo`).
   - Si un texto no se encuentra, nada se guarda (código 1): revisa con `inspect_docx.py` el texto exacto (las anclas son subcadenas, distinguen mayúsculas).
3. Verifica: `PY S/check_docx.py original-v2.docx` y compara con `inspect_docx.py`.

## C. Comentarios de Word
- Listar: `PY S/comments_docx.py listar documento.docx`
- Añadir (copia nueva): `PY S/comments_docx.py añadir documento.docx documento-revisado.docx --texto-ancla "frase exacta" --comentario "Verificar esta cifra" [--autor Lazunox]` (los pares se pueden repetir).

## D. Verificar siempre
`PY S/check_docx.py archivo.docx` abre el archivo, cuenta tablas/imágenes/encabezados y avisa de: párrafos vacíos consecutivos, estilos no definidos, saltos de nivel de encabezado, tablas sin encabezado, cambios registrados sin resolver y (si hay LibreOffice) páginas en blanco. Ejemplo de salida final: `RESULTADO: OK con 1 aviso(s)`. Con `--no-render` solo revisa la estructura. Si LibreOffice no está instalado lo dice y sigue: en ese caso decláralo en «Para revisar» («no se pudo comprobar el aspecto visual»).

## Buenas prácticas
- Usa encabezados reales (nivel 1-3), no texto grande en negrita. No uses Enter repetido para espaciar: ya hay espaciado en los estilos.
- Una idea por párrafo; tablas para cifras (nunca columnas con espacios); pie de tabla/figura con `caption`.
- Fechas «27 de septiembre de 2026»; cifras «1.234,5». Pasa números como números en `rows` y se formatean solos.
- `toc: true` inserta un índice con las entradas ya escritas, pero SIN números de página: Word los calcula al abrir (puede pedir «actualizar campos», aceptar).

## Lo que NO se puede hacer (decláralo en «Para revisar»)
- **Control de cambios real** (insertar/eliminar con autoría que el usuario acepte o rechace): no se genera. Lo que sí hay: editar una copia + comentarios. Los cambios registrados que ya existan se detectan pero no se aceptan ni rechazan.
- **Campos complejos** (referencias cruzadas, bibliografía, fórmulas, combinar correspondencia): solo se crean PAGE, NUMPAGES y TOC; los demás se conservan si ya existen pero no se pueden crear.
- Texto reemplazado mantiene el formato del primer carácter afectado; no se reordenan secciones complejas ni se editan cuadros de texto, formas, ecuaciones ni notas al pie.
- Comentarios anclados solo a texto dentro de un párrafo normal (no a hipervínculos ni a cuadros de texto).
- No convierte .doc antiguos ni .pdf a .docx; no firma ni protege con contraseña.
- El aspecto exacto en Word puede diferir mínimamente del render de LibreOffice.
