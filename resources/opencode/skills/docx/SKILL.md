---
name: docx
description: Crea o lee documentos de Word (.docx) en el Mac, con títulos, tablas y viñetas. Úsala cuando el usuario pida un informe, carta, acta o cualquier entregable en formato Word.
---
# Skill: documentos Word (.docx)

Sirve para **crear** un `.docx` desde cero y para **leer** el texto de un `.docx`/`.doc`/`.rtf`/`.odt`
existente. Todo se hace con herramientas que ya trae macOS y con `python3` (Command Line Tools); no
necesita internet ni instalar nada. En las tareas (sandbox) estos comandos están comprobados dentro del
sandbox.

## Antes de empezar
- Comprueba `python3 --version`. Si falla o pide instalar las herramientas de desarrollo, usa la
  ruta B (solo `textutil`) y dilo en el resumen.
- Trabaja en `./.onyxcode/trabajo/` para los archivos auxiliares y deja solo el `.docx` final a la vista.
- **Usa siempre un nombre de archivo NUEVO** (`informe-v2.docx`): en el sandbox, `textutil` y `mv`
  fallan con "Operation not permitted"/"no tienes permiso" al reemplazar o renombrar un archivo
  existente. Nunca sobrescribas un original del usuario.

## Ruta A (recomendada): documento con estructura real
La plantilla `make_docx.py` de esta skill genera títulos con estilos reales de Word (Título, Título 1-3,
que salen en el panel de navegación), párrafos con **negrita**, viñetas y tablas de verdad con borde y
encabezado sombreado. Usa solo la biblioteca estándar de Python.

1. Copia la plantilla desde el «Base directory for this skill» que te indica la herramienta `skill`:
   `cp "<directorio base>/make_docx.py" .onyxcode/trabajo/make_docx.py`
2. Edita en la copia la lista `CONTENIDO` (bloques `titulo`, `h1`/`h2`/`h3`, `p`, `ul`, `tabla`) y
   `SALIDA`, o pasa el nombre como argumento.
3. Ejecuta: `python3 .onyxcode/trabajo/make_docx.py informe-ventas.docx`
4. **Verifica** (obligatorio):
   - `textutil -convert txt informe-ventas.docx -stdout | head -40` debe mostrar el texto, sin error.
   - Si hay tablas: `textutil -convert html informe-ventas.docx -stdout | grep -c '<table'` debe dar 1 o más.

Formato: hoja Carta (Chile), márgenes de 2,5 cm, Calibri 11. Cifras y fechas ya formateadas por ti en
es-CL (`1.234,5`; `27 de septiembre de 2026`): la plantilla no reformatea nada.

## Ruta B: solo texto simple, con `textutil`
Para documentos de texto corrido sin tablas: escribe un `.html` limpio en `./.onyxcode/trabajo/` (`<h1>`, `<h2>`,
`<p>`, `<ul>`, `<b>`; `<meta charset="utf-8">`) y conviértelo:

`textutil -convert docx .onyxcode/trabajo/informe.html -output informe-v1.docx`

Limitaciones **comprobadas** de esta ruta:
- Las **tablas HTML se aplanan**: cada celda pasa a ser un párrafo suelto, sin filas ni bordes. Si
  hay tablas, usa la ruta A.
- Los títulos quedan como texto grande en negrita, **no** como estilos de Word.
- Las **imágenes no se incrustan**.
- `textutil` no puede convertir a PDF (responde "Invalid output format"): para PDF usa la skill `pdf`.

## Leer un documento existente
`textutil -convert txt "documento.docx" -stdout` (también `.doc`, `.rtf`, `.odt`). Devuelve el texto
plano; se pierden tablas y formato. Para editar un `.docx` que ya existe: no lo modifiques; crea una
**copia nueva** con el contenido corregido (ruta A) y avisa de que puede perder formato original.

## Lo que NO se puede hacer aquí
- Imágenes, encabezados y pies de página, tabla de contenidos, comentarios, control de cambios y campos.
- Abrir el resultado en Word o previsualizarlo con `qlmanage`/`open`: en el sandbox están bloqueados.
  El usuario lo verá en el panel **Entregables** (vista previa de texto) o abriéndolo él mismo.
- Garantizar que Word lo abra con el mismo aspecto: se comprobó la estructura (zip, XML, lectura con
  `textutil` y vista previa de macOS), no Word en sí. Si algo falla, dilo en **Para revisar**.
