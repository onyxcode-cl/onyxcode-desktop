# Formato de la composición

Lee esto para escribir o corregir la composición: dónde va, qué contrato cumple, cómo se arman las escenas, qué atributos existen, qué fuentes funcionan y cómo mover cosas con GSAP, CSS o canvas. Las guías de movimiento, estilo e historia dicen **qué** hacer; esta dice **cómo escribirlo** para que el motor lo dibuje igual en cada cuadro, en Mac y en Windows.

Todo lo de este archivo se probó con el motor de la app (HyperFrames 0.9.64 + GSAP 3.15.0). Los tres ejemplos completos del final salen sin avisos de la app; solo quedan los avisos oficiales esperables de la sección 13 (estructura de un solo archivo y movimientos de transición o de cámara).

## 1. Cómo dibuja el motor

- El motor abre tu `index.html` en un navegador **sin red** y, para cada cuadro (30 por segundo), salta a ese instante de la línea de tiempo y toma una foto. No reproduce el video de corrido: calcula cada cuadro por separado y en cualquier orden.
- Por eso todo lo que se ve tiene que salir del tiempo de la línea de tiempo, nunca de lo que pasó en el cuadro anterior ni del reloj.
- El motor es el mismo en Mac y en Windows. Lo único que cambia entre equipos son las fuentes instaladas en el sistema: usa solo las de la sección 8.

## 2. Dónde va y cómo se entrega

### Carpeta

Una carpeta por video dentro de `./.lazunox/trabajo/`. La entrada es siempre `index.html` en la raíz de esa carpeta, y `composicion` es la ruta relativa de ese archivo (nunca la carpeta).

```
.lazunox/trabajo/promo-cafe/
  index.html               ← raíz: tamaño, duración y escenas
  compositions/            ← una escena por archivo (opcional)
    apertura.html
    cierre.html
  assets/
    fotos/huerta.jpg       ← solo fotos aprobadas con documentos_imagenes_usar
    fonts/Marca-700.woff2  ← solo fuentes que ya están en la carpeta del proyecto o que entregó la persona
    audio/cancion.mp3      ← audio de la persona o música buscada
```

Límites (la herramienta copia la carpeta antes de dibujar y rechaza lo que no cumpla):
- hasta 256 entradas, 8 niveles de carpetas, 32 MB por archivo y 128 MB en total;
- sin enlaces simbólicos;
- solo estos tipos: `.html .js .mjs .css .json .png .jpg .jpeg .webp .gif .svg .woff .woff2 .ttf .otf .mp3 .wav .aac .ogg .m4a .mp4 .webm`. El audio que se mezcla en el MP4 solo puede ser `.mp3`, `.m4a`, `.wav` o `.aac` o `.ogg`.

Rutas: relativas y sin `/` al inicio (`assets/fotos/huerta.jpg`), también dentro de `compositions/`: se escriben como si estuvieras en `index.html`.

### GSAP

En `index.html`, exactamente:

```html
<script src="assets/vendor/gsap.min.js"></script>
```

La app sirve en esa ruta GSAP 3.15.0 (solo el núcleo), aunque el archivo no exista en tu carpeta. No lo copies, no lo bajes y no lo cargues dentro de las escenas: las escenas usan el `gsap` de la página. La ruta antigua `../node_modules/gsap/dist/gsap.min.js` también funciona, pero la revisión oficial la marca con el aviso `invalid_parent_traversal_in_asset_path`; si lo ves, cambia a `assets/vendor/gsap.min.js`.

### Sin red

Cualquier `http(s)://`, CDN, fuentes remotas, `iframe` o `fetch` hacia fuera queda bloqueado y sale vacío. Las fotos entran como archivo local en `assets/` (sección 12), nunca como URL.

### Según el modo

- **Code:** escribe los archivos con tus herramientas y pasa `carpeta` (ruta absoluta del proyecto abierto) a `video_cuadros` y a `video_render`.
- **Overdrive:** escribe los archivos; no pases `carpeta`.
- **Chat:** no tienes herramientas de archivos.
  - Con `html`: envía el `index.html` completo en `html` de `video_cuadros` (hasta 512 KB). Todo vive en un solo archivo (sección 4): estilos, SVG y scripts en línea.
  - Con `archivos`: envía `index.html`, `compositions/*.html` y otros textos (`.css`, `.js`, `.json`, `.svg`) como `{ruta: contenido}`, con la misma estructura de carpeta de arriba. Hasta 64 archivos, 512 KiB cada uno, 4 MiB en total. Nunca `html` y `archivos` en la misma llamada.
  - La respuesta trae `composicion`: úsala tal cual en las llamadas siguientes y en `video_render`. Para corregir, envía `composicion` junto con otro `html` completo, o con `archivos` que traiga solo los archivos que cambian. Sin `composicion` se crea una composición nueva y se pierden las fotos ya copiadas.
  - Fotos: con `fotos` de `video_cuadros` (sección 12), también junto a `html`. La app las copia a `assets/`. Nunca pegues una foto en base64 a mano ni pongas su URL.
  - Audio: con `audio` de `video_render` (sección 12). Los archivos de fuente no se pueden enviar en Chat: usa las fuentes de la sección 8, grupos 1 y 2.

## 3. Contrato

La herramienta rechaza la composición o la dibuja mal si no se cumple:

1. **Raíz.** Un elemento con `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-width`, `data-height` y `data-fps="30"`. Tiene que ser el primer elemento con `data-composition-id` de la página.
   - `data-width` × `data-height` = el formato pedido: `vertical` 1080×1920, `cuadrado` 1080×1080, `horizontal` 1920×1080.
   - `data-duration` en segundos: mayor que 0, hasta 120 y múltiplo de 1/30 (por ejemplo 12, 12.5, 7.2). Debe ser igual a la `duracion` que pases a `video_render`.
   - `html`, `body` y la raíz miden exactamente eso, con `margin: 0` y `overflow: hidden`.
2. **Línea de tiempo.** `const tl = gsap.timeline({ paused: true })`, después los tweens y al final `window.__timelines["main"] = tl` (crea `window.__timelines` si no existe). Sin ella, o sin pausar, la app rechaza la composición.
   - Registra la línea de tiempo después de crear sus tweens. Si la armas dentro de un callback asíncrono, regístrala al final de ese callback: registrarla antes deja cuadros en blanco.
