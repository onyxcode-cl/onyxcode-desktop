# _shared (herramientas comunes de las skills de oficina)

No es una skill. Lo usan docx, xlsx, pptx y pdf. Intérprete: `$LAZUNOX_PYTHON` o `python3`. Solo escriben donde se les indica.

- `render.py <archivo.docx|xlsx|pptx|pdf> --outdir DIR [--dpi 110] [--max-pages 20]`
  Convierte a PDF con LibreOffice (si existe) y rasteriza cada página a PNG (pypdfium2). Imprime solo JSON:
  `{"ok":true,"pdf":"...","pngs":["...-p01.png"],"paginas":1,"avisos":[]}`.
  Salida: 0 ok, 1 sin render posible (ver `avisos`), 2 uso incorrecto. Sin LibreOffice avisa y no falla el resto del flujo.
- `doctor.py` : revisa Python, librerías y LibreOffice. JSON `{"python","librerias","libreoffice","faltan",...}`.
  Sale con 0 si están las imprescindibles (python-docx, openpyxl, python-pptx, pypdf, pypdfium2, pillow).
- `verify_images.py <png...>` : heurística visual (Pillow): página en blanco, contenido pegado al borde (margen < 2 %) y recortes.
  Imprime JSON con `avisos` por página.
- Pruebas: `python -m unittest tests/test_shared.py` (desde esta carpeta).
