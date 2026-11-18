# Tarjetas sobre un video de una persona hablando

Tarjetas diseñadas, rótulos inferiores (lower thirds) y pantallas divididas sobre un video donde alguien habla a cámara. Solo aplica cuando **la persona entregó ese video**: no hay presentadores, avatares ni voces generadas. Las medidas son para 1920×1080 (horizontal) y 1080×1920 (vertical); para 1080×1080 escala desde la más cercana y compruébalo en los cuadros.

El video de la persona entra como archivo local de la composición (en `assets/video/`), nunca como URL. Eso solo se puede en Code y Overdrive: en Chat las herramientas no aceptan archivos de video. En Chat dilo y haz la versión de tarjetas sobre fondo propio.

## Dónde va el video

| Diseño                         | Horizontal (x, y, ancho×alto) | Vertical (x, y, ancho×alto) |
| ------------------------------ | ----------------------------- | --------------------------- |
| Dividido, video junto a tarjeta | 960, 0, 960×1080             | 0, 960, 1080×960            |
| Apilado, video arriba          | 14, 14, 1892×548              | 0, 0, 1080×844              |
| Superpuesto                    | cuadro completo               | cuadro completo             |

Imagen dentro de imagen, a 28 px de los bordes (abajo a la derecha: y = alto del cuadro − alto − 28):

| Lienzo     | Video fuente | Rectángulo        |
| ---------- | ------------ | ----------------- |
| Horizontal | 16:9         | 1432, 28, 460×258 |
| Horizontal | 9:16         | 1644, 28, 248×440 |
| Vertical   | 16:9         | 690, 28, 360×203  |
| Vertical   | 9:16         | 738, 28, 312×555  |

- Zonas para tarjetas: un rótulo inferior ocupa el 30 % de abajo; un panel lateral, el 42 % derecho (horizontal) o el 40 % de abajo (vertical). Lugares para tarjetas de vidrio: 48, 460, 660×540 en horizontal; 24, 1280, 1032×564 en vertical.
- En vertical, la letra es la de horizontal × 1,3 (títulos × 1,35, cifras × 1,4); el relleno interno baja de 40–64 px a 24–36 px.
- Ajusta cada rectángulo a la proporción de su fuente: `object-fit: cover` recorta un video vertical metido en una caja horizontal.
- Nunca pongas una tarjeta encima de la cara de quien habla. El contenido va dentro del 90 % central del cuadro y el texto clave dentro del 80 %.

## Tiempos

- Las tarjetas entran con un fundido de 0,4 s (`power2.out`) y salen en 0,35 s (`power2.in`).
- Reencuadra el video (0,5–0,7 s) solo en un hueco entre tarjetas. Muévelo con transformaciones en un envoltorio, no con `left`, `top`, `width` ni `height`, y nunca transformes el `<video>` con tiempo propio: el tiempo va en el `<video>` y el movimiento en el envoltorio.
- Una tarjeta quieta se muere a los 8 s; pasados los 15 s necesita revelarse por partes. Densidad de partida: una tarjeta cada 6–8 s en videos de menos de un minuto, cada 8–12 s hasta 3 min (el máximo de la herramienta es 120 s).
- Las tarjetas siguen lo que se dice. Sin transcripción con tiempos, usa los momentos que indique la persona o los que se vean claros en los cuadros; no inventes citas ni tiempos de palabras.
- Ninguna tarjeta ni el `data-duration` de la composición pueden terminar después del final del archivo de video, o el MP4 termina en negro. Si no sabes cuánto dura el archivo, pregúntalo o compruébalo con `video_cuadros` cerca del final.

## El video dentro de la composición

- `<video>` con `id`, `class="clip"`, `data-start`, su archivo local, `muted` y `playsinline`. La app no mezcla el sonido propio de un `<video>`: si la voz de quien habla debe oírse, hace falta ese audio como archivo aparte (`.mp3`, `.m4a`, `.wav` o `.aac`) en la lista `audio` de `video_render` o en un `<audio>`, con el mismo inicio y recorte que el video. Si la persona no lo tiene, dile que el MP4 saldrá sin la voz.
- Recorte: `data-media-start` (desde qué segundo del archivo empieza). Sin `data-duration` se reproduce entero.
- Nunca llames `play()`, `pause()` ni muevas el tiempo del video con script. Sin `crossorigin`.
- La voz de la persona es el reloj del video: cada tarjeta cae sobre la palabra que la nombra.

## Errores comunes

- La capa de tarjetas no puede tener fondo opaco a cuadro completo, o tapa a quien habla: rótulos, superposiciones e imagen dentro de imagen van sobre fondo transparente.
- Vidrio sobre video claro queda blanco sobre blanco: pon un velo oscuro detrás (más o menos `rgba(0,0,0,.55)` desvaneciéndose desde arriba, `.72` abajo) y una base de vidrio oscura como `rgba(15,16,22,.78)` con `backdrop-filter: blur(22px)`.
- Más de 3 elementos con tiempo en un solo archivo se vuelve denso y difícil de seguir: cuando la composición tenga carpetas, da a cada capítulo su propia subcomposición en `compositions/`.
- Si en los cuadros el video aparece congelado o en negro donde debería moverse, díselo a la persona: el archivo puede necesitar otra codificación. No intentes arreglarlo por tu cuenta.
- No pongas créditos, nombres ni pies de foto que la persona no pidió. Un rótulo con nombre y cargo solo si ella dio esos datos.
