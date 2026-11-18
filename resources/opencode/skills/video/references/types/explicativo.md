# Videos explicativos, tutoriales y «cómo funciona»

Para: «explica cómo funciona X», «un video que enseñe…», «un tutorial corto de…».

Una sola idea que el espectador entiende al final. La columna es **un ejemplo concreto resuelto de principio a fin**, no un recorrido de datos sueltos. Suele durar 30–90 s.

**Sin pausas:** elige tú el ejemplo y el recurso que explica, y hazlo. Pregunta solo si no se sabe qué hay que explicar.

## Primero, aterrízalo

Empieza donde el espectador ya está: una persona, un lugar o una situación que conoce, y una pregunta que haría sobre eso («¿por qué la astronauta vuelve más joven que su gemela?»). El recurso abstracto (un reloj de luz, un gráfico, un campo) entra dentro de esa situación, como lo que responde la pregunta, y al final el video vuelve a la persona con la respuesta. Un video que abre solo con el recurso es un diagrama, no una explicación.

## Recursos que explican

- **El objeto es la explicación.** Construye una cosa cuyo funcionamiento es la idea: una máquina, un modelo, un mapa, un reloj de luz, dibujado para que se lea como lo que es (su material, su soporte, dónde está en la escena). Cada número en pantalla sale de él, y la cámara lo recorre: cortes transversales, una vista despiezada, una zambullida en la parte que importa.
- **Un diagrama que crece.** Parte del dibujo verdadero más simple y añade una parte por tramo, cada una apareciendo cuando se nombra. Nunca sueltes un diagrama terminado de golpe.
- **Transformación continua.** Cada paso se transforma desde el anterior (una barra se vuelve un eje, un punto se vuelve una población), para que el espectador nunca pierda el hilo por un corte.
- **El ejemplo resuelto.** Una entrada real (una frase, un número, una foto) viaja por cada paso hasta la respuesta.

Cómo se hace en la composición:

- El objeto y el diagrama se dibujan con SVG o con formas en CSS dentro de la composición, nunca con URLs de imágenes. Una foto real del tema, si hace falta, sale del flujo de fotos (`documentos_imagenes_buscar` → `_ver` → `_usar`) y entra con `fotos` de `video_cuadros` como archivo local, sin crédito ni pie de foto.
- Una línea que se dibuja: oculta un trazo de punta redonda con un hueco más largo que el trazado (`pathLength="100"`, `stroke-dasharray="100 120"`, `stroke-dashoffset="110"`) y anima `stroke-dashoffset` hasta 0. No uses trazo = hueco = desfase: deja un punto al final en algunas curvas. `getTotalLength()` puede devolver 0 antes del diseño; dale un valor de respaldo.
- Un resaltador que cruza varias líneas: anima una propiedad personalizada sobre una banda de `background-size`, con `box-decoration-break: clone`.
- La cámara (acercar, recorrer, entrar en una parte) se hace con `scale` y `x`/`y` sobre un contenedor; los movimientos de cámara usan `power2.inOut`.
- La transformación de un paso al siguiente se arma con tweens del mismo elemento (tamaño, posición, radio, color), no con dos elementos que se cruzan con un fundido.

## Formas de la información

La mayoría de las frases que se pueden explicar tienen una de pocas formas, y cada forma tiene su imagen:

| Forma                                 | Imagen                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| un número que aterriza                | ver `datos.md`                                                      |
| un mito que se da vuelta              | la idea equivocada tachada y la correcta impresa encima             |
| antes y después                       | el mismo cuadro cambiando delante del espectador                    |
| muchas cosas que convergen en pocos grupos | los elementos viajan y se agrupan                              |
| una red que se densifica              | nodos y líneas que se suman                                         |
| uno elegido entre muchos              | todos presentes, uno destacado, el resto se apaga                   |
| pasos en orden                        | un recorrido donde cada paso nace del anterior                      |
| una captura real con el detalle marcado | la captura y un círculo o trazo sobre lo que importa             |
| una cita como afiche                  | la frase grande, compuesta como cartel                              |
| una tarjeta de capítulo               | una o dos palabras, sostenidas 0,4 s                                |

Elige primero la forma y después la imagen, para que frases parecidas tengan imágenes distintas y cada frase tenga la que la muestra.

## Palabras

- **Con voz** (solo si la persona entregó una grabación; nunca voces generadas): la voz es el reloj. Cada parte aparece cuando la voz la nombra, a lo largo de la segunda mitad de la escena. Una escena lleva unas 19 palabras habladas (≈9 s, a ~2,2 palabras por segundo); como mucho dos escenas llegan a 26 palabras (12 s). Si la voz es más larga que lo visual, lo visual se rellena con deriva vacía: recorta el guion, nunca estires el movimiento. La pantalla nunca repite palabra por palabra lo que dice la voz.
- **Sin voz** (lo normal): llevan la explicación líneas grandes de hasta unas 10 palabras, cada una sostenida **0,5 s + 0,3 s por palabra**; la última, al menos 2 s.
- Todo en pantalla en el primer cuarto de la escena y luego congelado se lee como presentación de diapositivas. Revela cada pieza cuando corresponde.
- Las etiquetas van sobre la parte que nombran, con una línea guía si hace falta, y aparecen junto con ella. Sin leyendas, sin diapositivas de viñetas.

## Que esté bien

- Cada afirmación, valor y paso sale de la fuente (lo que dio la persona, sus archivos o un hecho comprobable). Un número que la fuente no dio se deja fuera o se marca en pantalla como ilustrativo.
- Un solo módulo de datos (un objeto en el script) alimenta todas las cifras, para que coincidan entre sí.
- Revisa la ciencia o la lógica de cada paso antes de animarlo: un diagrama hermoso y equivocado es peor que ninguno.
- Termina en la única idea, en una línea. Sin tarjeta de marca al final, salvo que la pidan.

## Revisión con `video_cuadros`

Pide segundos donde el diagrama está a medio crecer y donde ya está completo: en el primero deben verse solo las partes nombradas hasta ahí; en el segundo, ninguna etiqueta encimada ni cortada.

## Señales de video genérico (no hagas esto)

- Una diapositiva de viñetas.
- Íconos dentro de círculos.
- Tres tarjetas en fila.
- El diagrama completo de una vez.
- Una voz que repite palabra por palabra el texto en pantalla.
