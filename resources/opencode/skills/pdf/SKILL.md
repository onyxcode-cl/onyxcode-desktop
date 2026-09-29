---
name: pdf
description: Prepara documentos para PDF y trabaja con PDF existentes en el Mac (leer texto, unir, extraer). Úsala cuando el usuario pida un PDF o pida leer, resumir o unir archivos PDF.
---
# Skill: PDF

## Crear un PDF: qué se puede y qué no (comprobado en el sandbox de las tareas)
- `textutil` **no puede convertir a PDF** (al pedirle ese formato responde `Invalid output format`).
- `cupsfilter -m application/pdf archivo.html` **no** convierte HTML (`No hay ningún filtro para convertir
  de text/html a application/pdf`), ni RTF, ni docx.
- `cupsfilter -m application/pdf archivo.txt > salida.pdf` sí funciona, pero solo para **texto plano**
  con fuente monoespaciada y sin negritas ni tablas. Úsalo solo si el usuario acepta ese aspecto.
- `cupsfilter -m application/pdf imagen.png > imagen.pdf` (o `sips -s format pdf imagen.png --out imagen.pdf`)
  convierte una imagen a PDF.
- En el sandbox no hay motor de maquetación (sin `wkhtmltopdf`, LibreOffice ni `reportlab` de serie).

### Ruta recomendada: HTML listo para «Guardar como PDF»
1. Escribe un `.html` autocontenido y bien maquetado (UTF-8, CSS en `<style>`, sin recursos externos:
   sin `<img src="http…">`, fuentes web ni scripts), con estilos de impresión: `@page { size: Letter; margin: 2cm }`,
   `table { border-collapse: collapse } td, th { border: 1px solid #888; padding: 4px 8px }`,
   `h1, h2 { break-after: avoid }` y `tr { break-inside: avoid }`. Nómbralo con guiones, p. ej. `informe-ventas.html`.
2. Verifica que existe y no está vacío (`ls -l informe-ventas.html`).
3. Entrégalo y **dile al usuario**: «Te dejé el informe como HTML; ábrelo en **Entregables** y pulsa
   **Guardar como PDF** para obtener el PDF». No prometas un PDF que no pudiste generar.

### Otra opción: Word
Si el usuario acepta Word, usa la skill `docx` (el documento se puede exportar a PDF desde Word/Pages).

## Leer, resumir o unir PDF existentes
Comprueba qué hay antes de elegir (no asumas):
`python3 -c "import pypdf; print(pypdf.__version__)"` · `which pdftotext`
- **Texto**: `pdftotext -layout archivo.pdf -` si existe; si no, con `pypdf`:
  `python3 -c "import pypdf,sys; r=pypdf.PdfReader('archivo.pdf'); print('\n'.join(p.extract_text() for p in r.pages))"`
- **Unir**: con `pypdf` (`PdfWriter().add_page(...)`, `write('unido.pdf')`) o `pdfunite a.pdf b.pdf unido.pdf` si existe.
- Un PDF **escaneado** (imagen) no tiene texto que extraer: no hay OCR disponible; dilo y pídele al
  usuario el texto o un PDF con texto.
- Si ni `pypdf` ni `pdftotext` existen y el usuario activó PyPI: `python3 -m pip install --target ./.cowork/pylib pypdf`
  y `PYTHONPATH=.cowork/pylib python3 …` (nunca `pip install --user`). *(La descarga no se pudo comprobar
  en esta verificación, porque sin PyPI activado no hay red en el sandbox.)*

## Reglas
- Archivos auxiliares en `./.cowork/`; los resultados con un nombre **nuevo** (en el sandbox no se puede
  reemplazar ni renombrar un archivo existente, y nunca sobrescribas un original).
- No uses `open`, `qlmanage` ni `osascript`: están bloqueados en el sandbox.
- Cita la fuente (archivo y página) de todo dato que extraigas de un PDF.