3. **Largo.** El video dura lo que dice `data-duration` de la raíz. Lo que pase después se corta; si la animación termina antes, el último cuadro queda congelado (no es error, pero un final quieto y largo se ve muerto).
4. **Todo depende del tiempo.** Prohibido: `Date.now()`, `performance.now()`, `new Date()`, `Math.random()` sin semilla, `setTimeout`, `setInterval`, `requestAnimationFrame` como reloj, `fetch`, `repeat: -1`, `tl.play()`. Repeticiones solo finitas: `repeat: Math.max(0, Math.floor(duracion / ciclo) - 1)`. Azar solo con semilla (mulberry32, ejemplo 3).
5. **Elementos con tiempo** (`class="clip"` + `data-start` + `data-duration`, en segundos) se ven en el intervalo [inicio, inicio + duración). El instante final no se dibuja: un estado que debe verse tiene que llegar antes.
6. Nunca animes `display`, `visibility` ni `autoAlpha` de un `.clip`: anima un hijo, o su `opacity`.
7. Ningún `transform` en el CSS de un elemento que GSAP transforma: el estado de partida va dentro del tween (`fromTo`). Anima transformaciones (`x`, `y`, `scale`, `rotation`) y `opacity`; no `left`, `top`, `width` ni `height`.
8. Usa `fromTo`, no `from`: el motor salta hacia atrás y hacia adelante, y `from` guarda su punto de partida una sola vez, así que se desfasa al volver. Solo el **primer** tween de cada propiedad de un elemento es `fromTo`; los siguientes sobre la misma propiedad del mismo elemento (salidas, el segundo o tercer cambio de color del fondo) son `tl.to(…)`. Un `fromTo` posterior pinta su punto de partida apenas se arma la línea de tiempo y ese estado se ve en el cuadro 0 (textos de salida encimados, fondo con el color final).
9. **Medios:** nunca `play()`, `pause()` ni `currentTime`. Sin `crossorigin`. Detalles en la sección 12.
10. **IDs únicos** en toda la página armada. Con escenas en archivos, ponles el nombre de la escena como prefijo (`#apertura-titulo`).
11. **Fuentes:** solo las incluidas por la app, las que existen en los dos sistemas o un `@font-face` a un archivo de `assets/fonts/` (sección 8).
12. **Archivo de escena:** todo dentro de `<template>`, y su raíz se estila como `#root` (sección 5).

## 4. Un solo `index.html`

Sirve siempre, y en Chat con `html` es la única forma.

- Cada escena es un hijo directo de la raíz con tiempo propio: `<section id="e1" class="escena clip" data-start="0" data-duration="4.8" style="z-index:1">`. El motor la muestra solo dentro de su ventana.
- **Superpón las ventanas** de dos escenas seguidas entre 0.2 y 0.6 s, para que la transición tenga las dos vivas. Nunca dejes un hueco sin contenido entre escenas.
- El orden de pintura lo da `z-index`, no el orden en el tiempo: la escena que entra va encima.
- Todas las escenas comparten una línea de tiempo (`main`) con tiempos absolutos del video.
- La transición se escribe al final de la escena que sale y al principio de la que entra, con el mismo color, objeto o movimiento en los dos lados (ejemplo 1: la taza crece hasta ser el fondo de la escena siguiente).

## 5. Escenas en archivos: `index.html` + `compositions/` + `assets/`

Es el formato de HyperFrames para videos con varias escenas: cada escena se lee y se corrige sola. Úsalo en Code y Overdrive, y en Chat cuando exista `archivos`.

```html
<!-- index.html: solo anfitriones de escena (y fondo/audio si hacen falta) -->
<div id="main" data-composition-id="main" data-start="0" data-duration="10"
     data-width="1920" data-height="1080" data-fps="30">
  <div id="fondo"></div>
  <div id="apertura" data-composition-id="apertura" data-composition-src="compositions/apertura.html"
       data-start="0" data-duration="5.6" data-track-index="1"
       data-width="1920" data-height="1080" style="z-index:1"></div>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = gsap.timeline({ paused: true });
</script>
```

```html
<!-- compositions/apertura.html: TODO dentro de <template> -->
<template>
  <style>
    #root { position: absolute; inset: 0; }
  </style>
  <div id="root" data-composition-id="apertura" data-width="1920" data-height="1080">
    <h1 id="apertura-titulo">…</h1>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#apertura-titulo", { opacity: 0, filter: "blur(8px)" },
      { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" }, 0.4);
    window.__timelines["apertura"] = tl;
  </script>
</template>
```

Reglas:
- **El mismo nombre en tres lugares:** el `id` y el `data-composition-id` del anfitrión, el `data-composition-id` de la raíz de la escena y la clave de su línea de tiempo (`window.__timelines["apertura"]`). Si no coinciden, la escena puede quedar quieta o tardar mucho en cargar.
- Lo que quede fuera de `<template>` (estilos o scripts) se descarta. Solo los archivos de escena usan `<template>`; `index.html` no.
- La raíz de la escena se estila como `#root` con `position: absolute; inset: 0`, nunca con medidas fijas en píxeles. El lienzo mide `data-width` × `data-height` del anfitrión.
- El reloj de la escena empieza en 0 cuando empieza su anfitrión (`data-start`). Dentro de la escena, todo tiempo es local.
- `data-duration` del anfitrión es el espacio de la escena: si su línea de tiempo es más corta, se congela en su último cuadro; si el espacio es más corto que la escena, se corta.
- La línea de tiempo de una escena solo alcanza los elementos de su archivo. Dos líneas de tiempo nunca animan la misma propiedad del mismo elemento.
- Nunca agregues la línea de tiempo de una escena a la de `main` (`tl.add(...)`): el motor ya mueve cada escena; anidarla la mueve dos veces. A `main` le basta una línea de tiempo pausada vacía.
- La transición entre escenas se arma con la superposición de anfitriones (como en la sección 4): la escena que entra cubre a la que sale con un objeto, un color o un movimiento propio (ejemplo 2).
- Un fondo sin tiempo en la raíz necesita `position: absolute; inset: 0`, o queda sin tamaño. Pon el color de fondo del video en un hijo de pantalla completa (`#fondo`) y no solo en la raíz.
- `data-track-index` no cambia el video; solo ordena. Escenas una tras otra comparten una pista; lo que va encima de una escena va en la siguiente pista; el audio, en la suya.

## 6. Atributos

