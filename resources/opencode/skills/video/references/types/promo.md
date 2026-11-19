# Promo, lanzamiento y video de una función

Para: «hazme un video promocional», «un video para lanzar X», «muestra esta función», «un anuncio de mi negocio».

La forma es: gancho → tensión → revelación → prueba → desenlace → frase → cierre. Lo que la gente comparte es lo real: personas reales y resultados reales. En los videos oficiales de HyperFrames, las piezas llenas de efectos sacaron cerca de una décima parte de las vistas que las piezas armadas sobre un resultado real.

**Sin pausas:** decide tú la historia y hazla. No propongas tres versiones ni esperes aprobación. Pregunta solo si el pedido es ambiguo de verdad (por ejemplo, no se sabe qué producto o negocio es).

## Duración y tiempos

- Un lanzamiento suele durar 20–45 s. Si la persona da una duración, es un rango: nunca rellenes para llegar a ella. Si no da ninguna, usa la duración por defecto de la skill y escala los tiempos.
- Reparto típico (porcentaje de la duración):

| Tramo       | Parte | Qué hace                                                                                      |
| ----------- | ----- | --------------------------------------------------------------------------------------------- |
| Gancho      | ~8 %  | el mundo y la necesidad, o el producto ya funcionando                                         |
| Tensión     | ~12 % | la forma antigua fallando en pantalla (la espera, el muro de texto, el resultado malo), o una broma |
| Revelación  | ~8 %  | el producto o la idea nombrada como título, hacia el 20–30 % del video                        |
| Prueba      | ~40 % | la tarea real como 3–6 verbos (*pegar, elegir, ver cómo se arma, enviar*), uno por tramo      |
| Desenlace   | ~20 % | llega el resultado, ya en movimiento: el momento visual más grande, una sola vez, al 60–80 %  |
| Frase       | ~8 %  | la única idea, en una línea                                                                   |
| Cierre      | ~8 %  | la marca entra, el nombre y la llamada a la acción aterrizan y se quedan 2–3 s                |

- Ejemplo a 30 s: gancho 0–2,5 · tensión 2,5–6 · revelación 6–8,5 · prueba 8,5–20 · desenlace 20–25 · frase 25–27,5 · cierre 27,5–30.
- Ejemplo a 15 s: gancho 0–1,5 · tensión 1,5–3 · revelación 3–4,5 · prueba 4,5–9 · desenlace 9–12 · cierre con frase 12–15.
- Los dos primeros segundos son los más densos del video. El cuadro 0 es la miniatura: nunca negro, nunca solo un logo.
- El proceso corre rápido; el desenlace se ve a velocidad normal. Antes del desenlace, una pausa de 0,3–0,75 s.
- En cada tramo de verbo deja solo lo que toca el cursor y lo que prueba la frase; borra el resto de la pantalla.

## Lo real, nunca una maqueta inventada

Todo lo que dice ser el producto es el producto. Un botón inventado hace perder a todos los que lo usan.

1. **De dónde sale, de mejor a peor:** las fotos, capturas o grabaciones que entrega la persona; los textos, precios y nombres que la persona dio o que están en sus archivos (página, documentos, código del producto) para confirmar las etiquetas de hoy; fotos buscadas y aprobadas con `documentos_imagenes_buscar` → `_ver` → `_usar` (de cualquier licencia) cuando el video necesita una foto real del tema (un pan, una calle, una oficina) y la persona no dio ninguna.
2. **Falta una pantalla del producto:** pon un marcador claramente rotulado («Captura: Ajustes → Movimiento») y dilo en la respuesta. Nunca un panel o tablero inventado.
3. **Algo que no se ve** (velocidad, una API, un servicio): muestra la interfaz real que lo expone, una analogía real que el espectador conozca, una salida real de terminal o una lista de hechos reales. Nunca un tablero hecho de memoria.
4. **Logo, íconos y fuentes** son los archivos de la marca que entregó la persona. Nunca los redibujes de memoria ni pongas un cuadrado de color en lugar del ícono de una app. Sin logo entregado, el cierre usa el nombre escrito como marca de texto, no un logo inventado.
5. **Fotos:** para comida, local o producto real, busca antes de componer aunque no pidan fotos. Una foto genérica de pan, empanadas o café sirve como imagen del tema; no exige coincidir con el negocio exacto. No la presentes como foto del local propio. Sin URLs en la composición; la foto aprobada entra con `fotos` de `video_cuadros` como archivo local (por ejemplo `assets/fotos/pan.jpg`). Si no se puede incorporar, dilo y sigue sin ella; no la reemplaces por un dibujo sin avisar. Sin créditos ni pies de foto automáticos.

## El producto en pantalla

