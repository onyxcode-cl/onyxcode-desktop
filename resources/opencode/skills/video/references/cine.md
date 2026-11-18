# Cine: tipografía cinética, lugares reales, sitios web y otras fuentes

Datos medidos en videos terminados para cuando el video sale de una fuente concreta: una frase o un guion, un lugar real, un sitio web, un cambio de código o la música que entregó la persona. La historia va primero (`historia.md`); la forma de cada tipo de video está en `types/`. El oficio del movimiento está en `movimiento.md`, el estilo en `estilo.md` y el sonido en `sonido.md`.

Si te piden un video, hazlo: no propongas varias historias ni esperes aprobación. Pregunta solo si el pedido es ambiguo de verdad (por ejemplo, no se sabe de qué negocio o producto se trata). Lo demás lo decides tú y lo dices en una línea al entregar.

## Texto, guion y ritmo

- Una voz lee unas 2,2 palabras por segundo. Si la persona entrega una voz grabada o un guion para leer, deja cada escena en unas 19 palabras (9 s); como mucho dos escenas pueden llegar a 26 palabras (12 s). Un video de 30 a 90 s lleva unas 155 palabras o menos; un video entero, 400 como máximo. No generes voces: la voz solo existe si la persona la entrega.
- Si la voz dura más que lo que hay en pantalla, lo visual se rellena con movimientos ociosos. Acorta el texto; nunca estires el movimiento.
- Sin voz, el texto en pantalla manda: cada línea que hay que leer se queda unos 0,5 s más 0,3 s por palabra; la última línea del video, al menos 2 s.
- **Todo en pantalla en el primer cuarto de la escena y luego quieto se lee como diapositiva.** Revela cada pieza cuando toca (cuando la voz la nombra, o en su turno), repartidas por la segunda mitad de la escena. Si hay voz, escríbela en frases separadas para tener puntos de entrada.
- Una escena que cuenta algo nunca es «título que entra con fundido + espera + fundido de salida». Si te queda así, vuelve a `movimiento.md` (transiciones con causa).

## Tipografía cinética

Cuando el texto es la imagen (un lema, una frase de marca, un anuncio corto), el tipo carga el argumento: palabras gigantes, campos de color y grillas que cortan a ritmo.

### Cantidades

- 3 a 7 palabras por escena (en chino o japonés, 4 a 12 caracteres). Más que eso ya es un párrafo, no tipografía cinética.
- Una palabra que se debe leer se queda al menos un pulso de la música (si hay música) o unos 0,4 s si es una palabra suelta de capítulo.
- Un mismo tratamiento se pone viejo a los 6 s, más o menos. Para alargar una sección, pon una pausa quieta o un tratamiento nuevo; nunca alargues los tweens.
- Tamaño: título de 4 a 9 % del alto del cuadro, en una o dos líneas; las palabras protagonistas pueden llenar el 60 a 90 % del ancho, contra líneas tranquilas de 2,5 a 4 % del alto. Una sola palabra resaltada con el color de acento, y que ese color signifique algo.
- Un contador (cifra que sube) dura 1,2 a 1,6 s y luego se queda quieto, terminando en un pulso fuerte o en un corte seco. Usa `font-variant-numeric: tabular-nums` para que los dígitos no bailen mientras cuentan.

### Entradas que funcionan (varía dentro del mismo video)

No uses «fundido y sube» para todo. Algunas entradas medidas:

- palabra por palabra: `filter: blur(6px)` → `blur(0px)` y opacidad 0 → 1 en 0,13 s, una palabra cada 0,067 s, sin desplazamiento;
- palabra por palabra de gris claro al color de tinta, una cada 0,07 a 0,1 s, sin moverse de lugar;
- la línea completa entrando desde desenfocada, 8 px → 0 en 0,13 a 0,2 s;
- letra por letra para un nombre, una cada 0,1 s, opacidad 0,3 → 1 con un leve desenfoque;
- una palabra de la frase que rota entre opciones como tragamonedas, unos 0,1 s por opción.

Un título que ya llegó queda **quieto del todo**: el movimiento pasa al siguiente elemento, a la cámara o al fondo. Nada de títulos que siguen escalando, flotando o «respirando» después de llegar. La salida es 40 a 50 % más corta que la entrada: desenfoque y fundido de 0,13 a 0,25 s, palabra por palabra o con el movimiento de la escena.

Para separar palabras, escribe cada palabra en su propio `<span>` en el HTML (con `id` estable y `display:inline-block` si la vas a transformar). No partas el texto con script a mitad de la línea de tiempo. Dentro de una escena usa `fromTo`, no `from`: la escena se vuelve a buscar cada vez que se muestra y `from` guarda su inicio una sola vez.

