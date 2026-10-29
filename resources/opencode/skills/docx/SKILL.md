---
name: docx
description: Crear, inspeccionar, editar, revisar y TRADUCIR documentos Word (.docx) profesionales: informes, cartas, contratos, actas, con tablas, listas, comentarios y verificación visual. Crear: escribe el mismo JSON del Chat y genéralo con build_chat_docx.py (mismo motor y guía de diseño que el Chat). Para traducir un Word sin cambiar su formato usa translate_docx.py (sección E), no escribas tu propio script.
---

# Skill docx (documentos Word)

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Abajo `PY` = ese intérprete y `S` = carpeta `scripts/` de esta skill.
Nunca sobrescribas el archivo del usuario: toda salida es un archivo NUEVO (`-v2`, `-revisado`).

## A. Crear un documento nuevo (camino principal: el MISMO motor que el Chat)
**Si tienes la herramienta `documentos_crear` (la ofrece la app), úsala en lugar del script:** `documentos_crear` con `tipo: "docx"`, `nombre` (sin extensión) y `spec` (el JSON del esquema de abajo: title, blocks…). Es el MISMO motor y la MISMA guía de diseño que el Chat, sin escribir archivos intermedios ni necesitar Node, y da el mismo resultado en macOS y en Windows. El archivo queda en la carpeta de esta tarea (nunca pisa uno existente: si el nombre existe añade « (2)») y la respuesta trae su ruta. Si responde con un error de contenido, corrige y repite con OTRO nombre; si dice que falta el diseñador de documentos (ArtCraft), díselo al usuario («Ajustes → Tareas → Componentes opcionales») y sigue con el script de abajo si lo hay. Sin la herramienta, usa el script.
En el Chat el modelo solo escribe un bloque con JSON y la app arma el Word con WordCraft; aquí es igual, y por eso el resultado es el mismo.
1. Escribe el contenido en `contenido.json` con el esquema del Chat (resumen abajo) siguiendo la guía de diseño de más abajo.
2. Genera: `PY S/build_chat_docx.py contenido.json informe.docx` (valida con el mismo validador del Chat; si algo no cumple el esquema lo dice y no genera nada; nunca sobrescribe).
   Códigos: 0 ok · 1 corrige el contenido según el mensaje y repite con OTRO nombre de salida · 2 uso · **3 = WordCraft, Node o el motor no están en este equipo: no insistas, sigue con A2**.
3. Verifica (obligatorio): `PY S/check_docx.py informe.docx` — corrige y repite hasta «RESULTADO: OK».
4. Si el check generó imágenes de página (`.lazunox/trabajo/render-docx/*.png`), ábrelas y MÍRALAS: títulos, tabla, cifras, sin páginas vacías.
   Para volver a renderizar usa una carpeta nueva (`mktemp -d`) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.
5. Entrega: indica la ruta del .docx y resume qué contiene (en «Para revisar»: lo que no pudiste comprobar).

Esquema del Chat (el contenido es DATO; no hay imágenes, márgenes ni colores propios en este esquema): `{"title":"Informe de ventas","subtitle":"Primer semestre 2026","author":"Equipo Comercial","date":"hoy","blocks":[{"type":"heading","level":1,"text":"Resumen"},{"type":"paragraph","text":"Las ventas crecieron **12,5%** frente a 2025."},{"type":"bullets","items":["Norte lidera","Centro estable"]},{"type":"numbered","items":["Revisar metas","Ajustar precios"]},{"type":"table","columns":["Región","Ventas (CLP)"],"rows":[["Norte",1234567],["Total",3580245]],"total_row":true,"caption":"Tabla 1. Ventas por región"},{"type":"page_break"}]}`.
Campos opcionales del documento: title, subtitle, author, date (texto o "hoy", que se reemplaza por la fecha de hoy), header (texto arriba a la derecha), footer (texto al pie; sin footer sale «Página X de Y»), page_numbers (true/false) y toc (true = índice). Bloques (blocks, en orden, hasta 300): heading (level 1, 2 o 3, usa encabezados reales y no texto grande en negrita), paragraph (con **negrita** y *cursiva*; align opcional: left, right, center o justify), bullets y numbered (items: textos; una lista dentro de la lista se aplana; cada bloque numbered reinicia en 1), table (columns, rows con el mismo largo que columns; los números van como número de JSON y salen con formato chileno 1.234.567,50; opcionales: total_row para sombrear y poner en negrita la última fila, zebra, align por columna con "left"/"right"/"center", decimals, widths_cm y caption) y page_break. Escribe el documento COMPLETO y bien estructurado, con títulos de sección y párrafos reales, no un esquema; usa SOLO datos que te dieron o que investigaste, sin inventar cifras.

