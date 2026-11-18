---
name: video
description: Úsala siempre que pidan un video, reel, promo, animación, clip, anuncio, historia para redes, video explicativo o con datos, o cambiar uno ya hecho. Compone HTML animado con GSAP, lo revisa con cuadros y crea el MP4 con las herramientas de video de la app, igual en Chat, Code y Overdrive.
---

# Video

El motor de la app (HyperFrames 0.9.64 + GSAP 3.15.0) abre tu `index.html` sin red, salta a cada cuadro de una línea de tiempo pausada y le saca una foto. Todo lo que se ve tiene que salir del tiempo de esa línea de tiempo. Por eso cada render es idéntico, en Mac y en Windows.

Usa solo `video_cuadros` y `video_render`. No ejecutes motores, no instales paquetes y no inventes comandos. Si las herramientas no existen, dilo y no prometas un MP4.

**La meta es movimiento real, no diapositivas.** Un video donde las escenas solo aparecen y desaparecen con un fundido está mal hecho, aunque se vea limpio.

## Sin pausas

Si piden un video, hazlo. No propongas tres historias ni esperes aprobación: decide tú con supuestos razonables y nómbralos al entregar. Pregunta solo si el pedido es ambiguo de verdad, por ejemplo si no sabes de qué negocio o producto se trata. Sin destino nombrado, el video es vertical de 15 s.

## Dónde va y cómo se entrega

- **Code:** una subcarpeta por video dentro de `./.lazunox/trabajo/` (por ejemplo `.lazunox/trabajo/promo-cafe/index.html`). Pasa `carpeta` (la ruta absoluta del proyecto abierto) a las dos herramientas.
- **Overdrive:** la misma estructura, sin pasar `carpeta`.
- **Chat:** no tienes herramientas de archivos.
  - Un solo archivo: envía el `index.html` completo en `html` de `video_cuadros` (hasta 512 KB), con escenas `.clip` superpuestas, como el ejemplo de abajo.
  - Varios archivos: envía `archivos` como `{ruta: contenido}` con `index.html`, `compositions/*.html` y otros textos (`.css`, `.js`, `.json`, `.svg`). Hasta 64 archivos, 512 KiB cada uno y 4 MiB en total. Solo texto: fotos y audio entran por `fotos` y `audio` (abajo).
  - Usa `html` o `archivos`, nunca los dos en la misma llamada. La respuesta trae `composicion`: usa esa ruta tal cual en las llamadas siguientes y en `video_render`. Para corregir, envía `composicion` con otro `html` completo, o con `archivos` que traiga solo los archivos que cambian.
- **Estructura con varios archivos:** `index.html` en la raíz, una escena por archivo en `compositions/` y las fotos, fuentes y audio en `assets/`. Las reglas están en `references/formato.md` §5.
- `composicion` es siempre la ruta relativa del `index.html`, nunca la carpeta. No inventes rutas.

## El ciclo

1. **Tipo de video.** Lee la guía de su tipo (tabla al final). Si cuenta algo y dura más de unos 10 s, lee también `references/historia.md`.
2. **Especificación.** Escribe todo en números: tamaños, colores en hex, tiempos y eases, lo prohibido y los planos (`references/especificacion.md`). En Code y Overdrive guárdala como `SPEC.md` junto a `index.html`. En Chat va en tu razonamiento.
3. **Composición.** Escribe la composición completa, con el contrato de abajo y las reglas de movimiento.
4. **Cuadros.** Llama a `video_cuadros` con 1 a 6 `segundos`, por ejemplo `{"composicion":".lazunox/trabajo/promo/index.html","formato":"vertical","segundos":[0,1.2,3.9,6,9.5,14]}`.
   - Pide siempre el segundo 0, porque es la miniatura y nunca puede estar vacío.
   - Pide también un instante dentro del movimiento principal, uno en medio de cada transición y el final.
   - La herramienta revisa esos segundos, 8 instantes repartidos por todo el video y, con escenas en `compositions/`, el inicio y la mitad de cada escena. Devuelve tus cuadros, una **hoja de contactos** con todos los instantes revisados (sirve para ver el movimiento, no solo instantes sueltos), `avisos` (segundo y problema, incluidos los de la revisión oficial de HyperFrames) y `cobertura` (cuánto del lienzo ocupa el contenido).
   - Si el video lleva fotos, pásalas aquí en `fotos` (sección Fotos). Quedan guardadas con la composición para las llamadas siguientes.
