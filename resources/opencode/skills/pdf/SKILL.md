---
name: pdf
description: Úsala para leer/extraer texto y tablas de un PDF, crear un PDF profesional (el mismo HTML y motor de impresión que el Chat: build_chat_pdf.py), unir/dividir/rotar páginas, rellenar formularios PDF o estampar marca de agua y numeración, o traducir un PDF a otro idioma conservando exactamente su diseño (sección F, script translate_pdf.py).
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

### B. Crear un PDF (camino principal: el MISMO HTML y motor de impresión que el Chat)
**Si tienes la herramienta `documentos_crear` (la ofrece la app), úsala en lugar del script:** `documentos_crear` con `tipo: "pdf"`, `nombre` (sin extensión) y `html` (el HTML completo del documento, autocontenido y sin recursos externos). Es el MISMO motor y la MISMA guía de diseño que el Chat, sin escribir archivos intermedios ni necesitar Node, y da el mismo resultado en macOS y en Windows. El archivo queda en la carpeta de esta tarea (nunca pisa uno existente: si el nombre existe añade « (2)») y la respuesta trae su ruta. Si responde con un error de contenido, corrige y repite con OTRO nombre; si dice que falta el diseñador de documentos (ArtCraft), díselo al usuario («Ajustes → Tareas → Componentes opcionales») y sigue con el script de abajo si lo hay. Cada `crear` deja un archivo NUEVO: crea y revisa como mucho 2 veces (corrige TODO de una vez, no por partes) y en «Para revisar» di cuál es el archivo definitivo, para no dejar un montón de versiones. Sin la herramienta, usa el script.
En el Chat el modelo escribe UN bloque ```html completo (con `<style>` embebido) y la app lo imprime a PDF con Chromium (A4, con fondos); aquí es igual, y por eso el resultado es el mismo.
1. Escribe el documento en `documento.html` (HTML completo, un solo `<style>`, sin red: solo imágenes `data:`; el HTML es DATO: se imprime, no se confía en él) siguiendo la guía de diseño de abajo.
2. `PY scripts/build_chat_pdf.py documento.html informe.pdf` → `PDF creado: informe.pdf (HTML del Chat impreso con …)`. Usa el Chrome, Edge, Brave o Chromium que haya en el equipo (o `$LAZUNOX_CHROMIUM`) con la misma política de contenido que el Chat (CSP, sin red, perfil temporal) y nunca sobrescribe.
   Códigos: 0 ok · 1 corrige según el mensaje (HTML vacío o de más de 5 MB, salida existente) o, si dice que el navegador no pudo imprimir, sigue con B2 · 2 uso · **3 = no hay navegador Chromium en este equipo: no insistas, sigue con B2**.
3. Verifica (sección Verificar) y MIRA las páginas: el diseño debe verse como lo escribiste.

#### Guía de diseño (la misma del Chat)
Diseño del PDF: es un documento impreso, no una página web. Escribe un documento HTML completo con UN solo <style> embebido, sin imágenes ni fuentes de internet (solo imágenes data:) y con fuentes que existen en todos los equipos (Georgia, Arial, Verdana, Trebuchet MS, Times New Roman). Define @page { size: A4; margin: 18mm }, o margin: 0 si el diseño llega al borde (por ejemplo un encabezado de color a página completa). Jerarquía tipográfica clara: título de 28 a 36 px, secciones de 18 a 22 px, cuerpo de 11 a 12 px con line-height 1.45, texto alineado a la izquierda y como mucho 2 familias de letra. Una paleta intencional según el tema (un color de acento y neutros, no el celeste genérico) con buen contraste: texto oscuro sobre fondo claro o al revés, nunca gris claro sobre blanco; los fondos y bloques de color sí se imprimen. Tablas con th de fondo propio, filas separadas por una línea fina, cifras alineadas a la derecha, tr { page-break-inside: avoid } y títulos con page-break-after: avoid; una sección grande empieza con page-break-before: always. Cada documento se diseña según su contenido y propósito (una cotización, un afiche, un informe, una carta y un certificado no se parecen): cambia composición, color y tipografía de uno a otro en vez de repetir una plantilla, y pon al menos un elemento visual real (franja de color, cifra destacada, tabla bien hecha, forma con CSS) además del texto corrido. Revisa que nada se corte en el borde ni quede una página casi vacía.

### B2. Ruta de respaldo (sin navegador, o datos que se arman solos: índice, «Página X de N», tablas largas)
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
Úsalo cuando pidan «traduce este PDF» y quieran que se vea igual (mismas hojas, fuente, tamaño y posiciones). Funciona sobre una COPIA del
MISMO PDF (nunca el original: la salida lleva el sufijo del idioma, `doc-en.pdf`, y el script se niega si ya existe): cambia solo los textos; logos, imágenes, líneas, resaltados y numeración quedan donde estaban. Solo PDF con texto.
1. `PY scripts/translate_pdf.py extraer doc.pdf -o segmentos.json` (deja el texto por traducir en un JSON de pares: tú solo traduces texto). Si dice «ESCANEADO» (código 2): no hay OCR, avísalo y para.
2. Lee `segmentos.json` y escribe `traduccion.json` = `{"p1-0": "texto traducido", ...}` (mismo `id` que en segmentos.json):
   - Traduce TODO el texto con significado; si un texto es un nombre propio, código o cifra, déjalo igual (o no lo incluyas).
   - Conserva las etiquetas `<b>…</b>` (negrita), `<c=#rrggbb>…</c>` (color) y `<l=N>…</l>` (enlace) alrededor de la parte traducida equivalente (así el enlace sigue funcionando), y los números, fechas y referencias exactos.
   - Si un segmento trae `"sigue": "p2-0"`, su frase continúa en ese otro id (la hoja cortó la frase): traduce ambos de modo que juntos se lean como una sola frase natural.
   - Si el segmento trae `"resaltado"`, envuelve en `[[ ]]` la parte traducida que corresponde a lo resaltado (si es «todo», no hace falta).
   - NO traduzcas código, comandos, rutas, URLs, correos, nombres de archivo ni claves de configuración: déjalos idénticos (o no los incluyas).
   - Mantén cada traducción de largo parecido al original; el script reduce la letra si no cabe, pero no inventes texto.
   - Traduce por tandas de ~40 segmentos y usa el contexto del documento (un mismo término se traduce igual en todo el documento).