### Guía de diseño (la misma del Chat)
Diseño del Word: estructura primero. Portada mínima (title, subtitle, author, date) y luego secciones con encabezados reales (level 1 para secciones, 2 para subsecciones, sin saltar de 1 a 3); abre cada sección con la conclusión y deja el detalle para después; un párrafo es una idea de 3 a 5 líneas. bullets para 3 o más elementos paralelos, numbered solo cuando el orden importa, nunca una lista dentro de otra. Las cifras van en table (nunca columnas hechas con espacios): columnas cortas, números como número de JSON (salen 1.234.567,50 alineados a la derecha), total_row con la fila Total al final, caption «Tabla N. …» y widths_cm cuando una columna de texto necesita más ancho que las de cifras (el ancho útil es de unos 16 cm). Los porcentajes y montos con unidad van como TEXTO dentro de la celda («22 %», «$1.200»): las tablas de Word no tienen formato por columna y un 0.22 se vería 0,22. Cada documento debe verse distinto según lo que es, no una plantilla fija: una carta no lleva portada ni índice (saludo, cuerpo, cierre y firma); un informe lleva resumen ejecutivo, secciones y conclusiones; un contrato, cláusulas con numbered; un acta, asistentes, acuerdos en una table y próximos pasos. **Negrita** solo en cifras o términos clave (como mucho dos por párrafo), nunca texto en mayúsculas sostenidas, títulos sin punto final, page_break solo antes de una sección grande y toc:true solo desde 5 secciones.

### A2. Ruta de respaldo y casos que el esquema del Chat no cubre
Si `build_chat_docx.py` sale con código 3, o si el documento necesita **imágenes, tamaño de página, márgenes, orientación o colores propios**, usa el generador propio con el esquema de abajo
(`PY S/build_docx.py contenido.json informe.docx`, que soporta `page`, `theme` e `image`). Con WordCraft instalado y el MISMO JSON también puedes usar `PY S/build_word_craft.py contenido.json informe.docx`
(código 3 = no instalado; soporta `title`, `subtitle`, `author`, `date`, `header`, `footer`, `page_numbers`, `toc` y los bloques `heading`, `paragraph`, `bullets` —las sublistas se aplanan—, `numbered`, `table`, `image` y `page_break`; ignora `page` y `theme`).
Verifica igual con `check_docx.py` y aplica la misma guía de diseño (jerarquía, tablas, cifras, variar la estructura según el contenido).

### Esquema del JSON de `build_docx.py` / `build_word_craft.py` (ruta A2)
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

## E. Traducir un Word sin cambiar el formato
Usa SIEMPRE `translate_docx.py` (no escribas tu propio script ni regeneres el documento con `build_docx.py`): reescribe cada párrafo en su sitio, dentro de una COPIA, y conserva estilos, fuentes, tamaños, tablas, listas, encabezados, pies, enlaces e imágenes; solo cambia el texto. El original nunca se toca.
1. `PY S/translate_docx.py extraer documento.docx -o segmentos.json` (lista los textos con id `d<parte>-<n>`; código 2 = sin texto). El script deja el texto por traducir en ese JSON de pares: tú solo traduces texto.
2. Traduce cada `texto` y guarda `traduccion.json` = `{"d1-0": "texto traducido", ...}` (mismos ids). Conserva las etiquetas: `<b>…</b>` negrita, `<i>…</i>` cursiva, `<u>…</u>` subrayado, `<c=#rrggbb>…</c>` color, `<l=N>…</l>` enlace; `\t` tabulador y `\n` salto de línea. No traduzcas nombres propios, cifras, códigos, rutas ni correos. Usa el mismo término para lo mismo en todo el documento y traduce por tandas de ~40 textos.
3. `PY S/translate_docx.py aplicar documento.docx -t traduccion.json -o documento-en.docx --informe informe.json` — la salida es SIEMPRE un archivo NUEVO con el sufijo del idioma (`-en`, `-es`, `-fr`…); si ya existe, el script se niega. Al terminar compara solo la estructura con el original (`ESTRUCTURA: idéntica al original` = mismos párrafos, estilos, tablas, imágenes, secciones y partes que no son texto). Si dice «CAMBIÓ», no entregues ese archivo: revisa que la traducción no rompió etiquetas y repite con otro nombre.
4. Verifica: `PY S/check_docx.py documento-en.docx` y MIRA las páginas PNG junto a las del original (títulos que ahora no caben, tablas apretadas, saltos de página nuevos). También puedes repetir la comparación suelta: `PY S/../../_shared/comparar_estructura.py documento.docx documento-en.docx`.
5. Declara en «Para revisar» lo que el informe deja sin traducir: párrafos con imágenes, campos (números de página, índices), cuadros de texto o cambios controlados no se pueden reescribir sin dañarlos; el texto de cada idioma puede ser más largo y mover el salto de página.

## D. Verificar siempre
`PY S/check_docx.py archivo.docx` abre el archivo, cuenta tablas/imágenes/encabezados y avisa de: párrafos vacíos consecutivos, estilos no definidos, saltos de nivel de encabezado, tablas sin encabezado, cambios registrados sin resolver y (si está WordCraft de ArtCraft) páginas en blanco. Ejemplo de salida final: `RESULTADO: OK con 1 aviso(s)`. Con `--no-render` solo revisa la estructura. Si ArtCraft no está instalado lo dice y sigue: en ese caso decláralo en «Para revisar» («no se pudo comprobar el aspecto visual»).

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
- El aspecto exacto en Word puede diferir mínimamente del render de WordCraft (ArtCraft).