5. **Mira de verdad las imágenes.** Corrige todo junto, en este orden:
   1. texto cortado o fuera del lienzo;
   2. texto u objetos encimados;
   3. contraste;
   4. márgenes;
   5. encuadre y tramos muertos;
   6. errores de texto o cifras inventadas.

   Puedes hacer como máximo **3 rondas de cuadros**. Cómo juzgar los cuadros está en `references/revision.md`.
   - Si no puedes ver imágenes, dilo. No afirmes que hiciste una revisión visual.
   - En medio de una transición de empuje o barrido, es esperable un aviso de «área segura» o de «tapado» sobre lo que está entrando o saliendo. Compruébalo en el cuadro. El mismo aviso con el texto ya quieto sí es un error. Los avisos oficiales esperables (estructura de un solo archivo, recorte de un acercamiento de cámara) están en `references/formato.md` §13; cualquier otro se corrige.
6. **Render.** Llama a `video_render` solo después de mirar y corregir: `{"composicion":"…/index.html","formato":"vertical","duracion":15,"fps":30,"nombre":"promo"}`.
   - `duracion` es igual a `data-duration` de la raíz y es múltiplo de 1/30.
   - Si la persona entregó audio, agrégalo aquí en `audio` (sección Audio).
   - Mira los 3 cuadros de control y los avisos que devuelve. No entregues con avisos pendientes sin corregirlos o explicarlos.
7. **Entrega** en una línea: el enlace a `ruta` · la duración en segundos · el peso calculado desde `bytes` (KB = 1000 bytes, MB = 1 000 000 bytes). Luego, en palabras simples, di qué supuestos tomaste y qué quedó pendiente. La revisión es por muestreo y no cubre cada cuadro; no lo presentes como si lo fuera.

## Contrato mínimo

El detalle y los errores de la herramienta están en `references/formato.md`.

1. La raíz tiene `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-width`, `data-height` y `data-fps="30"`.
   - El tamaño es el del formato.
   - `html`, `body` y la raíz miden exactamente eso, con `margin: 0` y `overflow: hidden`.
   - La duración máxima es 120 s.