```js
// Entrada palabra por palabra con desenfoque (tiempos en segundos)
tl.fromTo('#lema .p',
  { opacity: 0, filter: 'blur(6px)' },
  { opacity: 1, filter: 'blur(0px)', duration: 0.13, ease: 'power4.out', stagger: 0.067 },
  0.4);
// Contador que sube y se queda quieto
const n = { v: 0 };
tl.to(n, { v: 1250, duration: 1.4, ease: 'expo.out',
  onUpdate: () => { document.getElementById('cifra').textContent = String(Math.round(n.v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); } }, 2.0);
```

El `onUpdate` del contador solo escribe texto calculado desde el tiempo de la línea de tiempo: no midas el diseño ahí (medir en `onUpdate` produce saltos entre renders).

### Ajustar el tamaño del texto

El español es más largo que el inglés: una palabra protagonista puede no caber. `window.__hyperframes.fitTextFontSize(texto, { fontFamily, fontWeight, maxWidth })` devuelve `{ fontSize, fits }` (detalle en `formato.md`, sección 8); valores de partida: `maxWidth` 1600 en horizontal y 900 en vertical. Si una palabra se agranda para enfatizar, divide `maxWidth` por esa escala. Llámalo una vez al construir, nunca en `onUpdate`, y comprueba el resultado en los cuadros. Nunca centres con `left:50%; transform:translateX(-50%)` (corta en los bordes): usa un contenedor absoluto de ancho completo con `text-align:center`.

### Subrayado tipo resaltador

Un resaltador que se pinta sobre una frase que ocupa varias líneas: anima una propiedad personalizada que controla el `background-size` de una franja, con `box-decoration-break: clone` para que cada línea tenga su tramo.

```css
.resalta {
  --hl: 0%;
  background: linear-gradient(var(--color-acento), var(--color-acento)) no-repeat 0 85% / var(--hl) 38%;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
```

```js
tl.fromTo('#frase .resalta', { '--hl': '0%' }, { '--hl': '100%', duration: 0.6, ease: 'power2.inOut' }, 1.8);
```

### Líneas que se dibujan

- `getTotalLength()` puede devolver 0 antes de que la página termine de distribuirse. Dale una alternativa, o mejor, pon `pathLength="100"` en el trazo y trabaja en esa escala.
- Para esconder una línea de extremos redondeados usa un hueco más largo que el trazo: `stroke-dasharray="100 120"` y `stroke-dashoffset="110"` sobre `pathLength="100"`, y anima `strokeDashoffset` hasta 0. Si usas trazo = hueco = desplazamiento, en algunas curvas queda un punto visible al final.

```html
<svg viewBox="0 0 600 40" width="600" height="40" aria-hidden="true">
  <path id="trazo" d="M5 30 C 150 5, 450 5, 595 25" pathLength="100"
        fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="100 120" stroke-dashoffset="110"/>
</svg>
```

```js
tl.fromTo('#trazo', { strokeDashoffset: 110 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power3.out' }, 2.2);
```

### No hagas esto en tipografía cinética

- Todas las palabras entrando igual, con fundido y subida.
- Títulos que siguen moviéndose después de llegar; bucles de flotar, latir o respirar.
- Más de 7 palabras por escena, o letra más chica que el mínimo del formato.
- Una cifra inventada: si la cifra no es real, no va (o se marca como ejemplo si la persona lo pidió así).
- Escalas lentas que se arrastran sobre un título al final de la escena.

## Lugares reales

Una ciudad, un edificio, una calle, una playa, un local: un lugar real se muestra con **imágenes reales**. Un contorno vectorial (silueta de país, mapa dibujado) se lee como diagrama y pierde el lugar; úsalo solo para bordes, marcas y etiquetas dibujadas encima de la foto.

### De dónde salen las imágenes

