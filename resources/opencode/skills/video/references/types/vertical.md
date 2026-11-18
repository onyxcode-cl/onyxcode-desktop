# Videos verticales y clips para redes (9:16)

Para: reels, historias, TikTok, Shorts, o cuando la persona dice «vertical» o «para el celular». Se hace en `formato: "vertical"` (1080×1920). Un video horizontal no se aplasta dentro: se recompone desde cero.

Este archivo se suma al del tipo de video (promo, explicativo, datos): de allí sale la historia; de aquí, el encuadre y el ritmo.

## La interfaz de la plataforma

La app de la red social dibuja encima del video. En 1080×1920:

| Zona (de arriba abajo) | Qué va ahí                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| 0–200 px               | nada importante (barra de estado y de búsqueda; la revisión de la app avisa bajo 200 px)         |
| 200–1330 px            | **toda** palabra y el producto o sujeto principal                                                |
| 1330–1920 px           | solo textura o decoración (ahí van la descripción, el usuario y los botones de la plataforma)     |
| franja derecha         | sin texto bajo la columna de botones de acción (me gusta, comentar, compartir)                   |

Los anuncios y algunas apps reservan más abajo; si la persona nombra la plataforma y su zona segura es mayor, respétala. A los lados deja al menos 90 px.

## El primer segundo

- El cuadro 0 es la miniatura y el gancho: una cara, el resultado, o una línea fuerte ya en pantalla. Nunca negro, nunca un logo.
- El espectador decide en más o menos un segundo si se queda: el cambio o la pregunta llega en el primer tramo.
- Mucha gente lo ve sin sonido: la imagen carga el gancho sin audio, y si hay voz entregada por la persona, lo que dice va también escrito.

## Composición

- Un sujeto, centrado, apilado en vertical. Los diseños horizontales (paneles lado a lado, gráficos anchos) se reconstruyen como una secuencia vertical: un panel, luego el otro; el gráfico ancho se vuelve barras horizontales apiladas o se recorre con la cámara.
- La letra es más grande que en horizontal: títulos unas **×1,35**, el resto unas ×1,3. Títulos entre el 4 % y el 9 % del alto del cuadro (unos 80–170 px); nada que deba leerse por debajo de 28 px, y el texto de lectura normal en 48 px o más.
- Límite fijo de palabras por línea: unas **5 palabras** (u 8 caracteres chinos) para una frase de impacto. Si no cabe, quita palabras; nunca achiques la letra. Para encajar un texto en un ancho: `window.__hyperframes.fitTextFontSize(texto, { fontFamily, fontWeight, maxWidth })` devuelve `{ fontSize }`; mide una vez antes de armar los tweens, nunca dentro de `onUpdate`.
- Las palabras clave pueden ocupar el 60–90 % del ancho; las líneas calladas, el 2,5–4 % del alto.
- Foto o producto: llena la banda útil (200–1330 px). Una foto horizontal no se mete pequeña con franjas arriba y abajo: se recorta a vertical con `object-fit: cover` y se mueve la cámara (escala y posición en un contenedor) para recorrerla.

## Ritmo

Más rápido que en horizontal:

- tomas de **1–2 s**, un tramo nuevo cada **2–4 s**;
- el desenlace llega antes de que el espectador deslice;
- cada toma tiene movimiento dentro (algo entra, se transforma, la cámara se acerca); un texto aterrizado se queda quieto y el movimiento pasa al elemento siguiente, a la cámara o al fondo;
- las transiciones siguen siendo causadas por algo en pantalla (barrido vertical de 0,13–0,3 s, inundación de color de ~0,4 s, el objeto que crece hasta volverse la escena siguiente).

Un bucle que corta del último cuadro al primero es una decisión, no un valor por defecto: hazlo solo si la persona lo pide o el clip lo necesita.

## Revisión con `video_cuadros`

- Pide un cuadro en 0 s (miniatura y gancho) además de los del medio y el final.
- En cada cuadro comprueba: nada de texto por encima de 200 px ni por debajo de 1330 px, nada bajo la franja derecha de botones, nada cortado ni encimado, letra legible.

## Señales de video genérico (no hagas esto)

- Un video horizontal encogido con franjas negras o borrosas arriba y abajo.
- El primer cuadro negro o con el logo solo.
- Texto chico pegado al borde inferior, donde lo tapan la descripción y los botones.
- Dos columnas lado a lado.
- Una sola toma quieta de 6 s con texto encima.