2. Carga GSAP exactamente con `<script src="assets/vendor/gsap.min.js"></script>`, solo en `index.html`. La app lo sirve en esa ruta aunque el archivo no exista en tu carpeta: no lo copies ni lo bajes. Es solo el núcleo y no hay plugins (nada de SplitText). La ruta antigua `../node_modules/gsap/dist/gsap.min.js` funciona, pero la revisión oficial la marca con un aviso.
3. Crea una línea de tiempo `gsap.timeline({ paused: true })` y regístrala **después** de sus tweens: `window.__timelines["main"] = tl`. Nunca uses `tl.play()`.
4. Todo es función del tiempo. No uses `Date.now()`, `Math.random()` sin semilla, `setTimeout`, `setInterval` ni `requestAnimationFrame` como reloj. Tampoco `fetch` ni `repeat: -1`: las repeticiones son finitas.
5. Cada elemento con tiempo lleva `class="clip"` con `data-start` y `data-duration` en segundos, y se ve en [inicio, inicio + duración). El orden de pintura lo da `z-index`.
6. Nunca animes `display`, `visibility` ni `autoAlpha` de un `.clip`; anima un hijo.
7. Usa `fromTo`, no `from`, porque el motor salta hacia atrás y hacia adelante. **Pero solo el primer tween de cada propiedad de un elemento es `fromTo`:** los siguientes sobre esa misma propiedad (la salida de un título, el segundo cambio de color del fondo) van con `tl.to(…)`. Un `fromTo` posterior pinta su punto de partida al armarse y tapa el cuadro 0: el fondo sale con el color de la mitad del video y los textos que salen después aparecen encimados al inicio. No pongas `transform` en el CSS de algo que GSAP transforma. Anima `x`, `y`, `scale`, `rotation`, `opacity`, `filter` y `clipPath`, nunca `left`, `top`, `width`, `height` ni `letterSpacing`.
8. Pon cada tween en un segundo absoluto: `tl.fromTo(el, {…}, {…}, 2.4)`.
9. La composición no tiene red: nada de URL, CDN, fuentes remotas ni iframes. Las rutas son relativas y sin `/` al inicio (`assets/fotos/x.jpg`), y la carpeta no puede tener enlaces simbólicos.
10. Fuentes. Sin archivo funcionan dos grupos, siempre con una de respaldo:
    - las que la app incluye sin red (solo estilo normal, sin cursiva): `Inter`, `Montserrat`, `Outfit`, `Nunito`, `Poppins`, `Roboto`, `Lato`, `Playfair Display` (pesos 400, 700 y 900); `Oswald`, `Open Sans`, `EB Garamond`, `Space Mono`, `IBM Plex Mono`, `JetBrains Mono`, `Source Code Pro`, `Noto Sans JP` (400 y 700); `League Gothic` y `Archivo Black` (solo 400). Otro peso se simula y se ve distinto;
    - las comunes a Mac y Windows: `Arial`, `Arial Black`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Georgia`, `Times New Roman`, `Courier New` o `Impact`.
    - Otra fuente necesita `@font-face` a un archivo de `assets/fonts/` que ya esté en el proyecto o que entregó la persona (en Chat no se pueden enviar archivos de fuente).
    - `line-height` va entre 1.15 y 1.25 (Arial Black necesita más).
11. Los IDs son únicos. No dejes nada visible creado por script que podría ir escrito en el HTML.

## Movimiento real: las reglas que más pesan

El oficio completo, las 9 transiciones medidas y las fallas comunes están en `references/movimiento.md`.

1. **Cada elemento llega con desplazamiento, escala, desenfoque o recorte, no solo con opacidad.** Un movimiento rápido dura 0,3–0,6 s y es un solo tween.
2. **Llegar lento, salir limpio.** Para llegar usa `expo.out` o `power4.out`. Para salir o hacer un zoom a través de algo usa `power3.in`, y para la cámara o un cambio de color, `power2.inOut`. Lo constante (giros, barras) va con `none`. Nunca uses el mismo `power2.out` de 0,5 s para todo.
3. **Las salidas duran 40–50 % menos** que las entradas. El siguiente elemento empieza cuando el anterior va al 30–50 %.
4. **Escalonado:** letras a 1 cuadro (0,033 s), o a 0,1 s si es un nombre; palabras a 60–120 ms; elementos de lista a 40–80 ms. Separa en `<span>` escritos en el HTML.
5. **Desenfoque de movimiento:** 6–12 px en un texto y 15–20 px si se mueve todo el cuadro. Es máximo a mitad del movimiento y llega a 0 al aterrizar.
6. **Resortes** solo en posición y tamaño (`back.out(1.4)`, `elastic.out(1, 0.5)`), nunca en opacidad ni en color, y nunca en la interfaz de un producto.
7. **Varía la entrada de los títulos** dentro del mismo video. Algunas opciones:
   - por palabra con `blur(6px)` → 0 en 0,13 s;
   - la línea desenfocada que se enfoca (8 px → 0 en 0,13–0,2 s);
   - por letra;
   - un rótulo que se descubre con `clipPath`.

   Nunca «aparece y sube» en todos.
8. **Un título que ya llegó queda quieto.** El movimiento pasa al siguiente elemento, al fondo o a la cámara. No le pongas una escala lenta encima ni un acercamiento lento al final, ni bucles de «respirar», flotar o latir.
9. **Siempre se mueve algo con sentido:** la interfaz funcionando, una foto que se recorre despacio, un objeto que gira, una órbita del fondo a 3–5° por segundo. Algo nuevo pasa cada 2–4 s, y un tramo de más de 3 s sin cambios es un tramo muerto.
10. **Transiciones con causa.**
    - Usa de 3 a 5 tipos por video: el objeto que crece y se vuelve el mundo (0,65 s), un empuje, un barrido de 0,13–0,3 s, un iris con `clipPath: circle()` o el cambio de color de fondo (~0,4 s).
    - Como máximo un tercio de las costuras son cortes secos.
    - Dos mundos distintos nunca se funden con un fundido cruzado.
11. **Nunca un cuadro vacío.** Superpón las ventanas de dos escenas seguidas 0,2–0,6 s, y deja que un fondo u objeto siga visible mientras cambia el contenido.
12. **Tiempo de lectura:** 0,5 s + 0,3 s por palabra. La última línea del video se sostiene al menos 2 s.
13. **Tamaños:** el título protagonista ocupa el 4–9 % del alto o el 60–90 % del ancho. El protagonista de cada plano ocupa al menos el 40 % del cuadro. Usa un solo acento de color, y que signifique algo.
14. **Contrasta velocidades.** Planos de 1,8–3 s en promedio, con movimiento dentro de ellos. Sostén 0,3–0,75 s antes del remate.

## Formatos y márgenes

| Formato | Tamaño | Cuándo | Texto mínimo cuerpo/título | Margen |
| --- | --- | --- | --- | --- |
| `vertical` | 1080×1920 | Reels, historias, TikTok, o sin destino | 48/80 px | 90 px a los lados; texto y sujeto entre 200 y 1330 px de alto; debajo, solo decoración |
| `cuadrado` | 1080×1080 | Una publicación cuadrada | 48/80 px | 54 px |
| `horizontal` | 1920×1080 | YouTube, pantallas, presentaciones | 40/72 px | 54 px |

Sigue el destino que nombren. La duración por defecto es 15 s y la máxima, 120 s, a 30 fps. Usa como máximo 2 familias tipográficas y contraste fuerte. Cada escena lleva un elemento visual además del texto: una forma, un dibujo en CSS o SVG, o una foto. Si la cobertura baja del 60 %, abre el diseño hacia los bordes con algo que tenga caja.

## Fotos

Cuando el video las necesite (un local, un producto, un lugar real), usa las que entregó la persona o búscalas en internet con el flujo de la skill `pdf`. Para video sirve una foto de cualquier licencia: la licencia queda registrada, pero no bloquea.

1. Prepara requisitos: sujeto, lugar, lo que debe verse, lo que no y la orientación.
2. Haz 2 o 3 consultas con `documentos_imagenes_buscar`.
3. Compara la hoja numerada; puedes elegir «ninguna».
4. Amplía 1 o 2 finalistas con `documentos_imagenes_ver`. Di qué se ve, qué requisitos cumple y qué duda queda.
5. Llama a `documentos_imagenes_usar` con el `id` y `evaluation:{mode:"visual",observed,meets:[],doubts}`. En Code agrega `carpeta`.

Haz como máximo una segunda búsqueda. Usa solo los ids devueltos.

**Cómo entra la foto (igual en Chat, Code y Overdrive):** en `video_cuadros` pasa `fotos: [{"origen": "<id de documentos_imagenes_usar>", "destino": "assets/fotos/pan.jpg"}]`.
- `origen` es el id que aprobó `documentos_imagenes_usar`, el nombre o id de una foto que adjuntó la persona en Chat, o la ruta relativa de una foto que ya está en el proyecto o la tarea.
- `destino` va siempre dentro de `assets/` y termina en `.jpg`, `.jpeg`, `.png`, `.webp` o `.gif`. Hasta 24 fotos.
- La app copia la foto junto a la composición y la conserva para las llamadas siguientes: no hace falta repetir `fotos` si no cambias de foto.
- En la composición úsala con `<img src="assets/fotos/pan.jpg" alt="…">` y `object-fit: cover`, dentro de un envoltorio que recorta, con un hijo que se mueve.
- Nunca pongas una URL, una miniatura ni un base64 pegado a mano.
- Sin visión, sin red o sin una candidata válida, hazlo con formas, color y tipografía, y explica la ausencia. No cambies una foto real por un dibujo sin avisar.

## Audio

- Usa solo el audio que entregue la persona. No inventes ni descargues música, no generes voces y no hagas sonido con código.
- Formatos: `.mp3`, `.m4a`, `.wav` o `.aac`, hasta 16 pistas. `video_render` las mezcla en el MP4 (AAC). `video_cuadros` no suena: el audio solo se agrega al render.
- **Forma principal (sirve en los tres modos):** en `video_render` pasa `audio: [{"origen": "…", "inicio": 0, "desde": 8, "hasta": 23, "volumen": 0.8, "fundidoEntrada": 0.4, "fundidoSalida": 1.5}]`.
  - `origen`: en Chat, el nombre o id del archivo que adjuntó la persona; en Code y Overdrive, la ruta relativa del archivo en el proyecto o la tarea.
  - `inicio`: segundo del video en que empieza a sonar (menor que la duración). `desde` y `hasta`: el tramo del archivo que suena (`hasta` es un segundo del archivo, no una duración). `volumen`: de 0 a 3.98, 1 = sin cambio. Fundidos en segundos. Todo es opcional salvo `origen`.
- **Otra forma (Code y Overdrive):** con el archivo dentro de `assets/audio/` de la composición, un `<audio id="…" class="clip" src="assets/audio/x.mp3">` con `data-start`, `data-duration`, `data-media-start` (el recorte), `data-volume` y `data-fade-in`/`data-fade-out`. Nunca uses `play()` ni `pause()`. No mezcles las dos formas para la misma pista: sonaría dos veces.
- Detalle, sincronía y niveles: `references/sonido.md`.
- La respuesta de `video_render` trae `audio` (códec y duración) cuando el MP4 tiene sonido. Si no lo trae, salió mudo: díselo a la persona y conserva su archivo intacto.
- Si nadie habló de sonido, el video va sin sonido y no ofrezcas extras.

## Sin créditos

- No pongas créditos ni pies de foto, salvo que la persona los pida.
- No agregues subtítulos ni logos inventados. Sin el archivo del logo, escribe el nombre.
- No uses videos generados por modelos.
- No inventes cifras, precios ni horarios: si no los tienes, márcalos como «cifra de ejemplo» o déjalos fuera.

## Ejemplo: 8 s vertical, un solo `index.html`

Este ejemplo se probó con el motor de la app, sin avisos de la app. Quedan dos avisos oficiales esperables: `nested_structure_needs_subcomposition` (sale siempre con un solo `index.html` y escenas `<section>`) y, a mitad del empuje (≈4,05 s), texto fuera del lienzo en lo que sale. Los dos se explican en `references/formato.md` §13.

Muestra:
- entradas con desplazamiento y escala;
- título letra por letra;
- bajada palabra por palabra con desenfoque;
- tarjeta con resorte;
- una rueda que gira todo el video;
- una transición de empuje entre 2 escenas superpuestas;
- un cierre que se sostiene.

Cambia el contenido, la paleta y los movimientos para cada pedido. En `references/formato.md` §14 hay tres ejemplos más: uno de 12 s, uno con escenas en archivos y foto, y uno con canvas.

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,height=1920">
<script src="assets/vendor/gsap.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0f1a2b; }
  #main { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #0f1a2b; color: #f4efe6; font-family: Arial, sans-serif; }
  #fondo { position: absolute; inset: 0; background: #0f1a2b; }
  /* La rueda vive todo el video (sin tiempo propio) y une las dos escenas. */
  #rueda { position: absolute; left: 290px; top: 1220px; width: 500px; height: 500px; z-index: 0; }
  #rueda circle, #rueda line { fill: none; stroke: #ffb347; stroke-width: 10; }
  #suelo { position: absolute; left: 0; right: 0; top: 1714px; height: 6px; background: #ffb347; z-index: 0; }
  .escena { position: absolute; inset: 0; }
  /* Texto entre 240 y 1180 px, 90 px a los lados (zona segura vertical). */
  .mundo { position: absolute; left: 90px; right: 90px; top: 240px; height: 940px; }
  .kicker { font-weight: bold; font-size: 48px; line-height: 1.2; letter-spacing: 6px; color: #ffb347; margin: 0; }
  #e1-titulo { font-size: 230px; font-weight: bold; line-height: 1.2; margin: 40px 0 0; }
  #e1-titulo span, #e1-sub span { display: inline-block; }
  #e1-sub { font-size: 64px; line-height: 1.25; margin: 40px 0 0; }
  #e1-tarjeta { position: absolute; left: 0; right: 0; bottom: 0; height: 300px; border-radius: 40px; background: #ffb347; color: #0f1a2b; padding: 56px; font-size: 72px; font-weight: bold; line-height: 1.2; }
  #e2-nombre { font-family: Georgia, "Times New Roman", serif; font-size: 180px; line-height: 1.15; margin: 40px 0 0; }
  #e2-cta { display: inline-block; margin-top: 60px; background: #f4efe6; color: #0f1a2b; font-weight: bold; font-size: 56px; line-height: 1.2; padding: 30px 56px; border-radius: 80px; }
  #e2-dato { position: absolute; left: 0; right: 0; bottom: 0; border-top: 4px solid #ffb347; padding-top: 30px; font-size: 52px; line-height: 1.3; margin: 0; }
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="8" data-width="1080" data-height="1920" data-fps="30">
  <div id="fondo"></div>
  <div id="suelo"></div>
  <svg id="rueda" viewBox="0 0 500 500" aria-hidden="true">
    <circle cx="250" cy="250" r="235"/><circle cx="250" cy="250" r="40"/>
    <line x1="250" y1="15" x2="250" y2="485"/><line x1="15" y1="250" x2="485" y2="250"/>
    <line x1="84" y1="84" x2="416" y2="416"/><line x1="416" y1="84" x2="84" y2="416"/>
  </svg>

  <section id="e1" class="escena clip" data-start="0" data-duration="4.4" style="z-index:1">
    <div id="e1-mundo" class="mundo">
      <p id="e1-kicker" class="kicker">TALLER DE BICICLETAS</p>
      <h1 id="e1-titulo"><span>R</span><span>U</span><span>E</span><span>D</span><span>A</span></h1>
      <p id="e1-sub"><span>Tu</span> <span>bici,</span> <span>lista</span><br><span>en</span> <span>un</span> <span>día.</span></p>
      <div id="e1-tarjeta">Frenos, cambios<br>y ruedas</div>
    </div>
  </section>

  <section id="e2" class="escena clip" data-start="3.8" data-duration="4.2" style="z-index:2">
    <div id="e2-mundo" class="mundo">
      <p id="e2-kicker" class="kicker">TE ESPERAMOS</p>
      <h2 id="e2-nombre">Taller<br>Rueda</h2>
      <div id="e2-cta">Pasa hoy</div>
      <p id="e2-dato">Lunes a sábado<br>de 9:00 a 19:00</p>
    </div>
  </section>
</div>
<script>
  const tl = gsap.timeline({ paused: true });

  // Movimiento continuo: la rueda gira todo el video (15° por segundo, sin ease).
  tl.fromTo("#rueda", { rotation: 0 }, { rotation: 120, duration: 8, ease: "none" }, 0);
  tl.fromTo("#suelo", { scaleX: 0.3, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.8, ease: "expo.out" }, 0);

  // Escena 1. El cuadro 0 ya muestra rótulo, letras tenues, rueda y suelo: nunca empieza vacío.
  // El rótulo se descubre con un recorte en su sitio (un desplazamiento lo sacaría del margen en el cuadro 0).
  tl.fromTo("#e1-kicker", { clipPath: "inset(0% 50% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "expo.out" }, 0);
  // Título letra por letra (es un nombre): sube, crece y se endereza; 0,1 s entre letras.
  tl.fromTo("#e1-titulo span", { opacity: 0.2, y: 140, scale: 0.6, rotation: -8 }, { opacity: 1, y: 0, scale: 1, rotation: 0, duration: 0.55, ease: "power4.out", stagger: 0.1 }, 0);
  // Bajada palabra por palabra con desenfoque (90 ms entre palabras).
  tl.fromTo("#e1-sub span", { opacity: 0, filter: "blur(8px)", y: 24 }, { opacity: 1, filter: "blur(0px)", y: 0, duration: 0.3, ease: "power3.out", stagger: 0.09 }, 1.1);
  // Tarjeta: llega desde abajo con escala y un resorte suave.
  tl.fromTo("#e1-tarjeta", { opacity: 0, y: 220, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }, 1.5);
  // La rueda da un empujón cuando llega la tarjeta (repetición finita).
  tl.fromTo("#rueda", { scale: 1 }, { scale: 1.08, duration: 0.25, ease: "power2.out", yoyo: true, repeat: 1 }, 1.6);

  // Transición de empuje (3.8–4.35 s): las dos escenas suben juntas con el mismo ease,
  // como una sola tira; la que sale se desenfoca. Las dos están vivas a la vez: nunca hay un cuadro vacío.
  tl.fromTo("#e1-mundo", { y: 0, filter: "blur(0px)" }, { y: -1200, filter: "blur(15px)", duration: 0.55, ease: "power3.inOut" }, 3.8);
  tl.fromTo("#e2-mundo", { y: 1200 }, { y: 0, duration: 0.55, ease: "power3.inOut" }, 3.8);

  // Escena 2: cada pieza entra con su propio movimiento, una tras otra.
  tl.fromTo("#e2-nombre", { scale: 1.15, filter: "blur(10px)", transformOrigin: "0% 50%" }, { scale: 1, filter: "blur(0px)", duration: 0.7, ease: "expo.out" }, 4.15);
  tl.fromTo("#e2-cta", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, 4.7);
  tl.fromTo("#e2-dato", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 5.0);
  // Final: el texto ya llegó y queda quieto 3 s (la última línea pide al menos 2 s); solo la rueda sigue.

  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
</script>
</body>
</html>
```