1. Las fotos o videos que entregó la persona, primero.
2. Si faltan y el video las necesita, búscalas con `documentos_imagenes_buscar` → `documentos_imagenes_ver` → `documentos_imagenes_usar`, con el mismo flujo de la skill `pdf`: requisitos (sujeto, lugar, detalles obligatorios, exclusiones, orientación del formato) y 2 a 3 consultas; compara la hoja; amplía 1 o 2 candidatas con `ver`; describe qué se ve, qué cumple y qué duda queda; recién entonces `usar` con el id devuelto y `evaluation`. Pide `orientation` según el formato (`vertical` para 1080×1920, `horizontal` para 1920×1080). Como máximo una segunda búsqueda.
3. No deduzcas el lugar solo por la apariencia de la foto: contrasta su ficha. Si la foto no es del lugar pedido, no la presentes como si lo fuera.
4. La foto aprobada entra con `fotos` de `video_cuadros` (`origen`: el id de `documentos_imagenes_usar`; `destino`: `assets/fotos/…`), igual en los tres modos, y se usa como archivo local de la composición. **Nunca pongas una URL en la composición**, ni de la foto, ni de mapas, ni de teselas. Si la foto no se puede incorporar, dilo y sigue sin ella; no la reemplaces por un dibujo sin avisar.

No hay mapas en vivo ni servicios de mapas: necesitan red y cambian entre un render y otro. Si la persona entrega una imagen de mapa o una captura, úsala como foto.

### Movimiento sobre un lugar

- Acercamiento lento (Ken Burns): anima `scale` y `x`/`y` en un envoltorio **dentro** del clip, nunca en el elemento con tiempo ni en la `<img>` con `class="clip"`. Un empuje lento de 1,0 a 1,08 a lo largo de la toma; en música rítmica, un cambio de toma por pulso fuerte.
- Marcas, alfileres, rutas y etiquetas: dibújalos como SVG encima de la foto y anímalos solo mientras la cámara está quieta. Si la cámara se mueve con la marca encima, la marca debe ir dentro del mismo envoltorio para moverse con la foto.
- Una ruta entre dos puntos se dibuja con la técnica de líneas que se dibujan (arriba).
- Etiquetas sobre fotos claras: letra sobre un fondo oscuro suave (por ejemplo `rgba(0,0,0,.55)` con bordes redondeados), para que mantenga el contraste.

### Ubicar un punto dentro de una foto

Adivinar a ojo la posición de un punto en una imagen falla por 16 a 24 % del cuadro. Hazlo así:

1. Pon encima de la foto, de forma temporal, una grilla numerada de 9×9 (divs con borde fino y número visible) y pide un cuadro con `video_cuadros` en un segundo donde la foto esté quieta.
2. Lee en qué celda está el punto. Repite con una grilla de 6×6 dentro de esa celda.
3. Coloca la marca y pide otro cuadro para comprobar (queda con un error cercano al 2 %).
4. Quita la grilla antes del render.

Si la foto se mueve (acercamiento), mide en la posición final de la cámara y pon la marca dentro del envoltorio que se mueve.

### No hagas esto con lugares

- Un mapa vectorial genérico en vez de la foto del lugar.
- Créditos o pies de foto en pantalla: no se ponen salvo que la persona los pida.
- Dibujar un edificio, plato o paisaje en lugar de mostrar la foto real, sin avisar.
- URLs de imágenes, mapas o teselas en la composición.

## Sitios web

Cuando el tema del video es un sitio web, lo real es el sitio tal como se ve.

### De dónde salen las piezas

- Las capturas de pantalla que entregue la persona son la mejor fuente. Si el sitio es el proyecto abierto en Code, también sirven sus propios archivos: logos, imágenes, colores y fuentes del código.
- No hay herramienta para capturar sitios desde aquí. Si te falta una pantalla que la escena necesita, pídesela a la persona nombrando qué pantalla; si no la hay, arma la escena con lo que sí es real y dilo al entregar. Nunca inventes una pantalla, un tablero o un botón que diga ser del sitio.
- Un archivo llamado `logo` no prueba que sea el logo: míralo antes de usarlo.

### Mostrar el sitio

- Para mostrar el sitio como es, usa sus capturas. Reconstruir la página entera en HTML se aleja del diseño real; reconstruye solo la parte que se mueve (un botón, un contador, un formulario), o pon piezas recortadas encima de la captura en posiciones medidas (con la grilla de arriba).
- Un recorrido bajando por una captura de página completa: la captura a 1× sirve tal cual para un visor de 1920 de ancho. Acercarse más allá de 1:1 necesita una captura a 2× de esa zona, o se ve borroso.
- Después de cualquier acercamiento, el texto del sitio debe medir al menos 26 px en 1080p. Lo que se usa en la escena se muestra a 1,6–2× de su tamaño real, nunca como ventanita en medio de un lienzo vacío, ni inclinada en 3D.
- Muestra el sitio trabajando: un campo que se llena, un resultado que aparece, un panel que se abre. Mover la cámara sobre una captura congelada no es el sitio haciendo algo. Una secuencia de capturas de página completa con un título encima no es un video.
- La cámara alterna entre la página entera (para ubicar), una sección y un acercamiento a un control. Cada movimiento dura 0,4 a 0,6 s y llega al control que importa; después se queda quieta mientras la interfaz actúa.

