---
name: pptx
description: Crear, editar, inspeccionar y verificar presentaciones PowerPoint (.pptx) profesionales en 16:9 con gráficos nativos, tablas, imágenes y notas del orador.
---

# Skill pptx (PowerPoint)

Intérprete: `$LAZUNOX_PYTHON` si existe, si no `python3`. Scripts en `scripts/` (usa python-pptx y Pillow; `build_chat_deck.py` usa además Node y DeckCraft).
Todos los archivos de salida deben ser NUEVOS (nunca sobrescribas el original del usuario).

## Antes de empezar: pregunta el formato (obligatorio)
Si te piden una presentación (diapositivas, slides, PowerPoint, PPT, deck, charla) y NO dijeron claramente el formato, PREGUNTA con la herramienta `question` ANTES de crear nada, con dos opciones: **«Editable (.pptx)»** (un archivo que se abre y se cambia después en PowerPoint, Keynote o Google Slides; el diseño se limita a lo que PowerPoint puede representar) y **«Diseño libre (HTML)»** (una página que se presenta en el navegador, con mucha más libertad de diseño y animación; los textos se cambian editando el archivo, y se puede imprimir a PDF). Decir solo «PowerPoint», «PPT» o «PPTX» NO alcanza para elegir. No preguntes si ya está claro: «editable», «para editar», «.pptx» ⇒ .pptx; «HTML», «web», «lo más lindo», «no hace falta editarla» ⇒ HTML; o si ya eligieron antes en esta conversación. Si no puedes preguntar, usa .pptx y dilo en «Para revisar».
**Ruta HTML:** un único archivo `.html` autocontenido (sin CDN ni recursos externos; fuentes del sistema o incrustadas), cada diapositiva a pantalla completa 16:9, avance con las flechas y la barra espaciadora, `F` para pantalla completa, y CSS de impresión (`@page` apaisada, una diapositiva por página) para guardar como PDF. Mismo criterio creativo de la sección siguiente; verifica con `python3 scripts/html_a_png.py archivo.html carpeta_nueva` (lo imprime con Chromium sin ventana y crea un PNG por diapositiva más `miniaturas.png`: MÍRALOS con la herramienta de imágenes y corrige todo de una vez). NO uses el navegador integrado de la app para verificar (suele estar apagado en Ajustes y la llamada falla o se queda colgada); si el script sale con código 3 (no hay Chromium), dilo en «Para revisar». Ábrelo con `open archivo.html` al terminar.

## 0. Diseño libre: inventa uno distinto cada vez
No hay una plantilla por defecto. Cada presentación debe tener su propia identidad, pensada para su tema y su público: no repitas la paleta, la tipografía ni la composición de la anterior, ni por inercia ni porque «funcionó». Antes de armar nada decide en una frase el concepto visual (tono, paleta de 3–5 colores con contraste legible, par de tipografías, forma de las tarjetas, ritmo entre diapositivas) y que sea distinto del último que hiciste en esta conversación. Si la persona rechaza un estilo, cambia de concepto de verdad (otra paleta, otra estructura), no solo de tema.
Caminos, de más libre a más guiado (elige el que dé el mejor resultado, no el más corto):
- **Motor del Chat (`build_chat_deck.py`, §0.1) — camino principal.** El MISMO motor y el MISMO vocabulario de diseño que el Chat: escribes un JSON (theme, style, palette propia, fonts, background, lienzo libre `layout:"free"`, stat, steps, cards, chart, kpis…) y la app arma el archivo. Es el que da el mejor resultado en la mayoría de las presentaciones.
- **A medida con python-pptx** (script propio, p. ej. `make_deck.py`): solo cuando necesites algo que el motor del Chat no hace (imágenes propias, notas del orador, tablas muy específicas); verifica igual con §2.
- **Constructor `build_pptx.py` (§1)**: respaldo cuando no hay DeckCraft (código de salida 3) y para presentaciones con imágenes, tablas o notas; elige tema o define tu propia paleta, no dejes el mismo por inercia.
- **Diseño «dots» (oscuro, con círculos)**: es solo UNA opción más, para cuando encaje con el tono; no la uses como primera opción ni dos veces seguidas (detalle en §0.2).