| Atributo | Dónde | Qué hace |
| --- | --- | --- |
| `data-composition-id` | raíz, anfitrión, raíz de escena | Nombre de la composición. La raíz se llama `main`. |
| `data-width`, `data-height` | raíz, anfitrión, raíz de escena | Tamaño del lienzo en píxeles. |
| `data-start`, `data-duration` | raíz, anfitriones, clips, medios | Segundos, relativos al archivo que los declara. |
| `data-fps="30"` | raíz | Cuadros por segundo de la app (siempre 30). |
| `class="clip"` | elementos con tiempo | Marca el elemento con tiempo y le da la caja de pantalla completa. |
| `data-composition-src` | anfitrión | Archivo `.html` de la escena (`compositions/x.html`). |
| `data-track-index` | anfitriones, medios | Pista para ordenar; no cambia el dibujo. El orden de pintura es `z-index`. |
| `data-media-start` | `<audio>`, `<video>` | Desde qué segundo del archivo empieza (recorte). |
| `data-volume` | `<audio>`, `<video>` | Ganancia: `1` = igual, `0` = silencio, hasta `3.98` (+12 dB). |
| `data-fade-in`, `data-fade-out` | `<audio>`, `<video>` | Fundidos lineales en los bordes del clip, en segundos. |
| `data-playback-rate` | `<video>`, `<audio>` | Velocidad constante, de 0.1 a 10. |
| `data-hidden` | cualquier clip | Lo oculta del video sin borrarlo. |
| `data-motion-blur="on"` | raíz | Estela de movimiento en los elementos 2D rápidos (ver la guía de movimiento). Opcional y más lento de dibujar: úsalo solo si la pieza tiene movimientos rápidos; `data-motion-blur="off"` en un subárbol lo excluye. |

No existen aquí (son del editor o de la nube de HyperFrames): variables (`data-composition-variables`, `data-variable-values`, `data-var-text`), `data-automation`, transiciones con shaders, `data-layout-*` y `data-no-timeline`. No los uses. Escribe el texto directamente en el HTML.

## 7. Tiempo

- Un clip se ve en [inicio, inicio + duración): lo que debe verse al final llega antes del final.
- Crea cada línea de tiempo (la de `main` y la de cada escena) con `{ paused: true }`: el motor las mueve. Una línea de tiempo hija que metas dentro de otra con `tl.add(...)` no se pausa ni hace falta pausarla. Nunca `tl.play()`.
- `<video>` y `<audio>` sin `data-duration` duran todo el archivo; un `<img>` con `data-start` y sin `data-duration` dura 3 s. Mejor: no le pongas tiempo a una imagen; ponla dentro de una escena.
- Un clip dentro de otro elemento con tiempo cuenta su `data-start` desde la composición, no desde ese elemento, y solo se ve mientras ese elemento se ve. Si sus ventanas no se cruzan, nunca aparece.
- Pon cada tween en un segundo absoluto: `tl.to(el, {…}, 2.4)`. Así cambiar una parte no corre todo lo demás.
- Para ver varios instantes con `video_cuadros`, pide segundos menores que `data-duration`.

## 8. Fuentes

La composición no tiene red. Hay tres vías:

1. **Fuentes que incluye la app** (sin archivo y sin red, iguales en Mac y Windows; solo estilo normal, sin cursiva). Escríbelas por su nombre:
   - pesos 400, 700 y 900: `Inter`, `Montserrat`, `Outfit`, `Nunito`, `Poppins`, `Roboto`, `Lato`, `Playfair Display`;
   - pesos 400 y 700: `Oswald`, `Open Sans`, `EB Garamond`, `Space Mono`, `IBM Plex Mono`, `JetBrains Mono`, `Source Code Pro`, `Noto Sans JP`;
   - solo 400: `League Gothic` (condensada para titulares) y `Archivo Black` (ya gruesa).
   - Usa solo esos pesos: otro peso (300, 500, 600, 800) o una cursiva se simulan y se ven mal. Con respaldo: `font-family: Montserrat, Arial, sans-serif;`.
   - Si el aviso o la página dicen que una fuente no cargó, cambia a la vía 2 y dilo al entregar.
2. **Fuentes que existen en Mac y en Windows** (sin archivo):
   - Sin serifa: `Arial`, `Arial Black`, `Verdana`, `Tahoma`, `Trebuchet MS`.
   - Con serifa: `Georgia`, `Times New Roman`.
   - Monoespaciada: `Courier New`.
   - Display condensada: `Impact` (solo titulares cortos).
   - Escribe siempre una de respaldo de la misma clase: `font-family: Georgia, "Times New Roman", serif;`. No uses `Helvetica`, `Segoe UI`, `San Francisco` ni `system-ui`: cambian según el equipo.
   - En negrita usa `font-weight: bold` (700) o la familia ya gruesa (`Arial Black`); otros pesos se simulan y se ven distintos según el equipo.
3. **Un archivo de fuente en la carpeta** (solo Code y Overdrive: `archivos` de Chat no admite archivos binarios): solo si el archivo ya está en el proyecto o lo entregó la persona. Nunca lo bajes.

```css
@font-face {
  font-family: "Marca";
  src: url("assets/fonts/Marca-700.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
}
h1 { font-family: "Marca", Arial, sans-serif; font-weight: 700; }
```

   Declara un `@font-face` por cada peso que uses, en el archivo que usa la fuente (en una escena, dentro de su `<template>`).

Si la marca tiene una fuente propia y no hay archivo, usa la más parecida de las listas 1 y 2 y dilo al entregar.

**Interlineado y avisos:** con `line-height` menor que 1.15, las letras sobresalen de su caja y la revisión avisa "se sale de su caja" o "queda tapado". En títulos usa 1.15–1.25.

**Texto que debe caber en un ancho:** `window.__hyperframes.fitTextFontSize(texto, { fontFamily, fontWeight, maxWidth, baseFontSize, minFontSize, step })` devuelve `{ fontSize, fits }` para que el texto quepa en una línea. Por defecto parte en 78 px, baja de 2 en 2 y no baja de 42. Úsalo una vez al armar, antes de crear los tweens; si `fits` es `false`, acorta el texto en vez de achicarlo más.

## 9. GSAP: lo que hay que saber

- Solo el núcleo de GSAP: `gsap.timeline`, `set`, `to`, `fromTo` (y `from`, que no conviene), `stagger`, `onUpdate`, `transformOrigin`. **No hay plugins** (SplitText, DrawSVG, MorphSVG, MotionPath, CustomEase, ScrollTrigger). Para animar palabras o letras, envuélvelas tú en `<span>`; para dibujar un trazo, usa `stroke-dasharray` y anima `strokeDashoffset`.
- Eases del núcleo: `none`, `power1`–`power4`, `expo`, `sine`, `circ`, `back`, `elastic`, cada uno con `.in`, `.out` o `.inOut` (por ejemplo `expo.out`, `power2.inOut`, `back.out(1.4)`, `elastic.out(1, 0.5)`).
- Propiedades que se ven bien y son seguras: `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`, `filter: "blur(8px)"`, `clipPath: "inset(…)"` o `"circle(…)"`, `color`, `backgroundColor`, `strokeDashoffset`.
- Un `<span>` que se transforma necesita `display: inline-block` (o `block`).
- Mide el diseño una vez, antes de crear los tweens; nunca dentro de `onUpdate`.
- **Contadores y gráficos:** anima un objeto común y escribe el resultado en `onUpdate`. Es determinista porque solo depende del tiempo:

```js
const cuenta = { n: 0 };
tl.fromTo(cuenta, { n: 0 }, { n: 72, duration: 1.2, ease: "expo.out", onUpdate: () => {
  document.getElementById("numero").textContent = Math.round(cuenta.n);
} }, 4.85);
```

- **Encuadre de cámara** (acercar, alejar, recorrer una foto): anima `scale` y `x`/`y` en un envoltorio **dentro** de la escena, nunca en el `.clip` ni en la foto con tiempo.
- **Recortes y revelados:** anima `clipPath` en un envoltorio interior (`inset(0% 100% 0% 0%)` → `inset(0% 0% 0% 0%)` revela de izquierda a derecha; `circle(0% at 50% 40%)` → `circle(80% at 50% 40%)` es un iris).

## 10. Animaciones CSS (`@keyframes`)

Sirven para decoración simple y el motor las encuentra solo. Reglas:
- un número finito de repeticiones (nunca `infinite`);
- `animation-fill-mode: both` (o `both` en la forma corta);
- el elemento lleva `class="clip"`, `data-start` y `data-duration`: la animación cuenta desde su `data-start`.

```html
<style>
  #barra { position: absolute; left: 100px; top: 500px; width: 880px; height: 80px; background: #fc0;
           transform-origin: 0 50%; animation: crecer 2s linear 1 both; }
  @keyframes crecer { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
<div id="barra" class="clip" data-start="0.5" data-duration="2.5"></div>
```

Para todo lo que cuenta una historia (títulos, transiciones, cifras), usa GSAP: se coordina mejor y se ajusta en un solo lugar.

## 11. Canvas: dibujar desde el tiempo

Para partículas, texturas, gráficos dibujados o cualquier cosa generativa: escucha el evento `hf-seek` y dibuja el cuadro **solo** a partir de `e.detail.time`.

```html
<script>
  function dibujar(t) {
    /* borra y dibuja todo el cuadro para el segundo t, sin recordar nada del cuadro anterior */
  }
  window.addEventListener("hf-seek", (e) => {
    dibujar(e.detail.time);
    // si hay trabajo asíncrono (decodificar una imagen): e.detail.waitUntil(promesa), llamado en este mismo instante
  });
  dibujar(0);
</script>
```

- Sin `requestAnimationFrame` ni temporizadores como reloj.
- Azar con semilla (mulberry32) creado una vez al cargar; la posición de cada partícula se calcula desde `t`, no sumando al cuadro anterior.
- Igual hace falta la línea de tiempo `main` pausada con la duración del video (`tl.to({}, { duration: D }, 0)`).
- La revisión automática **no ve** lo que dibujas en un canvas (ni textos ni choques): míralo tú en los cuadros.
- Nada de Three.js, WebGL pesado, p5, Lottie ni anime.js: la app no los sirve y no hay red para bajarlos.

## 12. Fotos, video y audio

### Fotos

- Fotos desde URL HTTPS del archivo original, o preparadas con `documentos_imagenes_buscar` → `documentos_imagenes_ver` → `documentos_imagenes_usar` (de cualquier licencia) o que entregó la persona.
- Entran con `fotos` de `video_cuadros`, igual en los tres modos: `fotos: [{"origen": "<id de documentos_imagenes_usar, o nombre/id del adjunto en Chat, o ruta relativa en el proyecto>", "destino": "assets/fotos/huerta.jpg"}]`. `destino` va dentro de `assets/` y termina en `.jpg`, `.jpeg`, `.png`, `.webp` o `.gif`; hasta 24 fotos, 20 MiB por descarga web y 32 MiB por archivo local. La app las copia junto a la composición y las conserva para las llamadas siguientes.
- `<img src="assets/fotos/huerta.jpg" alt="descripción de lo que se ve">`, con `object-fit: cover`, dentro de un envoltorio que define el recorte (`overflow: hidden`) y otro interior que se mueve. Nunca deformes la proporción.
- Para que la revisión automática "vea" la foto, su caja debe medir lo que se ve: un panel de foto a la derecha es un elemento de ese tamaño, no una foto de pantalla completa recortada con `clip-path`.
- Sin créditos ni pies de foto en el video, salvo que la persona los pida.
- Sin foto válida, haz el video con formas, color y tipografía, y dilo al entregar.

### Video de la persona

```html
<video id="toma-1" class="clip" src="assets/video/toma.mp4" data-start="2" data-duration="4"
       data-media-start="1.5" muted playsinline
       style="position:absolute; left:0; top:0; width:1920px; height:1080px; object-fit:cover; z-index:2"></video>
```

- El tiempo va en el `<video>`; su envoltorio no lleva tiempo.
- Siempre `muted`: la app solo mezcla elementos `<audio>` (y la lista `audio` de `video_render`); el sonido propio de un `<video>` no llega al MP4. Si la persona quiere ese sonido, pídele el audio como archivo aparte (`.mp3`, `.m4a`, `.wav` o `.aac`).
- Un `<video>` solo puede entrar en Code y Overdrive (archivo dentro de `assets/video/`); en Chat no hay forma de enviarlo.
- Acercar o recorrer: en un envoltorio, no en el `<video>`.

### Audio

Prioriza el archivo de la persona. Si no hay, busca música adecuada con `video_musica_buscar` y pasa el origen HTTPS en `audio` de `video_render`. No generes voces ni descargues de plataformas que lo impiden.

La forma más simple, en los tres modos, es la lista `audio` de `video_render` (`origen`, `inicio`, `desde`, `hasta`, `volumen`, `fundidoEntrada`, `fundidoSalida`; ver `SKILL.md` y `sonido.md`). En Code y Overdrive también puedes dejar el archivo en `assets/audio/` y escribir un `<audio>` en la composición:

```html
<audio id="musica" class="clip" src="assets/audio/cancion.mp3"
       data-start="0" data-duration="12" data-media-start="8"
       data-volume="0.8" data-fade-in="0.5" data-fade-out="1.5" data-track-index="5"></audio>
```

- Todo `<audio>` lleva `id` (la revisión oficial marca uno sin `id`). Formatos: `.mp3`, `.m4a`, `.wav` o `.aac`; hasta 16 pistas entre la lista y la composición.
- `data-start`: cuándo suena en el video; `data-media-start`: desde qué segundo de la canción; `data-duration`: cuánto; `data-volume`: 0 a 3.98; `data-fade-in`/`data-fade-out`: segundos de fundido en los bordes.
- Con música: que entre en un compás fuerte de la canción (no en una intro tranquila) **si la persona te dijo dónde está**; elige ese punto con `data-media-start`. Si no lo sabes, empieza en el segundo 0 del archivo (`sonido.md`). Termina con un fundido corto bajo el cierre.
- La respuesta de `video_render` trae `audio` (códec y duración) cuando el MP4 tiene sonido. Si no lo trae, salió mudo: díselo a la persona, entrega el MP4 y conserva su archivo de audio intacto. Un archivo que no es audio válido, o un recorte fuera del archivo, detiene el render con un error de audio.

