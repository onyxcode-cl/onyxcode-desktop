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
  Word (título con estilo, encabezados, viñetas con estilo de lista, tablas sin celdas vacías), PowerPoint (marcador de título en cada diapositiva, nada fuera de los bordes; `--arreglar` escribe una copia con marcadores de título) y Excel (totales con fórmula viva, rangos completos, sin errores y valores recalculados localmente comparados con los guardados; no exige GridCraft). Las fórmulas no soportadas se listan como AVISO, sin ✘ ni valores inventados. Salida 0 bien, 1 fallos, 2 uso.
  Pruebas: `python -m unittest tests/test_verificar_office.py`.
- `output_file.py`: entrega bytes ya preparados con una apertura y escritura normal, sin temporales, borrado ni renombrado en el destino. Por defecto usa creación exclusiva y rechaza cualquier archivo existente, incluso si apareció durante el cálculo. Solo `verificar_office.py --en-sitio` reescribe un PowerPoint recién creado por el agente. XLSX prepara el ZIP y sus valores calculados en memoria; la traducción verifica también su estructura antes de escribir. Las limpiezas de los renderizadores se limitan a temporales del sistema. Un fallo de preparación o un permiso denegado al abrir no deja una salida nueva; un fallo físico durante la escritura no admite garantía atómica sin renombrado/borrado, se informa como error y nunca como entrega válida.
  Pruebas: `python -m unittest tests/test_output_file.py` y `xlsx/tests/test_no_destination_temp.py`.