### Colores y fuentes de la marca

- El azul de enlace `#0000EE` y los rojos y verdes de estado nunca son el acento. El acento es el color que se repite en más funciones del sitio.
- Las fuentes de íconos (Font Awesome, icomoon, webflow-icons) nunca son la fuente de títulos ni de texto. Una monoespaciada del sitio va al rol de código.
- Usa solo los pesos que trae la fuente de la marca; si no, 600 o 700 se dibujan como negrita falsa.
- Si la marca es oscura y el estilo elegido tiene fondo claro, invierte fondo y tinta.
- Fuentes propias: solo con su archivo dentro de la composición (`assets/fonts/`) y un `@font-face` con `src: url('assets/fonts/archivo.woff2')`. Nombra cada archivo por familia, peso y estilo (`marca-700-italic.woff2`), o una normal y una cursiva «Regular» chocan. Si copias la regla `@font-face` del sitio, cópiala completa: los `unicode-range` dicen qué caracteres cubre cada archivo, y copiar solo los archivos pierde eso.
- Nunca una fuente solo con `local('Nombre')`: dibuja la que tenga instalada ese equipo y el video saldría distinto en Mac y en Windows.
- En Chat no se pueden enviar archivos de fuente: usa una de las fuentes incluidas por la app o comunes a Mac y Windows (listas en `formato.md`, sección 8) y dilo al entregar si reemplazaste la fuente de la marca. La composición no tiene red: no se baja ninguna fuente.

## Desde un cambio de código (solo en Code)

Cuando el video cuenta un cambio del proyecto abierto y tienes el historial local:

- Nunca inventes una versión. Usa la versión publicada que corresponda si está en el proyecto; si no, la del `package.json` como «sin publicar»; si tampoco, no pongas versión.
- Largo según el tamaño del cambio (líneas agregadas + quitadas), como tope: hasta ~50 líneas, 20–40 s; 50–200, 40–70 s; 200–600, 70–110 s; más de ~600 líneas o 25+ archivos, hasta 120 s (el máximo de la herramienta).
- Muestra 2 a 4 fragmentos de 4 a 12 líneas. Cifras como +N/−M van en una tarjeta de datos, no en el texto que se lee.
- Si muestras código escribiéndose, calcula caracteres × velocidad y comprueba que cabe en la escena.
- Ignora bots, archivos de bloqueo y `dist/`.

## Con la música de la persona

Solo se usa el audio que la persona entregó. No inventes música, no la descargues y no generes voces.

- La forma más simple es la lista `audio` de `video_render` (`origen`, `inicio`, `desde`, `hasta`, `volumen`, `fundidoEntrada`, `fundidoSalida`), que sirve en los tres modos. En Code y Overdrive también puede ir en un `<audio>` con `id`, sin `crossorigin`, con su archivo local en `assets/audio/`. Los atributos que controlan la mezcla son `data-start` y `data-duration` (cuándo suena y cuánto, en segundos), `data-media-start` (desde qué segundo del archivo empieza: el recorte), `data-volume` (1 = 0 dB, 0 = silencio, hasta 3,98 = +12 dB) y `data-fade-in` / `data-fade-out` (fundidos lineales en segundos). Nunca llames `play()`, `pause()` ni muevas el audio con script.
- `video_render` es quien mezcla el audio en el MP4. Si su respuesta no trae `audio`, el MP4 salió mudo: díselo a la persona; no prometas sonido.
- Fundido de entrada de 0,4 s y de salida de 1,5 s. Si la persona te dijo dónde está la parte fuerte, empieza ahí (`desde` o `data-media-start`); si no lo sabes, empieza en el segundo 0 del archivo: no puedes escucharlo.
- Si la pista es más corta que el video, acorta el video o pon otro `<audio>` del mismo archivo justo a continuación, con fundidos en la unión; no estires nada.
- Sin herramienta de pulsos, no inventes un metrónomo: usa el BPM o los momentos que dé la persona. Si no los da, no sincronices al golpe y dilo. Un movimiento que debe caer en un golpe empieza 40 a 190 ms antes; una reacción empieza 0 a 45 ms después. El golpe mismo es un `tl.set` (0 ms): suavizarlo lo mata.
- Las escenas cubren la pista sin huecos.
- En secciones rítmicas, un clip o cambio de toma por pulso fuerte; en las tranquilas, un empuje lento de 1,0 a 1,08.