## 13. Lo que ve la revisión automática

`video_cuadros` y `video_render` revisan los segundos que pides, 8 instantes repartidos en todo el video (D/9 … 8D/9) y cada cambio de escena o `.clip` cada 0,1 s en ±0,5 s del inicio y del final, además de su mitad y la mitad de las transiciones. Además comparan miniaturas cada 0,25 s: `movimiento` informa porcentaje y tramos casi quietos de al menos 1 s; avisa por encima del 35 % o con un tramo de 2 s o más fuera de los últimos 1,5 s. Devuelven `avisos` (con segundo y texto) y `cobertura` (cuánto del lienzo ocupa el contenido en cada instante). `video_cuadros` devuelve además una **hoja de contactos** con hasta 24 de esos instantes: úsala para ver el movimiento entre tus cuadros.

Hay dos clases de avisos:
- los de la app, en español (texto que se sale, tapado, recortado, cobertura, cuadro casi vacío);
- los de la revisión oficial de HyperFrames, que empiezan con `Revisión oficial (código):` y vienen en inglés.

Avisos oficiales que son esperables y no hay que «arreglar» (explícalos en la nota de entrega si quedan):
- `nested_structure_needs_subcomposition` con un solo `index.html` y escenas `<section class="clip">`: se refiere a cómo el editor de HyperFrames muestra la línea de tiempo, no al video. En Chat con `html` siempre aparece; con varios archivos, usa escenas en `compositions/` y desaparece.
- `container_overflow` en el envoltorio que se mueve dentro de un marco con `overflow: hidden` (acercamiento o paneo de una foto): es el recorte buscado.
- `canvas_overflow`, `container_overflow` o `escaped_container` solo en los instantes en que una escena entra o sale empujada, o un objeto crece más allá del cuadro para volverse el mundo siguiente. Compruébalo en el cuadro: si el mismo aviso sigue con todo quieto, es un error.

Todo otro aviso oficial (por ejemplo `invalid_parent_traversal_in_asset_path`, un medio sin `id`, una fuente sin `@font-face`) se corrige.

- Mide **cajas**: textos, imágenes, SVG, canvas y elementos con fondo o borde. No ve el recorte de `clip-path` ni lo dibujado dentro de un canvas, y no cuenta un elemento que ocupa el 95 % o más del lienzo (un fondo).
- **Área segura** del aviso: en vertical, 90 px a los lados y 200 px arriba y abajo; en cuadrado y horizontal, 54 px. En vertical, además, todo texto y el sujeto van entre 200 y 1330 px; debajo, solo decoración.
- **Cobertura menor al 60 %:** el contenido está amontonado en una zona. Abre el diseño hacia los bordes con algo que tenga caja: una franja, una línea a lo ancho, un panel de foto, una forma.
- Si un aviso cae justo en medio de una transición, es probable que sea real: haz que el contenido nuevo entre junto con la escena (como un solo objeto) en vez de dejar medio segundo casi vacío.

Errores que detienen la herramienta y cómo corregirlos:

| Error | Corrección |
| --- | --- |
| El HTML declara otro tamaño | `data-width`/`data-height` y el tamaño de `html`, `body` y la raíz iguales al formato. |
| Falta `data-composition-id` | Agrega la raíz `main` con tamaño y duración. |
| Falta la línea de tiempo | `window.__timelines["main"]` pausada, con GSAP desde `assets/vendor/gsap.min.js`. |
| La duración no coincide | La misma `data-duration` en la raíz y en `duracion` de `video_render`. |
| Un segundo fuera del clip | Pide segundos menores que `data-duration`. |
| El HTML no inicializa | Lee el primer error de la página que trae la respuesta; casi siempre es un error de JavaScript, un selector sin elemento o una ruta mal escrita. |
| Se agotó el tiempo | Simplifica (menos filtros de desenfoque a la vez, menos elementos, canvas más simple) o acorta. |

## 14. Ejemplos completos

Cambia el contenido, la paleta y los movimientos para cada pedido: son modelos de cómo se escribe, no plantillas para copiar.

### Ejemplo 1: un solo `index.html`, vertical, 12 s (sirve en Chat con `html`)

