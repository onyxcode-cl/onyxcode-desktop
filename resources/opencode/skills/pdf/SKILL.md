---
name: pdf
description: Úsala para leer/extraer texto y tablas de un PDF, crear un PDF profesional, unir/dividir/rotar páginas, rellenar formularios PDF o estampar marca de agua y numeración, o traducir un PDF a otro idioma conservando exactamente su diseño (sección F, script translate_pdf.py).
---

# Skill PDF

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. En los ejemplos: `PY`.
Scripts en `scripts/` (usa la ruta de esta skill). Escribe solo en la carpeta de la tarea o en `./.lazunox/trabajo/`.
Salidas siempre NUEVAS (nunca sobrescribas el original; para «editar» crea `-v2`).

## Flujo: 1) Crear/editar  2) Verificar  3) Entregar

### A. Leer / extraer
1. `PY scripts/extract_pdf.py doc.pdf` (texto por página en pantalla). Opciones: `--paginas 1-3,5`, `--tablas`,
   `--formato json -o datos.json`, `--formato csv --outdir tablas/` (un CSV por tabla).
2. Si dice `AVISO: ... ESCANEADO` (código de salida 2): el PDF son imágenes. **No hay OCR**. No inventes el contenido:
   dilo al usuario y pide una versión con texto.
3. Tablas: solo se detectan si tienen líneas o columnas bien alineadas; revisa el resultado y avisa si dudas.

### B. Crear un PDF
1. Escribe el contenido en JSON (o Markdown simple) y ejecuta:
   `PY scripts/build_pdf.py contenido.json -o informe.pdf` (añade `--portada`, `--indice`, `--autor "Ana"`, `--pie "Confidencial"`).
2. JSON mínimo:
```json
{"titulo":"Informe de ventas","subtitulo":"Tercer trimestre","autor":"Equipo","portada":true,"indice":true,
 "bloques":[
  {"tipo":"titulo","nivel":1,"texto":"Resumen"},
  {"tipo":"parrafo","texto":"Las ventas subieron **12,5%**."},
  {"tipo":"lista","ordenada":false,"items":["Uno","Dos"]},
  {"tipo":"tabla","encabezado":["Región","Ventas"],"filas":[["Norte","1.234.567"],["Sur","987.654"]]},
  {"tipo":"imagen","ruta":"grafico.png","ancho_cm":14,"pie":"Figura 1"},
  {"tipo":"salto"}]}
```
   Markdown: `# Título` (del documento), `##`/`###` secciones, `-` listas, tablas con `|`, `![pie](img.png)`, `---` salto de página.
3. Ya incluye: encabezado, pie con «Página X de N», cifras alineadas a la derecha, encabezado de tabla repetido, fuentes
   incorporadas, fecha «27 de septiembre de 2026». Escribe las cifras ya formateadas es-CL (`1.234,5`).
   `"pagina":"carta"` cambia de A4 a Carta.

### C. Unir, dividir, rotar, reordenar, eliminar
```
PY scripts/merge_split_pdf.py unir a.pdf b.pdf -o junto.pdf
PY scripts/merge_split_pdf.py extraer a.pdf --paginas 2-4 -o parte.pdf
PY scripts/merge_split_pdf.py rotar a.pdf --paginas 1,3 --grados 90 -o rotado.pdf
PY scripts/merge_split_pdf.py reordenar a.pdf --orden 3,1,2 -o orden.pdf     # nombra TODAS las páginas
PY scripts/merge_split_pdf.py eliminar a.pdf --paginas 2 -o sin2.pdf
PY scripts/merge_split_pdf.py dividir a.pdf --outdir partes                  # una página por archivo
```
Rangos: `1-3,5,8-` (1 = primera página).

### D. Formularios (AcroForm)
```
PY scripts/fill_form_pdf.py listar ficha.pdf            # nombres de campo, tipo y valor
PY scripts/fill_form_pdf.py rellenar ficha.pdf --campo nombre="Ana Pérez" --campo rut=12.345.678-5 -o ficha-v2.pdf
PY scripts/fill_form_pdf.py rellenar ficha.pdf --datos datos.json --aplanar -o ficha-final.pdf
```
Usa los nombres exactos que muestra `listar`. Casillas: pasa el valor que figure en sus opciones (p. ej. `/Yes`, `Sí`).
`--aplanar` deja el texto fijo (ya no editable). Si no hay campos, el script avisa (código 2): no se puede rellenar así.

### E. Estampar
`PY scripts/stamp_pdf.py in.pdf -o out.pdf --marca BORRADOR --numerar --titulo "Informe" --autor "Ana"`
(cualquier combinación; al menos una acción).