3. `PY scripts/translate_pdf.py aplicar doc.pdf -t traduccion.json -o doc-en.pdf --informe informe.json`
   El informe lista `sin_traduccion`, `letra_reducida` y `no_cabe`. Código de salida 3 = algo no cabe: revisa esas páginas.
4. El script termina comparando la estructura con el original (`ESTRUCTURA: idéntica al original`: mismas páginas, tamaños, imágenes y dibujos; también suelto: `PY scripts/../../_shared/comparar_estructura.py doc.pdf doc-en.pdf`). Si dice «CAMBIÓ», no entregues ese PDF.
5. Verifica como siempre (`check_pdf.py --render`) y **mira las páginas PNG junto al original**: textos que chocan, celdas de tabla
   apretadas, resaltados mal puestos. Corrige la traducción de esos segmentos (más corta) y vuelve a aplicar con otro nombre de salida.
Limitaciones conocidas (dilas si aplican): si omites una etiqueta `<l=N>`, ese enlace se quita (el informe lo lista en `enlaces_quitados`);
texto dentro de imágenes y texto vertical no se traducen; PDF escaneado: sin OCR.
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
- Fuentes del PDF de la ruta B2 (`build_pdf.py`): las base de PDF (Helvetica); cubren español/Latin-1, no alfabetos no latinos ni emojis.
- Marca de agua y numeración se dibujan encima del contenido; no se pueden «quitar» después.
