---
name: pptx
description: Crea presentaciones de PowerPoint (.pptx) en el Mac con portada y diapositivas de título más viñetas. Úsala cuando el usuario pida una presentación, deck o diapositivas.
---
# Skill: presentaciones PowerPoint (.pptx)

## Qué hay en este Mac
`python3 -c "import pptx"` → si funciona, existe `python-pptx` (permite imágenes, tablas y gráficos).
En un Mac normal **no está**; por eso esta skill incluye una plantilla que no necesita nada.

## Ruta A (sin dependencias): plantilla `make_pptx.py`
Genera un `.pptx` de 16:9 con una barra de color, portada y diapositivas de título + viñetas. Solo usa la
biblioteca estándar de Python (escribe las partes XML mínimas dentro de un zip).

1. Copia la plantilla desde el «Base directory for this skill» que te indica la herramienta `skill`:
   `cp "<directorio base>/make_pptx.py" .onyxcode/trabajo/make_pptx.py`
2. Edita `DIAPOSITIVAS` en la copia: la primera puede llevar `'portada': True` (título + subtítulo);
   el resto: `{'titulo': '…', 'texto': ['viñeta 1', 'viñeta 2']}`.
3. Ejecuta `python3 .onyxcode/trabajo/make_pptx.py presentacion-v1.pptx` (**nombre nuevo**: en el sandbox no se
   puede reemplazar ni renombrar un archivo existente).
4. **Verifica**: `python3 -c "import zipfile; z=zipfile.ZipFile('presentacion-v1.pptx'); print(z.testzip(), len(z.namelist()))"`
   debe imprimir `None` y un número de partes; y `zip -T presentacion-v1.pptx` debe decir `OK`.

Buenas prácticas: una idea por diapositiva, títulos cortos (máx. 8 palabras), 3-5 viñetas de pocas
palabras, la conclusión al principio. Si el texto es largo, divide en más diapositivas: la plantilla no
reduce el tamaño de letra por ti.

## Ruta B (con imágenes o gráficos): python-pptx
Solo si el usuario activó PyPI (interruptor de red de las tareas) y necesita imágenes o gráficos:
`python3 -m pip install --target ./.onyxcode/trabajo/pylib python-pptx` y luego
`PYTHONPATH=.onyxcode/trabajo/pylib python3 tu_script.py`. Nunca uses `pip install --user` (`~/Library/Python` no
es escribible en el sandbox). *(No se pudo comprobar en esta verificación: sin PyPI no hay red en el
sandbox; si falla, usa la ruta A o la C y dilo.)*

## Ruta C (respaldo): documento con una sección por diapositiva
Si `python3` no funciona, entrega un `.docx` (skill `docx`) o un `.md` con una sección por diapositiva y
dilo en **Para revisar**.

## Lo que NO se puede hacer aquí
- Imágenes, gráficos, tablas, animaciones, transiciones y notas del orador con la ruta A.
- Editar una presentación existente conservando su diseño: crea una versión nueva y avisa.
- Previsualizar con `qlmanage`/`open`: en el sandbox están bloqueados.
- Se comprobó la estructura (zip, XML bien formado y vista previa de macOS), **no** PowerPoint en sí:
  si al abrirlo PowerPoint propone «reparar», dilo al usuario y ofrece el `.docx`/`.md` de respaldo.