Tres escenas superpuestas. Muestra: título por palabras con desenfoque, un trazo que se dibuja, un objeto que se convierte en el fondo de la escena siguiente, un contador, una lista escalonada, un iris y un cierre sostenido. Todo el texto entre 220 y 1330 px; debajo, solo decoración.

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,height=1920">
<script src="assets/vendor/gsap.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #15100d; }
  #main { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: #15100d; color: #f7ead9; font-family: Georgia, "Times New Roman", serif; }
  .escena { position: absolute; inset: 0; }
  /* Todo el texto vive en la banda 220–1330 px; debajo, solo decoración. */
  .marco { position: absolute; left: 100px; right: 100px; top: 220px; height: 1110px; }
  .kicker { font-family: Arial, sans-serif; font-weight: bold; font-size: 48px; letter-spacing: 8px; color: #e9a35b; margin: 0; }
  .pie { position: absolute; left: 0; right: 0; bottom: 0; padding-top: 24px; border-top: 4px solid currentColor; font-family: Arial, sans-serif; font-size: 48px; line-height: 1.3; letter-spacing: 2px; margin: 0; }
  .deco { position: absolute; left: 0; right: 0; top: 1500px; height: 220px; }
  /* Escena 1 */
  #e1-titulo { font-size: 150px; line-height: 1.2; font-weight: normal; letter-spacing: -4px; margin: 30px 0 0; }
  #e1-titulo span { display: inline-block; }
  #e1-taza { position: absolute; left: 50%; top: 840px; width: 360px; height: 360px; margin-left: -180px; }
  #e1-disco { position: absolute; inset: 0; border-radius: 50%; background: #e9a35b; }
  #e1-vapor { position: absolute; left: 60px; top: -175px; width: 240px; height: 160px; }
  #e1-vapor path { fill: none; stroke: #f7ead9; stroke-width: 10; stroke-linecap: round; stroke-dasharray: 160; }
  #e1-deco { background: repeating-linear-gradient(135deg, #2a1d15 0 28px, #15100d 28px 56px); }
  /* Escena 2 */
  #e2 .fondo { position: absolute; inset: 0; background: #e9a35b; }
  #e2 .marco, #e2 .kicker { color: #2a1a10; }
  #e2-cifra { font-size: 300px; line-height: 1.2; letter-spacing: -10px; margin: 0; }
  #e2-cifra small { font-size: 120px; letter-spacing: -2px; }
  #e2-sub { font-family: Arial, sans-serif; font-size: 48px; line-height: 1.3; margin: 0 0 60px; }
  .item { display: flex; align-items: center; gap: 34px; font-size: 64px; line-height: 1.2; padding: 32px 0; border-top: 4px solid #2a1a10; }
  .item i { display: block; width: 34px; height: 34px; border-radius: 50%; background: #2a1a10; flex: none; }
  #e2-barra { top: 1560px; height: 40px; background: #2a1a10; }
  /* Escena 3 */
  #e3 .fondo { position: absolute; inset: 0; background: #15100d; }
  #e3-iris { position: absolute; inset: 0; }
  #e3 .marco { display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center; }
  #e3-centro { display: flex; flex-direction: column; align-items: center; }
  #e3-nombre { font-size: 300px; line-height: 1.2; letter-spacing: -8px; margin: 0 0 20px; }
  #e3-cta { font-family: Arial, sans-serif; font-weight: bold; font-size: 48px; color: #15100d; background: #e9a35b; padding: 30px 60px; border-radius: 80px; }
  #e3-dato { width: 100%; padding-top: 30px; border-top: 4px solid #e9a35b; font-family: Arial, sans-serif; font-size: 48px; line-height: 1.4; color: #d9c7b2; margin: 0; }
  #e3-deco { background: repeating-linear-gradient(45deg, #2a1d15 0 28px, #15100d 28px 56px); }
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="12" data-width="1080" data-height="1920" data-fps="30">

  <section id="e1" class="escena clip" data-start="0" data-duration="4.8" style="z-index:1">
    <div id="e1-mundo" class="escena">
      <div class="marco">
        <p id="e1-kicker" class="kicker">TOSTADO ESTA SEMANA</p>
        <h1 id="e1-titulo"><span>Café</span> <span>que</span><br><span>despierta.</span></h1>
        <p id="e1-pie" class="pie">TOSTADORES DESDE 2014</p>
      </div>
      <div id="e1-deco" class="deco"></div>
    </div>
    <!-- La taza (vista desde arriba) crece hasta ser el fondo de la escena 2: la transición tiene causa. -->
    <div id="e1-taza">
      <div id="e1-disco"></div>
      <svg id="e1-vapor" viewBox="0 0 240 160" aria-hidden="true">
        <path d="M40 160 C 10 120, 70 90, 40 45 S 55 8, 48 0"/>
        <path d="M120 160 C 90 120, 150 90, 120 45 S 135 8, 128 0"/>
        <path d="M200 160 C 170 120, 230 90, 200 45 S 215 8, 208 0"/>
      </svg>
    </div>
  </section>

  <section id="e2" class="escena clip" data-start="4.6" data-duration="4.2" style="z-index:2">
    <div class="fondo"></div>
    <div class="marco">
      <p id="e2-kicker" class="kicker">DEL TUESTE A TU TAZA</p>
      <h2 id="e2-cifra"><span id="e2-numero">0</span><small> h</small></h2>
      <p id="e2-sub">como máximo, siempre.</p>
      <div id="e2-lista">
        <div class="item"><i></i>Grano de altura</div>
        <div class="item"><i></i>Tostado cada lunes</div>
        <div class="item"><i></i>Molido al momento</div>
      </div>
    </div>
    <div id="e2-barra" class="deco"></div>
  </section>

  <section id="e3" class="escena clip" data-start="8.4" data-duration="3.6" style="z-index:3">
    <div id="e3-iris">
      <div class="fondo"></div>
      <div class="marco">
        <p id="e3-kicker" class="kicker">TE ESPERAMOS</p>
        <div id="e3-centro">
          <h2 id="e3-nombre">Brasa</h2>
          <div id="e3-cta">Tu primera taza, hoy</div>
        </div>
        <p id="e3-dato">Calle Lira 240 · todos los días<br>de 8:00 a 20:00</p>
      </div>
      <div id="e3-deco" class="deco"></div>
    </div>
  </section>

</div>
<script>
  const tl = gsap.timeline({ paused: true });

  // Escena 1. El cuadro 0 ya muestra el rótulo y parte de la franja: nunca empieza vacío.
  tl.fromTo("#e1-kicker", { clipPath: "inset(0% 45% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.6, ease: "expo.out" }, 0);
  tl.fromTo("#e1-titulo span", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out", stagger: 0.09 }, 0.45);
  tl.fromTo("#e1-deco", { clipPath: "inset(0% 60% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "power2.inOut" }, 0);
  tl.fromTo("#e1-pie", { opacity: 0, clipPath: "inset(0% 100% 0% 0%)" }, { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power2.inOut" }, 1.0);
  // La taza llega con un resorte suave; el vapor se dibuja (movimiento con sentido, no un "flotar").
  tl.fromTo("#e1-disco", { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: "back.out(1.4)" }, 0.9);
  tl.fromTo("#e1-vapor path", { strokeDashoffset: 160, opacity: 0 }, { strokeDashoffset: 0, opacity: 0.9, duration: 1.4, ease: "power2.out", stagger: 0.15 }, 1.5);

  // Transición 1: la taza crece más allá del cuadro (0.65 s, ease en ambos sentidos);
  // lo que la rodea se desenfoca 15 px y se apaga en 0.3 s.
  tl.to("#e1-mundo", { opacity: 0, filter: "blur(15px)", duration: 0.3, ease: "power2.in" }, 4.0);
  tl.to("#e1-vapor", { opacity: 0, duration: 0.2 }, 4.0);
  tl.to("#e1-disco", { scale: 12, duration: 0.65, ease: "power2.inOut" }, 4.0);

  // Escena 2 (empieza en 4.6 s, ya con el mismo color de la taza). Su rótulo llega con la escena: ningún cuadro queda liso.
  tl.fromTo("#e2-kicker", { y: 40 }, { y: 0, duration: 0.5, ease: "power3.out" }, 4.6);
  const cuenta = { n: 0 };
  tl.fromTo(cuenta, { n: 0 }, { n: 72, duration: 1.2, ease: "expo.out", onUpdate: () => {
    document.getElementById("e2-numero").textContent = Math.round(cuenta.n);
  } }, 4.85);
  tl.fromTo("#e2-cifra", { opacity: 0, scale: 0.9, transformOrigin: "0% 100%" }, { opacity: 1, scale: 1, duration: 0.6, ease: "expo.out" }, 4.85);
  tl.fromTo("#e2-barra", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.7, ease: "expo.out" }, 4.7);
  tl.fromTo("#e2-sub", { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power2.out" }, 5.3);
  tl.fromTo("#e2-lista .item", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.5, ease: "power4.out", stagger: 0.08 }, 5.4);

  // Transición 2: iris que se abre sobre la escena 3.
  tl.fromTo("#e3-iris", { clipPath: "circle(0% at 50% 40%)" }, { clipPath: "circle(80% at 50% 40%)", duration: 0.45, ease: "power3.in" }, 8.4);

  // Escena 3: cierre. La última línea se sostiene al menos 2 s.
  tl.fromTo("#e3-kicker", { opacity: 0 }, { opacity: 1, duration: 0.3 }, 8.8);
  tl.fromTo("#e3-nombre", { opacity: 0, scale: 1.12, filter: "blur(10px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.7, ease: "expo.out" }, 8.85);
  tl.fromTo("#e3-dato", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 9.3);
  tl.fromTo("#e3-cta", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, 9.6);

  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
</script>
</body>
</html>
```

### Ejemplo 2: escenas en archivos con una foto, horizontal, 10 s

Estructura:

```
promo-huerta/
  index.html
  compositions/apertura.html
  compositions/cierre.html
  assets/fotos/huerta.jpg   ← foto aprobada con documentos_imagenes_usar
```

`index.html`:

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<script src="assets/vendor/gsap.min.js"></script>
<style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #10261b; }
  #main { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
  #fondo { position: absolute; inset: 0; background: #10261b; }
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080" data-fps="30">
  <div id="fondo"></div>
  <div id="apertura" data-composition-id="apertura" data-composition-src="compositions/apertura.html"
       data-start="0" data-duration="5.6" data-track-index="1" data-width="1920" data-height="1080" style="z-index:1"></div>
  <div id="cierre" data-composition-id="cierre" data-composition-src="compositions/cierre.html"
       data-start="5.1" data-duration="4.9" data-track-index="2" data-width="1920" data-height="1080" style="z-index:2"></div>
</div>
<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = gsap.timeline({ paused: true });
</script>
</body>
</html>
```

`compositions/apertura.html` (foto revelada con recorte, empuje lento de cámara en un envoltorio, título por palabras, salida más corta que la entrada):

```html
<template>
  <style>
    #root { position: absolute; inset: 0; background: #10261b; color: #f3efe2; font-family: Georgia, "Times New Roman", serif; overflow: hidden; }
    #apertura-foto-marco { position: absolute; top: 0; bottom: 0; left: 998px; right: 0; overflow: hidden; }
    #apertura-foto-mov { position: absolute; inset: 0; }
    #apertura-foto { width: 100%; height: 100%; object-fit: cover; display: block; }
    #apertura-texto { position: absolute; left: 120px; top: 150px; width: 760px; bottom: 150px; display: flex; flex-direction: column; justify-content: space-between; }
    #apertura-kicker { margin: 0; font-family: Arial, sans-serif; font-weight: bold; font-size: 40px; letter-spacing: 8px; color: #c9d97a; }
    #apertura-titulo { margin: 0; font-size: 132px; line-height: 1.2; font-weight: normal; letter-spacing: -3px; }
    #apertura-titulo span { display: inline-block; }
    #apertura-titulo em { font-style: normal; color: #c9d97a; }
    #apertura-dato { margin: 0; padding-top: 28px; border-top: 4px solid #c9d97a; font-family: Arial, sans-serif; font-size: 40px; line-height: 1.35; }
  </style>
  <div id="root" data-composition-id="apertura" data-width="1920" data-height="1080">
    <div id="apertura-foto-marco">
      <div id="apertura-foto-mov">
        <img id="apertura-foto" src="assets/fotos/huerta.jpg" alt="Huerta con hileras de lechugas al amanecer">
      </div>
    </div>
    <div id="apertura-texto">
      <p id="apertura-kicker">HUERTA SUR</p>
      <h1 id="apertura-titulo"><span>Verduras</span> <span>de</span> <span><em>temporada</em></span></h1>
      <p id="apertura-dato">Cosechadas el mismo día<br>que llegan a tu mesa.</p>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    // La foto se revela de arriba abajo con un recorte; el empuje lento va en un envoltorio interior, nunca en la foto.
    tl.fromTo("#apertura-foto-marco", { clipPath: "inset(0% 0% 70% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "expo.out" }, 0);
    tl.fromTo("#apertura-foto-mov", { scale: 1.12 }, { scale: 1.0, duration: 4.8, ease: "power1.out" }, 0);
    // El cuadro 0 ya muestra rótulo y parte de la foto: nunca empieza vacío.
    tl.fromTo("#apertura-kicker", { x: -30 }, { x: 0, duration: 0.6, ease: "expo.out" }, 0);
    tl.fromTo("#apertura-titulo span", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out", stagger: 0.1 }, 0.8);
    tl.fromTo("#apertura-dato", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 1.5);
    // Salida: más corta que la entrada, en un solo gesto. La escena siguiente sube por encima.
    tl.to("#apertura-texto", { opacity: 0, filter: "blur(10px)", duration: 0.25, ease: "power2.in" }, 4.9);
    tl.to("#apertura-foto-mov", { scale: 1.08, duration: 0.5, ease: "power3.in" }, 4.8);
    window.__timelines["apertura"] = tl;
  </script>
</template>
```

`compositions/cierre.html` (toda la escena sube como un solo objeto sobre la foto y después se encienden los detalles):

```html
<template>
  <style>
    #root { position: absolute; inset: 0; color: #f3efe2; font-family: Georgia, "Times New Roman", serif; overflow: hidden; }
    #cierre-mundo { position: absolute; inset: 0; }
    #cierre-panel { position: absolute; inset: 0; background: #10261b; }
    #cierre-contenido { position: absolute; left: 120px; right: 120px; top: 130px; bottom: 130px; display: flex; flex-direction: column; justify-content: space-between; }
    #cierre-titulo { margin: 0; font-size: 104px; line-height: 1.2; font-weight: normal; letter-spacing: -2px; }
    #cierre-pasos { width: 1100px; }
    .cierre-paso { display: flex; align-items: center; gap: 32px; padding: 20px 0; border-top: 3px solid #c9d97a; font-size: 52px; line-height: 1.2; }
    .cierre-paso i { display: block; width: 24px; height: 24px; background: #c9d97a; flex: none; }
    #cierre-pie { display: flex; justify-content: space-between; align-items: center; }
    #cierre-web { font-family: Arial, sans-serif; font-size: 40px; }
    #cierre-cta { font-family: Arial, sans-serif; font-weight: bold; font-size: 40px; color: #10261b; background: #c9d97a; padding: 26px 56px; border-radius: 70px; }
  </style>
  <div id="root" data-composition-id="cierre" data-width="1920" data-height="1080">
    <div id="cierre-mundo">
    <div id="cierre-panel"></div>
    <div id="cierre-contenido">
      <h2 id="cierre-titulo">Tu caja, cada viernes.</h2>
      <div id="cierre-pasos">
        <div class="cierre-paso"><i></i><span>Eliges el tamaño</span></div>
        <div class="cierre-paso"><i></i><span>Cosechamos el jueves</span></div>
        <div class="cierre-paso"><i></i><span>Llega el viernes</span></div>
      </div>
      <div id="cierre-pie">
        <span id="cierre-web">Pedidos por WhatsApp</span>
        <span id="cierre-cta">Pide tu primera caja</span>
      </div>
    </div>
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    // El tiempo de esta escena empieza en 0 cuando su anfitrión empieza (5.1 s del video).
    // Todo el mundo nuevo sube como un solo objeto sobre la foto (0.55 s, llegada con cola larga).
    tl.fromTo("#cierre-mundo", { y: 1080 }, { y: 0, duration: 0.55, ease: "power3.out" }, 0);
    // Ya en su sitio, los detalles se encienden escalonados: el ojo sigue el orden de lectura.
    tl.fromTo("#cierre-titulo", { opacity: 0.25 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0.35);
    tl.fromTo(".cierre-paso", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.5, ease: "power4.out", stagger: 0.08 }, 0.6);
    tl.fromTo("#cierre-cta", { scale: 0.85 }, { scale: 1, duration: 0.6, ease: "back.out(1.4)" }, 1.0);
    window.__timelines["cierre"] = tl;
  </script>
</template>
```

### Ejemplo 3: canvas dibujado desde el tiempo + GSAP, cuadrado, 6 s

Barras que crecen y una línea de tendencia dibujadas en canvas desde el tiempo, grano de papel con azar con semilla, una fuente incluida por la app (`Inter`) y una cifra que cuenta con GSAP. Algo cambia hasta los 3,9 s y el cierre se sostiene 2 s. Las cifras son de ejemplo: si la persona no dio datos, márcalas como ejemplo al entregar.

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,height=1080">
<script src="assets/vendor/gsap.min.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1080px; height: 1080px; overflow: hidden; background: #123c3a; }
  #main { position: relative; width: 1080px; height: 1080px; overflow: hidden; background: #123c3a; color: #f2f5ee; font-family: Inter, Arial, sans-serif; }
  #lienzo { position: absolute; inset: 0; width: 1080px; height: 1080px; }
  #texto { position: absolute; left: 90px; right: 90px; top: 90px; }
  #kicker { margin: 0; font-size: 48px; font-weight: 700; letter-spacing: 6px; color: #ffd166; }
  #titulo { margin: 18px 0 0; font-family: Georgia, "Times New Roman", serif; font-weight: normal; font-size: 84px; line-height: 1.2; letter-spacing: -2px; }
  #total { position: absolute; right: 90px; bottom: 170px; width: 380px; text-align: right; }
  #total b { display: block; font-family: Georgia, "Times New Roman", serif; font-weight: normal; font-size: 120px; line-height: 1.2; }
  #total span { display: block; font-size: 48px; line-height: 1.2; color: #c9d8cf; }
  #nota { position: absolute; left: 90px; top: 960px; margin: 0; font-size: 48px; line-height: 1.2; color: #ffd166; }
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1080" data-fps="30">
  <canvas id="lienzo" width="1080" height="1080"></canvas>
  <div id="texto">
    <p id="kicker">VENTAS 2026</p>
    <h1 id="titulo">Cada trimestre,<br>un poco más.</h1>
  </div>
  <div id="total"><b id="total-num">0 %</b><span>de crecimiento en el año</span></div>
  <p id="nota">El mejor: el cuarto trimestre</p>
</div>
<script>
  // Datos de ejemplo: márcalos como ejemplo si la persona no los entregó.
  const datos = [42, 55, 61, 78];
  const D = 6;
  const lienzo = document.getElementById("lienzo");
  const ctx = lienzo.getContext("2d");

  // Azar con semilla (mulberry32): el mismo grano de papel en cada cuadro y en cada equipo.
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const azar = mulberry32(7);
  const grano = Array.from({ length: 1400 }, () => ({ x: azar() * 1080, y: azar() * 1080, a: 0.03 + azar() * 0.05 }));
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const base = 900, ancho = 100, sep = 30, x0 = 90, alto = 5.2;
  const cima = (i) => ({ x: x0 + i * (ancho + sep) + ancho / 2, y: base - datos[i] * alto });

  // Todo lo que se dibuja sale SOLO de t: así cualquier cuadro se puede pintar por sí solo.
  function dibujar(t) {
    ctx.clearRect(0, 0, 1080, 1080);
    for (const g of grano) { ctx.fillStyle = `rgba(255,255,255,${g.a})`; ctx.fillRect(g.x, g.y, 2, 2); }
    datos.forEach((v, i) => {
      const k = expoOut(clamp((t - 0.6 - i * 0.12) / 0.9));
      const h = v * alto * k;
      ctx.fillStyle = i === datos.length - 1 ? "#ffd166" : "#3f7d73";
      ctx.fillRect(x0 + i * (ancho + sep), base - h, ancho, h);
    });
    // La línea de tendencia se dibuja de la primera a la última barra entre 2,6 y 3,4 s.
    const p = clamp((t - 2.6) / 0.8);
    if (p > 0) {
      const tramos = datos.length - 1, hasta = p * tramos;
      ctx.strokeStyle = "#f2f5ee"; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.beginPath();
      ctx.moveTo(cima(0).x, cima(0).y - 24);
      for (let i = 1; i <= Math.ceil(hasta); i++) {
        const a = cima(i - 1), b = cima(i), f = Math.min(1, hasta - (i - 1));
        ctx.lineTo(a.x + (b.x - a.x) * f, a.y - 24 + (b.y - a.y) * f);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#c9d8cf"; ctx.fillRect(90, base, 490, 3);
  }
  window.addEventListener("hf-seek", (e) => dibujar(e.detail.time));
  dibujar(0);

  const tl = gsap.timeline({ paused: true });
  // El cuadro 0 ya muestra el rótulo y el eje: nunca empieza vacío.
  tl.fromTo("#kicker", { x: -30 }, { x: 0, duration: 0.6, ease: "expo.out" }, 0);
  tl.fromTo("#titulo", { opacity: 0.3, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power3.out" }, 0.1);
  tl.fromTo("#total", { opacity: 0.3, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.6);
  const cifra = { v: 0 };
  tl.fromTo(cifra, { v: 0 }, { v: 86, duration: 1.6, ease: "expo.out", onUpdate: () => {
    document.getElementById("total-num").textContent = Math.round(cifra.v) + " %";
  } }, 0.7);
  tl.fromTo("#nota", { opacity: 0, clipPath: "inset(0% 100% 0% 0%)" }, { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 0.5, ease: "power2.inOut" }, 3.4);
  tl.to({}, { duration: D }, 0);
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
</script>
</body>
</html>
```