## 0.1 Camino principal: el JSON del Chat + `build_chat_deck.py`
**Si tienes la herramienta `documentos_crear` (la ofrece la app), úsala en lugar del script:** `documentos_crear` con `tipo: "pptx"`, `nombre` (sin extensión) y `spec` (el JSON de la guía de abajo: theme, style, palette, fonts, slides…). Es el MISMO motor y la MISMA guía de diseño que el Chat, sin escribir archivos intermedios ni necesitar Node, y da el mismo resultado en macOS y en Windows. El archivo queda en la carpeta de esta tarea (nunca pisa uno existente: si el nombre existe añade « (2)») y la respuesta trae su ruta. Si responde con un error de contenido, corrige y repite con OTRO nombre; si dice que falta el diseñador de documentos (ArtCraft), díselo al usuario («Ajustes → Tareas → Componentes opcionales») y sigue con el script de abajo si lo hay. Sin la herramienta, usa el script.
1. Escribe `spec.json` en la carpeta de la tarea con el esquema de la guía de abajo (es EXACTAMENTE el JSON del bloque ```pptx del Chat: `{"theme":…,"style":…,"palette":…,"fonts":…,"footer":…,"slides":[…]}`; nada de comandos ni rutas, todo es texto).
2. Genera: `python3 scripts/build_chat_deck.py spec.json salida.pptx` (la salida debe ser un archivo NUEVO: no sobrescribe). Imprime `Presentación creada: …`. Si imprime `ERROR`, corrige el JSON según el mensaje y repite.
3. **Código de salida 3** = falta DeckCraft, Node o el motor en este equipo: no insistas, sigue con el §1 (`build_pptx.py`) y dilo en «Para revisar». Aquí NO hay versión simplificada de las diapositivas libres: sin motor no se arma esta ruta.
4. Verifica como siempre (§2): mira las imágenes. Corrige editando `spec.json` y regenerando con otro nombre de salida.
Límites de este motor: no inserta imágenes propias ni notas del orador (si las piden, usa el §1 o un script a medida).

### Guía de diseño (la misma que usa el Chat)
Lo que sigue es la guía del Chat, palabra por palabra (una prueba comprueba que no se desvíe de `resources/opencode/agents/chat.md`). Elige `theme` y `style` o inventa tu propia `palette` según el tono del contenido, y varía todo entre presentaciones.

- `theme` (opcional, por defecto `"blue"`) elige la paleta de color de TODA la presentación: `"blue"`,
  `"green"`, `"dark"` (fondo oscuro), `"warm"` (tonos cálidos) o `"mono"` (gris neutro).
- `style` (opcional, por defecto `"classic"`) elige la FORMA de TODA la presentación — tarjetas,
  decoración, tipografía de forma — un eje DISTINTO del color: `"classic"` (el look de siempre: un
  círculo sutil de textura, tarjetas redondeadas con borde), `"editorial"` (una línea fina de acento
  en vez del círculo, tarjetas de esquina recta sin relleno — tono revista/sobrio), `"geometric"`
  (una barra diagonal de acento, tarjetas bien redondeadas tipo "pill" — tono gráfico/audaz) o
  `"minimal"` (sin ninguna decoración, tarjetas de esquina recta solo con borde fino — tono informe
  ejecutivo ultra limpio). Elige AMBOS (`theme` y `style`) según el TONO del contenido, y varía los
  dos entre presentaciones: no dejes ni `"blue"` ni `"classic"` por inercia — un informe financiero
  serio puede pedir `"mono"`+`"minimal"`, un pitch de producto `"warm"`+`"geometric"`, una nota de
  prensa `"blue"`+`"editorial"`.
- `footer` (opcional, del deck entero) es una línea chica al pie, p.ej. el nombre de la empresa o el
  período — solo si hay algo real que poner ahí, NUNCA inventes algo tipo "Datos ilustrativos".
- Cada diapositiva puede traer `eyebrow` (una etiqueta corta en mayúsculas arriba del título, p.ej.
  `"Ventas"`, `"Cifra destacada"` — PURAMENTE la categoría/tema de ESA diapositiva, nunca la
  inventes si no hay una categoría real que nombrar) y `note` (una nota chica al pie específica de
  esa diapositiva, p.ej. `"Encuesta a 240 clientes"` — pisa el `footer` del deck en esa diapositiva
  nada más; mismo criterio: solo si hay algo real que decir).
- `layout` opcional por diapositiva: `"bullets"` (título + viñetas, el normal), `"section"`
  (separador a toda página, para dividir temas — sin `eyebrow` se numera sola, "01"/"02"/...),
  `"closing"` (cierre), `"stat"` (una cifra grande como foco — `title` es la cifra, p.ej. `"+27%"`
  o `"3.2x"`, la unidad pegada al número sale más chica automáticamente; el primer `bullet` la
  explica), `"steps"` (las `bullets` se ven como pasos numerados, para un proceso o secuencia),
  `"two-col"` (comparar dos cosas lado a lado — ver `columns` abajo), `"cards"` (cada `bullet` como
  una tarjeta numerada, para una lista de ítems/ventajas SIN orden de proceso — a diferencia de
  `"steps"`, que sí implica secuencia) o `"kpis"` (de 2 a 4 métricas EN FILA, cada una con su
  etiqueta/número grande/variación — ver `kpis` abajo; DISTINTO de `"stat"`: `"stat"` es UNA cifra
  como foco de toda la diapositiva, `"kpis"` son VARIAS métricas juntas, más chicas — típico para un
  resumen tipo tablero al principio de un informe, p.ej. "ventas, clientes nuevos, retención" juntos
  en una fila). Sin `layout`, solo se infieren `"cover"`/`"section"`/`"bullets"` (el resto hay que
  pedirlo a propósito, para no adivinar mal): la primera diapositiva es portada; una con título y SIN
  viñetas es separador de sección; el resto es contenido normal.
- En CUALQUIER viñeta (bullets/steps/cards/columns), si la escribes como `"Etiqueta: resto"` (con
  `": "` en el medio), la etiqueta sale automáticamente en negrita y el resto en texto normal, en la
  MISMA línea — úsalo para encabezar una viñeta con una palabra clave, p.ej. `"Soporte: disponible
  24/7"`.
- `"two-col"` puede traer `columns` — un array de EXACTAMENTE 2, cada una
  `{"heading":"...","bullets":["...","..."]}` — para un "antes/después" de verdad, con su propio
  encabezado por columna (la columna derecha sale resaltada con el color del tema, para dar
  énfasis). Sin `columns`, las `bullets` de la diapositiva se reparten mitad y mitad (sin
  encabezados propios).
- `"kpis"` trae `kpis` — un array de 2 a 4, cada una `{"label":"...","value":"...","delta":"..."}`
  (`delta` opcional, p.ej. `"+12% vs. trimestre anterior"`) — cada métrica sale como una tarjeta con
  su etiqueta, el número grande y la variación abajo, todas en fila. `value` ya viene formateado
  como texto (con `%`, `x`, separador de miles, lo que corresponda), no como número de JSON.
- Más `layout`: `"timeline"` (línea de tiempo; `bullets` como `"2024: hito"`, hasta 6), `"agenda"` (temario
  numerado, hasta 7 `bullets`), `"quote"` (cita destacada: `title` es la frase y el primer bullet el autor) y
  `"table"` (`"table":{"columns":["Plan","Precio"],"rows":[["Básico","$9.990"]]}`, de 2 a 6 columnas y hasta 8
  filas, todo texto ya formateado). `transition` (opcional, del deck entero): `"fade"`, `"push"` o `"wipe"` —
  úsala en presentaciones formales.
- **Libertad de diseño (opcional, y animada: no hace falta que todas las presentaciones se vean
  iguales).** Además de `theme` y `style` puedes:
  - Inventar tu propia **`palette`** de TODA la presentación (en vez de `theme`):
    `{"bg":"#0E2A2F","text":"#F4F1EA","accent":"#F2B544"}` — colores SIEMPRE en hex con `#` de 6
    dígitos; `muted`, `accent2`, `panel` y `edge` son opcionales (si faltan se derivan solos). Elige
    los colores según el tema (un café → verdes profundos y ámbar; una fintech → azules y blanco; un
    informe serio → grises) y cuida el contraste: texto claro sobre fondo oscuro o al revés.
  - Elegir **`fonts`**: `{"title":"Georgia","body":"Arial"}` — solo de esta lista, que existe en Mac
    y Windows: Arial, Georgia, Verdana, Trebuchet MS, Times New Roman, Courier New, Tahoma.
  - Poner un **`background`** (hex con `#`) distinto en UNA diapositiva, p.ej. un fondo de color
    fuerte para una cifra destacada. Con un `background` fuerte cuida el contraste del texto de ESA diapositiva: elige el color de letra (en una `free`, `color` de cada texto) para que se lea sobre ese fondo; el pie, la nota y la numeración los ajusta el motor solos.
  - Usar **`layout:"free"`** (lienzo libre): TÚ decides qué va y dónde. Trae `elements`, un array
    (como mucho 40) de textos y formas sobre un lienzo de **960 de ancho × 540 de alto** (puntos;
    origen arriba a la izquierda; se dibujan en el orden en que los escribes, los últimos quedan
    encima): `{"type":"text","x":60,"y":120,"w":600,"h":150,"text":"...","size":54,"bold":true,
    "color":"#F4F1EA","font":"Georgia","align":"left","spacing":-2}` y `{"type":"shape","shape":
    "ellipse","x":560,"y":-120,"w":560,"h":560,"fill":"#F2B544","fillTo":"#E07A5F","angle":45,
    "opacity":0.9,"line":"#FFFFFF","lineWidth":2,"rotate":15,"text":"...","size":16}` — `shape` es uno
    de `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `hexagon`, `rightArrow`, `chevron`,
    `star5` o `line`; `fill`/`line`/`color` en hex; `fillTo` hace un degradado; `opacity` va de 0 a 1.
    Úsalo para portadas con formas grandes y color, una cifra gigante, líneas de tiempo, composiciones
    con círculos o franjas: lo que se te ocurra. Reglas para que quede bien: todo dentro del lienzo
    (salvo formas decorativas que se salen a propósito); los textos con `w`/`h` de sobra (un renglón
    mide más o menos `size` × 0,55 de ancho por letra, y cada línea `size` × 1,2 de alto); cuerpo
    de al menos 14 de tamaño; buen contraste; no más de 25 elementos por diapositiva y nada de texto
    pegado a un borde. Mezcla diapositivas `free` con las de siempre (no hace falta que TODAS sean
    libres). Sin DeckCraft instalado una diapositiva libre se simplifica a título + viñetas, así que no
    dependas de ella para el sentido del contenido: el texto importante tiene que estar en los
    `text`.
- Para que NO se vea "hecho por IA": varía el tipo de diapositiva a lo largo de la presentación
  (intercalá separadores de sección y usa
  `"stat"`/`"steps"`/`"two-col"`/`"cards"`/`"chart"`/`"kpis"` donde el contenido lo pida, en vez de
  una sola lista plana de título+viñetas repetida); los títulos
  nunca terminan en punto. Cada diapositiva de contenido trae como mucho 4-5 viñetas cortas (una
  línea cada una): el cuadro de texto tiene un alto fijo, así que un párrafo largo o muchas viñetas
  se cortan — si hay más que decir, se parte en más diapositivas.
- Si los datos piden un **gráfico** (una serie de números con sus categorías: ventas por mes, % por
categoría, etc.), usa `layout:"chart"` con `"chart":{"type":"bar"|"line"|"pie","categories":["Ene",
"Feb","Mar"],"values":[10,20,15]}` — es un gráfico NATIVO de PowerPoint (se puede editar ahí
después, no es una imagen), así que sí se puede. `categories` y `values` tienen que tener el mismo
largo. `"bar"` para comparar categorías, `"line"` para una tendencia en el tiempo, `"pie"` para
partes de un total (como mucho 5-6 porciones, si no se ilegible). Por ahora sigue sin imágenes
propias (fotos, íconos) — si piden eso, avisa que todavía no se puede.

## 0.2 Diseño «dots» (opcional)
Si lo usas:
1. Escribe `contenido.json` con SOLO texto (nada de comandos ni rutas): `{"slides":[...]}`. Tipos de diapositiva y sus campos:
   - `cover` {title (una palabra o dos cortas), subtitle, note, badge}
   - `stat` {kicker, title, stat («4.000+»), statLabel, items:[2 × {title, body}]}
   - `timeline` {kicker, title, items:[3 × {title, body}], callout}
   - `grid` {kicker, title, items:[4 × {title, body}], footnote}
   - `steps` {kicker, title, items:[4 × {title}]}
   - `compare` {kicker, title, left:{label,text,foot}, right:{label,text,foot}}
   - `rows` {kicker, title, rows:[2–4 × {label, value, note}]}
   - `quad` {kicker, title, items:[4 × {title, body}]}
   - `stats` {kicker, title, stat, statLabel, items:[3 × {value (1–2 caracteres), label}]}
   - `closing` {title, text, sources}
   Empieza con `cover`, termina con `closing`, mezcla tipos. Título ≤ 60 caracteres, cuerpos ≤ 90. Usa SOLO datos reales (de la investigación o de lo que pidió la persona): no inventes cifras ni fechas.
2. Genera: `python3 scripts/build_dots.py contenido.json salida.pptx`. Si imprime `ERROR`, corrige el JSON según el mensaje y repite.
3. Si sale con **código 3** (el programa del diseño no está instalado en este equipo), no insistas: sigue con el §1 normal.
4. Verifica como siempre (§2).

## 1. Crear una presentación con `build_pptx.py` (respaldo y casos con imágenes)
1. Escribe un JSON (esquema abajo) en la carpeta de la tarea, p. ej. `deck.json`.
2. Genera: `python3 scripts/build_pptx.py deck.json informe.pptx --theme sobrio`
   (temas: `sobrio` azul/dorado, `oscuro`, `claro` crema/verde). Salida: `Presentación creada: informe.pptx (12 diapositivas, tema sobrio)`.
3. Si el script imprime `Aviso:` (título largo, texto largo) corrige el JSON y vuelve a generar.
   Las listas largas se dividen solas en «Título (1/3)», «(2/3)»… y las tablas de más de 9 filas también.

## 2. Verificar (siempre)
`python3 scripts/check_pptx.py informe.pptx --outdir .lazunox/trabajo/chk`
- Revisa: abre, nº de diapositivas, texto que desborda (estimado), formas fuera del lienzo, diapositivas sin título,
  imágenes diminutas/de baja resolución. Código de salida 1 = hay PROBLEMAS: corrige todo de una vez (ver «Presupuesto de revisión») y repite.
- Renderiza con DeckCraft (ArtCraft) y crea `.lazunox/trabajo/chk/miniaturas.png` (todas las diapositivas en una imagen):
  MÍRALA con la herramienta de imágenes y comprueba que nada se corta ni se superpone.
- Si creaste la presentación con `documentos_crear`, mírala con `documentos_renderizar` (devuelve una imagen por diapositiva; solo sirve para archivos creados con `crear` en esta tarea) y corrige todo de una vez. Es la forma de verla también en Windows.
- Si no está DeckCraft (ArtCraft) avisa «solo hay verificación estructural»: dilo en «Para revisar».
- Para volver a renderizar usa una carpeta nueva (`mktemp -d`) o el script de render; no uses `rm`: cada borrado pide permiso al usuario.

## 3. Entregar
Indica la ruta del .pptx y, en «Para revisar», lo que no pudiste comprobar (render, fuentes, animaciones).

## Presupuesto de revisión
1. Antes de renderizar aplica las medidas de la guía de diseño (§0.1) o de §1 y las reglas de estilo del esquema: títulos ≤ 2 líneas (máx. ~50 caracteres o menor tamaño), margen bajo el texto antes de cajas o gráficos, sin formas superpuestas.
2. Máximo 2 renders: uno tras crear y, solo si `check_pptx.py` o la miniatura muestran un fallo real, otro tras corregir TODOS los fallos a la vez. Las comprobaciones estructurales repetidas usan `--no-render`.
3. Tras el 2.º render entrega y lista lo que quede en «Para revisar» en vez de seguir iterando.
4. Corrige editando el JSON (o el script) y regenerando con el mismo constructor (`build_chat_deck.py` o `build_pptx.py`); nunca parches el .pptx a mano.

## Esquema JSON de `build_pptx.py` (respaldo)
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
- La detección de desborde es una ESTIMACIÓN; el render de DeckCraft puede diferir de PowerPoint en fuentes y saltos de línea.
  Si no está DeckCraft no hay miniaturas.
- Las diapositivas se generan desde cero con tema propio; no aplica plantillas corporativas `.potx` (para eso edita una copia del archivo con la plantilla).
- Los gráficos son nativos y editables, pero con estilos básicos (sin ejes secundarios, gráficos combinados ni 3D).
- Si el usuario pide cambiar el aspecto de un archivo existente complejo, mejor pide confirmación y edita solo lo pedido.

## Pruebas
`LAZUNOX_PYTHON=... python3 -m unittest tests.test_pptx` (desde esta carpeta). Tareas de examen: `bench-tasks.json`.
