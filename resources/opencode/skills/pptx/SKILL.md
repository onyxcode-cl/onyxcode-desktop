---
name: pptx
description: Crear, editar, inspeccionar y verificar presentaciones PowerPoint (.pptx) profesionales en 16:9 con gráficos nativos, tablas, imágenes y notas del orador.
---

# Skill pptx (PowerPoint)

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Scripts en `scripts/` (usa python-pptx y Pillow).
Todos los archivos de salida deben ser NUEVOS (nunca sobrescribas el original del usuario).

## 1. Crear una presentación
1. Escribe un JSON (esquema abajo) en la carpeta de la tarea, p. ej. `deck.json`.
2. Genera: `python3 scripts/build_pptx.py deck.json informe.pptx --theme sobrio`
   (temas: `sobrio` azul/dorado, `oscuro`, `claro` crema/verde). Salida: `Presentación creada: informe.pptx (12 diapositivas, tema sobrio)`.
3. Si el script imprime `Aviso:` (título largo, texto largo) corrige el JSON y vuelve a generar.
   Las listas largas se dividen solas en «Título (1/3)», «(2/3)»… y las tablas de más de 9 filas también.

## 2. Verificar (siempre)
`python3 scripts/check_pptx.py informe.pptx --outdir .lazunox/trabajo/chk`
- Revisa: abre, nº de diapositivas, texto que desborda (estimado), formas fuera del lienzo, diapositivas sin título,
  imágenes diminutas/de baja resolución. Código de salida 1 = hay PROBLEMAS: corrige y repite.
- Renderiza con LibreOffice y crea `.lazunox/trabajo/chk/miniaturas.png` (todas las diapositivas en una imagen):
  MÍRALA con la herramienta de imágenes y comprueba que nada se corta ni se superpone.
- Si no hay LibreOffice avisa «solo hay verificación estructural»: dilo en «Para revisar».

## 3. Entregar
Indica la ruta del .pptx y, en «Para revisar», lo que no pudiste comprobar (render, fuentes, animaciones).

## Esquema JSON
Rutas de imágenes relativas al JSON. `notes` (notas del orador) es opcional en toda diapositiva.
```json
{
  "theme": "sobrio", "title": "Resultados 2026", "author": "Ana Pérez",
  "footer": "Informe anual 2026", "slide_numbers": true,
  "slides": [
    {"type": "cover", "title": "Resultados anuales 2026", "subtitle": "Resumen para el directorio",
     "author": "Ana Pérez", "date": "auto", "notes": "Saludar y presentar el objetivo."},
    {"type": "bullets", "title": "Puntos clave",
     "bullets": ["Ventas +12 %", {"text": "Costos controlados", "sub": ["Logística", "Energía"]}, "Nuevo mercado"]},
    {"type": "two_col", "title": "Antes y después",
     "left":  {"heading": "Antes", "bullets": ["Proceso manual", "5 días"]},
     "right": {"heading": "Después", "bullets": ["Automatizado", "1 día"]}},
    {"type": "image_text", "title": "Nueva sede", "image": "sede.png", "image_side": "left",
     "bullets": ["120 puestos", "Abre en marzo"], "caption": "Fuente: arquitectura"},
    {"type": "table", "title": "Ventas por región", "columns": ["Región", "Ventas (M$)", "Var. %"],
     "rows": [["Norte", "1.234,5", "12,0"], ["Sur", "987,0", "-3,1"]]},
    {"type": "chart", "title": "Ventas trimestrales", "chart_type": "bar",
     "categories": ["T1", "T2", "T3", "T4"], "series": [{"name": "2026", "values": [10, 20, 15, 25]}],
     "y_title": "M$", "caption": "Cifras en millones de pesos"},
    {"type": "stat", "title": "Crecimiento", "value": "+34 %", "label": "Ingresos", "text": "Frente a 2025"},
    {"type": "quote", "text": "La calidad es hacer bien las cosas", "author": "Autor"},
    {"type": "closing", "title": "Gracias", "subtitle": "ana@empresa.cl"}
  ]
}
```
- `chart_type`: `bar` (columnas), `hbar` (barras horizontales), `line`, `pie` (una sola serie; muestra %, o `"percent": false`).
  Varias series en bar/line = leyenda abajo. Los valores deben ser números y coincidir con las categorías.
- `date`: texto libre o `"auto"` (hoy, «9 de octubre de 2026»). Escribe tú las cifras ya con formato es-CL (1.234,5).
- Reglas de estilo que el script aplica: títulos ≤ ~70 caracteres (si no, avisa), letra 16–26 pt según el largo,
  márgenes de 0,7", viñetas reales con sangría, números de tabla alineados a la derecha.
  Escribe frases CORTAS: máx. ~6 viñetas por diapositiva y ~12 palabras por viñeta.

## Inspeccionar un .pptx existente
`python3 scripts/inspect_pptx.py archivo.pptx [--layouts] [--json]` — por diapositiva: layout, título, formas con posición (pulgadas),
texto, tablas, gráficos (categorías y valores), imágenes y notas. Úsalo ANTES de editar para saber los números de diapositiva.

## Editar un .pptx existente (siempre crea copia)
```
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx replace --find "2025" --replace "2026" [--slide 3] [--notes-too]
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx duplicate --slide 2
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx delete --slide 5
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx move --slide 4 --to 2
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx add-slide --layout "Title and Content" --title "Nueva" --bullets "a|b|c" --at 3
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx add-image --slide 2 --image logo.png --left 10 --top 0.4 --width 2
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx notes --slide 1 --text "Texto de las notas"
python3 scripts/edit_pptx.py orig.pptx orig-v2.pptx batch --ops ops.json   # [{"op":"replace","find":"a","replace":"b"}, ...]
```
- `replace` conserva el formato (negrita, color, tamaño) y recorre cuadros, tablas y grupos; falla con aviso si no encuentra el texto.
- Los números de diapositiva se cuentan desde 1 y, en `batch`, se aplican a medida que cambian las operaciones.
- Lista los layouts disponibles con `inspect_pptx.py --layouts`. Tras editar, ejecuta `check_pptx.py` sobre la copia.

## Limitaciones (dilas en «Para revisar»)
- No crea ni conserva garantizadamente: animaciones, transiciones, SmartArt, vídeo/audio, macros ni WordArt; al editar se mantienen
  si ya existían en el archivo, pero no se pueden crear ni modificar.
- Duplicar una diapositiva NO copia los gráficos (se avisa; recréalos con `build_pptx.py`); las imágenes y el texto sí.
- La detección de desborde es una ESTIMACIÓN; el render con LibreOffice puede diferir de PowerPoint (fuentes: se usa Calibri,
  que en LibreOffice se sustituye por Carlito). Si no hay LibreOffice no hay miniaturas.
- Las diapositivas se generan desde cero con tema propio; no aplica plantillas corporativas `.potx` (para eso edita una copia del archivo con la plantilla).
- Los gráficos son nativos y editables, pero con estilos básicos (sin ejes secundarios, gráficos combinados ni 3D).
- Si el usuario pide cambiar el aspecto de un archivo existente complejo, mejor pide confirmación y edita solo lo pedido.

## Pruebas
`LAZUNOX_PYTHON=... python3 -m unittest tests.test_pptx` (desde esta carpeta). Tareas de examen: `bench-tasks.json`.