### F. Traducir un PDF SIN cambiar el diseño
Úsalo cuando pidan «traduce este PDF» y quieran que se vea igual (mismas hojas, fuente, tamaño y posiciones). Funciona sobre el
MISMO PDF: cambia solo los textos; logos, imágenes, líneas, resaltados y numeración quedan donde estaban. Solo PDF con texto.
1. `PY scripts/translate_pdf.py extraer doc.pdf -o segmentos.json`. Si dice «ESCANEADO» (código 2): no hay OCR, avísalo y para.
2. Lee `segmentos.json` y escribe `traduccion.json` = `{"p1-0": "texto traducido", ...}` (mismo `id` que en segmentos.json):
   - Traduce TODO el texto con significado; si un texto es un nombre propio, código o cifra, déjalo igual (o no lo incluyas).
   - Conserva las etiquetas `<b>…</b>` (negrita) donde estaban, y los números, fechas y referencias exactos.
   - Si el segmento trae `"resaltado"`, envuelve en `[[ ]]` la parte traducida que corresponde a lo resaltado (si es «todo», no hace falta).
   - NO traduzcas código, comandos, rutas, URLs, correos, nombres de archivo ni claves de configuración: déjalos idénticos (o no los incluyas).
   - Mantén cada traducción de largo parecido al original; el script reduce la letra si no cabe, pero no inventes texto.
   - Traduce por tandas de ~40 segmentos y usa el contexto del documento (un mismo término se traduce igual en todo el documento).
3. `PY scripts/translate_pdf.py aplicar doc.pdf -t traduccion.json -o doc-en.pdf --informe informe.json`
   El informe lista `sin_traduccion`, `letra_reducida` y `no_cabe`. Código de salida 3 = algo no cabe: revisa esas páginas.
4. Verifica como siempre (`check_pdf.py --render`) y **mira las páginas PNG junto al original**: textos que chocan, celdas de tabla
   apretadas, resaltados mal puestos. Corrige la traducción de esos segmentos (más corta) y vuelve a aplicar con otro nombre de salida.
Limitaciones conocidas (dilas si aplican): una línea con varios colores o con un enlace dentro sale de un solo color y el enlace sigue en su
posición original; texto dentro de imágenes y texto vertical no se traducen; PDF escaneado: sin OCR.
Idiomas: fuentes Arial/Times/Courier (o Liberation) (Latin: español, inglés, francés, alemán, portugués…). Para chino, árabe, ruso, etc. no hay fuente
todavía: dilo en vez de entregar un PDF con cuadritos.

### Verificar (obligatorio antes de entregar)
`PY scripts/check_pdf.py salida.pdf --render --outdir ./.lazunox/trabajo/render`
Imprime páginas, tamaño, texto extraíble, páginas en blanco y rutas de los PNG (usa `_shared/render.py`).
**Mira al menos las primeras páginas PNG**: títulos cortados, tablas desbordadas, imágenes deformadas. Corrige y regenera.
Para volver a renderizar usa una carpeta nueva (`mktemp -d`) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.
Resultado esperado: `RESULTADO: correcto`. Si dice «revisar avisos», explica cada aviso o corrígelo.

### Entregar
Resume qué hiciste, nombre del archivo y páginas. Lo no resuelto va en **«Para revisar»**.

## Limitaciones (dilas siempre que apliquen)
- **PDF escaneado: sin OCR.** No se puede extraer su texto; no inventes. Pide versión con texto.
- **No se puede modificar el texto de un PDF ya hecho** (cambiar una frase, corregir una cifra), salvo traducirlo entero (sección F). Ofrece **regenerarlo**
  (con `build_pdf.py` a partir del contenido extraído, corregido) o editar la fuente original (Word/Excel) y exportarlo de nuevo.
  El diseño original no se reproduce idéntico al regenerar: avísalo.
- **PDFs con contraseña:** hay que pedir la clave al usuario y pasarla con `--clave`. No se eliminan protecciones ni se adivinan claves.
- Extracción de PDFs con varias columnas o maquetación compleja: el orden de lectura puede mezclarse; revisa el resultado.
- Tablas sin líneas ni alineación clara pueden no detectarse o salir partidas.
- Formularios XFA (dinámicos) no son compatibles; solo AcroForm.
- Fuentes del PDF generado: las base de PDF (Helvetica); cubren español/Latin-1, no alfabetos no latinos ni emojis.
- Marca de agua y numeración se dibujan encima del contenido; no se pueden «quitar» después.
