# _shared (herramientas comunes de las skills de oficina)

No es una skill. Lo usan docx, xlsx, pptx y pdf. Intérprete: `$LAZUNOX_PYTHON` o `python3`. Solo escriben donde se les indica.

- `render.py <archivo.docx|xlsx|pptx|pdf> --outdir DIR [--dpi 110] [--max-pages 20]`
  Rasteriza cada página a PNG: .pptx con DeckCraft, .docx con WordCraft, .xlsx con GridCraft (programas de ArtCraft, que
  instala la app) y .pdf con pypdfium2. Imprime solo JSON:
  `{"ok":true,"pdf":"...","pngs":["...-p01.png"],"paginas":1,"avisos":[]}`.
  Salida: 0 ok, 1 sin render posible (ver `avisos`), 2 uso incorrecto. Sin ArtCraft avisa y no falla el resto del flujo.
- `doctor.py` : revisa Python, librerías y los programas de ArtCraft. JSON `{"python","librerias","deckcraft","wordcraft","gridcraft","faltan",...}`.
  Sale con 0 si están las imprescindibles (python-docx, openpyxl, python-pptx, pypdf, pypdfium2, pillow).
- `verify_images.py <png...>` : heurística visual (Pillow): página en blanco, contenido pegado al borde (margen < 2 %) y recortes.
  Imprime JSON con `avisos` por página.
- Pruebas: `python -m unittest tests/test_shared.py` (desde esta carpeta).
- `verificar_office.py <archivo.docx|xlsx|pptx> [--json] [--arreglar SALIDA.pptx | --en-sitio]` : revisión de calidad antes de entregar (local, gratis, sin ArtCraft). Lista corta ✔/✘:
  Word (título con estilo, encabezados, viñetas con estilo de lista, tablas sin celdas vacías), PowerPoint (marcador de título en cada diapositiva, nada fuera de los bordes; `--arreglar` escribe una copia con marcadores de título) y Excel (totales con fórmula viva, sin errores, valores recalculados). Salida 0 bien, 1 fallos, 2 uso.
  Pruebas: `python -m unittest tests/test_verificar_office.py`.