## Si faltan piezas

La herramienta pide el consentimiento de descarga a través de la app.

- Si la persona elige «Ahora no», responde: `No se instalaron las piezas de video: elegiste «Ahora no». Puedes pedirlo de nuevo cuando quieras instalarlas.`
- Si la instalación no termina: `Faltan piezas de video; no se pudo completar la instalación.`
- Si falta el runtime: `Falta el Node de la app para renderizar video.`
- También puede decir: `El video no está disponible en este equipo.`

Explica el motivo con palabras simples y ofrece reintentar desde la app cuando corresponda. No uses la terminal, instaladores globales ni rutas alternativas para instalar. Una cancelación o un tiempo agotado no produjo un video terminado.

## Qué leer

| El pedido | Lee |
| --- | --- |
| Promo, lanzamiento, anuncio, una función, un negocio | `references/types/promo.md` |
| Vertical o clip para redes | `references/types/vertical.md` |
| Explicativo, tutorial, «cómo funciona» | `references/types/explicativo.md` |
| Números, gráficos, datos | `references/types/datos.md` |
| Un video que cuenta algo (más de unos 10 s) | `references/historia.md` |
| Pasar el pedido a números y planos | `references/especificacion.md` |
| Movimiento: eases, títulos, transiciones, ritmo, cambios que pide la persona | `references/movimiento.md` |
| El estilo de una marca o de una referencia; paleta y fuentes | `references/estilo.md` |
| Tipografía cinética, un lugar real, un sitio web, un cambio de código | `references/cine.md` |
| Tarjetas sobre un video de una persona hablando | `references/overlays.md` |
| Escenas en archivos, atributos, fuentes, GSAP, CSS, canvas, medios, errores de la herramienta | `references/formato.md` |
| Música, voz o efectos que entregó la persona | `references/sonido.md` |
| Cómo revisar los cuadros y escribir la nota de entrega | `references/revision.md` |
