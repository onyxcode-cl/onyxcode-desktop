# Números, gráficos e historias con datos

Para: «un video con nuestros resultados del año», «anima estas cifras», «muestra este gráfico en video», o cualquier tramo de otro video donde aterriza un número.

## Un número a la vez

- Un número se gana con la escena anterior y luego se vuelve físico: una cuenta que se vuelve un horizonte de edificios, un porcentaje que se vuelve una multitud.
- El número es lo más grande en pantalla (las cifras protagonistas pueden ocupar el 60–90 % del ancho).
- Cifras tabulares (`font-variant-numeric: tabular-nums`) para que una cuenta ascendente no tiemble. Una cuenta ascendente dura **1,2–1,6 s** y luego se queda quieta; si hay música entregada por la persona, aterriza en un pulso fuerte o en un corte seco.
- Nunca todas las cifras contando a la vez: una, se queda, luego la siguiente.

Cómo se hace una cuenta ascendente en la composición (en función del tiempo, para que cualquier cuadro se pueda dibujar por separado):

```js
const dato = { v: 0 };
tl.to(dato, {
  v: DATOS.clientes,
  duration: 1.4,
  ease: "expo.out",
  onUpdate: () => { cifra.textContent = Math.round(dato.v).toLocaleString("es-CL"); }
}, 3.2);
```

Mide el diseño una vez antes de armar los tweens; dentro de `onUpdate` solo se escribe el valor.

## Solo datos reales

- Solo datos reales, de la fuente: lo que dio la persona, sus archivos o una fuente que ella nombró. Redondeados igual en todo el video.
- Una línea pequeña en pantalla con la fuente de los datos (por ejemplo «Fuente: ventas 2025 de la empresa»), legible: 28 px o más. Esto es la procedencia de las cifras, no un crédito de foto.
- **Un solo módulo de datos** alimenta todas las cifras del video: un objeto al inicio del script (`const DATOS = {...}`) del que leen todos los textos, barras y cuentas, para que siempre coincidan.
- Si la persona no dio cifras y el video las necesita: hazlo sin cifras, o con cifras marcadas en pantalla como «cifras de ejemplo». Nunca presentes un número inventado como real.

## Gráficos como imágenes

- Construye el gráfico en orden de lectura: el marco y el eje, una línea de referencia, luego los datos dibujándose, luego **una** anotación sobre el punto que importa. Anota sobre la marca misma; sin leyendas.
- Destaca una serie y pon el resto en gris. Un gráfico con una sola cosa que decir la dice en su título.
- El mismo objeto viaja entre tramos: una barra se vuelve el suelo de la escena siguiente, una línea se vuelve el camino que sigue la cámara.
- La cámara puede zambullirse en el único valor que importa, y luego el resto se aparta.

Cómo se hace sin red:

- Los gráficos se dibujan con SVG o con `div` en CSS dentro de la composición; no hay bibliotecas de gráficos descargadas ni CDN. Toda la animación la lleva la timeline de GSAP: barras con `scaleY`/`scaleX` desde 0 (con `transform-origin` en la base), puntos y etiquetas con tweens de posición y opacidad, valores con `onUpdate` como en la cuenta ascendente.
- Una línea que se dibuja: trazo con `pathLength="100"`, `stroke-dasharray="100 120"` y `stroke-dashoffset="110"` (hueco más largo que el trazado), animando `stroke-dashoffset` a 0. No uses trazo = hueco = desfase: deja un punto al final en algunas curvas. `getTotalLength()` puede devolver 0 antes del diseño; dale un valor de respaldo.
- Las barras de un mismo gráfico entran escalonadas 40–80 ms entre sí, con llegada de cola larga (`expo.out` o `power4.out`). La anotación entra después, cuando los datos ya aterrizaron.
- Las etiquetas de valor van con cifras tabulares y en el mismo redondeo que el resto del video.

## Revisión con `video_cuadros`

Pide un segundo a mitad de una cuenta ascendente o de una línea dibujándose, y otro cuando ya aterrizó: en el primero el número debe verse estable de ancho; en el segundo, cada cifra debe coincidir con el módulo de datos y nada debe quedar encimado ni cortado.

## Señales de video genérico (no hagas esto)

- Una cuadrícula de tarjetas de indicadores (KPI).
- Un tablero.
- Un gráfico de torta.
- Todas las cifras contando a la vez.
- Números sin fuente.