Las capturas establecen qué es real; no son una lista de tomas. Una promo puede reordenar piezas verificadas para explicar un resultado. No sustituyas «mostrar lo que hace el producto» por una serie de capturas a página completa con títulos encima.

Planifica la relación entre el producto y sus partes:

1. **Ubica el espacio de trabajo.** Muestra lo suficiente de la navegación y la interfaz real para situar la tarea. La vista completa da contexto; no hace falta que se lea cada control.
2. **Aísla la acción.** Trae al frente el gráfico, campo o resultado que importa. Conserva sus etiquetas, valores y estado reales; reconstruye solo la pieza que usa el tramo y muéstrala a **1,6–2× su tamaño real**. El texto queda en **al menos 26 px a 1080p** después de cualquier acercamiento. Nunca una ventanita en medio de un lienzo vacío; nunca la interfaz inclinada en 3D. Deja que un trazo se dibuje, un resultado se llene o un panel se abra antes de avanzar. Mover la cámara sobre una captura congelada no es el producto haciendo algo.
3. **Devuelve el resultado.** Lleva el mismo componente de vuelta a su lugar en la interfaz, o aléjate para mostrar dónde se usa. Si el resultado se reproduce dentro del producto, aléjate hasta mostrar su reproductor o entra por el reproductor hasta que el resultado llene el cuadro. Un video hecho solo de primeros planos flotantes pierde el sistema al que pertenecen. No insinúes que un componente reordenado es una interacción que el producto realmente tiene.

Deja una explicación corta donde la acción la necesite: una frase que nombre el cambio, la etiqueta relevante o el significado de un número. «Menos texto» no significa quitar el contexto necesario para entender la prueba. Revela los elementos de apoyo a lo largo del tramo, en vez de mostrarlo todo al inicio y alargar la espera. Revisa los cuadros intermedios de cada transición, no solo los extremos: etiquetas y valores que viajan no deben saltar ni quedar tapados al volver a su sitio (pide a `video_cuadros` segundos en medio de la transición).

**Cambio de fondo o paleta:** actualiza a la vez la raíz, las superficies de cada escena y los tweens de color de la timeline; un tween posterior puede devolver el fondo antiguo. Ajusta texto, trazos de gráficos y ejes para que contrasten con el fondo nuevo, y revisa cuadros de cada escena y transición afectada. Conserva los colores de estado que significan algo en el producto (verde = listo, rojo = error).

### Cámara, contenedores y cursor (productos con pantalla)

- La cámara alterna entre tres encuadres: la ventana sobre su fondo, un panel, y un acercamiento a un control. Los movimientos duran **0,4–0,6 s** con desenfoque de movimiento, llegan al control que el cursor necesita y luego se quedan quietos mientras la interfaz actúa. Una toma de demo puede mantener un encuadre 7–10 s mientras la interfaz trabaja.
- La cámara se hace moviendo `scale` y `x`/`y` de un contenedor que envuelve la escena, nunca del elemento de medio con tiempo propio.
- Desenfoque de movimiento: en un movimiento rápido (0,3–0,6 s), anima `filter: blur()` con la misma curva del movimiento, con el máximo en el cuadro más rápido: 6–12 px en elementos del tamaño de un texto, 15–20 px a cuadro completo, solo horizontal en un movimiento horizontal.
- Los contenedores se transforman en vez de cortar: el botón se convierte en el menú, el mensaje se convierte en la burbuja.
- El cursor es grande (**4–7 % del cuadro**), entra desde fuera del cuadro, y su clic causa lo siguiente en ese mismo cuadro. Sin anillos de clic.

### Negocios sin pantalla (tienda, restaurante, servicio)

La misma regla con otras piezas reales: las fotos del lugar o del producto (de la persona o buscadas y aprobadas), el precio, el horario, la dirección que dio la persona. La «prueba» son 3–6 verbos de lo que vive el cliente (*entrar, elegir, probar, llevar*), cada uno con su imagen o forma en movimiento. Un acercamiento lento sobre una foto es aceptable dentro de una escena (paneo o «Ken Burns» sobre un contenedor), pero no reemplaza a la historia: cada escena necesita algo que cambie.

## Mundos y transiciones

Un video visita varios mundos, cada uno con su fondo, luz y escala (el escritorio, el producto sobre un degradado de marca, un vacío blanco con un personaje, una foto real), nunca un único lienzo oscuro con interfaz pequeña flotando. Entra a cada mundo a través de un objeto que ya está en pantalla: lo que se toca se convierte en la toma siguiente. Mantén un escenario base al que volver, un «portador» que el ojo sigue, y la paleta y la tipografía constantes entre mundos.

Usa **3–5 tipos de transición** en el video, cada una causada por algo en pantalla. Los cortos secos van dentro de una escena (acercamientos); como mucho un tercio de las uniones entre tramos son cortes secos, y los mundos nunca se funden uno en otro con un simple fundido cruzado. Medidas de los videos oficiales:

| Transición                 | Cómo se arma                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom a través de un botón  | la cámara va al botón con desenfoque (0,6 s); luego el botón escala de ~8 % a ~250 % del cuadro en 0,35 s, con ease-in fuerte; su relleno se vuelve el cuadro siguiente |
| El objeto se vuelve mundo  | una píldora o tarjeta crece más allá del cuadro en 0,65 s, ease-in-out, con su radio encogiendo; lo de alrededor se desenfoca ~15 px y se desvanece en 0,3 s; el contenido nuevo aparece mientras aún crece |
| Transformación (morph)     | un contenedor se ensancha en el siguiente (tarjeta de ícono → caja de texto, ~110 → ~880 px en 0,2 s `power3.out`) con desenfoque horizontal 12 → 0                     |
| Llevar a través            | el resultado se encoge 1 → 0,6 con desenfoque que llega a 6 px a mitad del movimiento, y aterriza dentro de la app siguiente mientras esta se arma alrededor           |
| Inundación de color        | el objeto principal se queda mientras todo el fondo cambia de color en ~0,4 s `power2.inOut`                                                                          |
| Barrido (whip)             | una estela horizontal o vertical de 0,13–0,3 s; el elemento que llega aterriza desenfocado y se enfoca en ~0,13 s                                                     |
| Iris desde el clic         | `clip-path: circle()` se abre desde el punto clicado hacia el mundo siguiente en 0,15 s                                                                               |
| Corte con caída            | el cuadro saliente se oscurece ~40 % durante 3 cuadros antes de un corte seco, para que el corte se lea intencional                                                   |
| Cambio con desenfoque      | sale: opacidad → 0 con ~8 px de desenfoque en 0,13–0,2 s; entra: desenfoque → 0 en 0,13 s; el fondo nunca corta                                                       |

Corta en el cuadro más rápido de un movimiento, con la misma dirección y velocidad a ambos lados. Si una unión tiene la curva desparejada, refléjala: `power3.in` al salir, `power3.out` al entrar.

## Texto en pantalla

- Títulos de máximo 6 palabras por línea, una línea en pantalla a la vez, sin punto final. Una línea se queda unos **0,5 s + 0,3 s por palabra**; la última, al menos 2 s.
- La primera línea nunca es «Presentamos», «Conoce» ni el logo; después del dolor, «Presentamos X» sí sirve. Nunca «desbloquea», «sin fricción», «potencia al máximo», «revolucionario», «sin esfuerzo» ni «en segundos» (salvo que esté medido).
- Lee las líneas solas: un desconocido entiende la propuesta. Mira las imágenes solas: cuentan la misma historia.
- Cifras solo reales, de la fuente o de la persona.
- El color de acento se raciona: una palabra destacada, el desenlace, el cierre.

## El cierre

La marca aterriza en el **último 5–10 %** del video, centrada; el conjunto logo + nombre ocupa el **15–30 % del ancho** del cuadro. Se actúa, no se desvanece: el cursor hace clic en la marca y un relleno sube por dentro, o un personaje la trae, y luego el nombre entra con una cortina (wipe) a su lado. Antes del cierre, la marca solo aparece dentro del producto y de la historia, nunca pegada pequeña en una esquina.

Después, la llamada a la acción (un botón real, la web, la dirección o el comando a escribir, tal como lo dio la persona; nunca inventada), quieta **1,5–3 s**.

## Sonido

Solo el audio que entregue la persona; sin música inventada, descargada ni voces generadas. Si la persona dio una pista, la música es el reloj: el desenlace y la marca caen en sus golpes fuertes; entra en el compás más fuerte de la pista, no en una intro callada, y termina en un final de compás con un fundido corto bajo el cierre. Si sabes el BPM (la persona lo dice), cuadros por pulso = fps × 60 / BPM; calcula cada pulso desde su índice y redondea, nunca sumes un pulso redondeado una y otra vez. Corta en el pulso, cambia la composición en el compás. Sin audio entregado, el video va mudo y los títulos grandes y el propio texto del producto cargan las palabras.

## Señales de video genérico (no hagas esto)

- Escribir en una caja de texto como apertura, sin nada más en pantalla (como paso de la historia a los pocos segundos, sí sirve).
- Una lista de funciones como tres tarjetas en fila.
- Un título sobre una captura oscurecida.
- Un tablero inventado.
- El logo pegado en una esquina.
- Todas las escenas entrando igual; todo apareciendo con fundido y subida.
- Respiraciones, flotaciones o pulsos en bucle en títulos e interfaz; títulos que siguen deslizándose o escalando después de aterrizar.
- Un vacío oscuro con cosas pequeñas flotando; brillos y partículas.
