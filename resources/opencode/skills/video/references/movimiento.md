# Movimiento

Lee esta guía antes de escribir la timeline de cualquier video. Su objetivo: que el video se **mueva de verdad** y no parezca una serie de diapositivas que aparecen y desaparecen con un fundido.

Los números de abajo se midieron cuadro a cuadro en los videos oficiales de HyperFrames. Son valores por defecto: si la persona dio una referencia, o un momento del video hace otra cosa a propósito, eso manda en ese momento.

Todo se anima con GSAP en la timeline pausada (`window.__timelines.main`, o la clave de cada escena). Los tiempos van en **segundos**.

## Oficio del movimiento

### Movimientos rápidos
- Un movimiento rápido dura **0,3–0,6 s**. Un movimiento es **un solo tween**, no varios encadenados que se detienen.
- Lleva desenfoque de movimiento sobre su propio ease, con el máximo en su cuadro más rápido:
  - **6–12 px** en elementos del tamaño de un texto;
  - **15–20 px** si se mueve todo el cuadro;
  - en un movimiento horizontal, desenfoque solo horizontal.
- Forma manual, que sirve siempre: tweenea `filter: "blur(…px)"` junto con el desplazamiento (sube a mitad del movimiento y vuelve a 0 al llegar).

### Desenfoque automático del motor (opcional)
- `data-motion-blur="on"` en la raíz de la composición hace que el motor manche los elementos 2D rápidos a lo largo de su recorrido real, en los cuadros y en el render. Viene apagado.
- `data-motion-blur-shutter` alarga la mancha: ángulo de 0 a 720, por defecto 240; **360 ya es fuerte**.
- `data-motion-blur-events="on"` solo si el movimiento se calcula desde una función de la timeline (por ejemplo un `onUpdate` que redibuja la escena según el tiempo).
- `data-motion-blur="off"` en un subárbol lo excluye, por ejemplo una costura que ya trae su propio desenfoque.
- Úsalo cuando la persona pida desenfoque o «aspecto de cine» y el video se mueva rápido. Los giros y zooms solo se suavizan, no dejan estela.
- Deja el modo por defecto (sin `data-motion-blur-tier`). No uses `capture`: necesita funciones del navegador que no se pueden asumir.
- Cuesta tiempo de render (en un video con 77 elementos en movimiento, casi 3 veces más CPU). Ojo con lo que rompe: contenido `::before`/`::after` fuera de la caja del elemento queda cortado, el `clip-path` o la máscara propia del elemento pierden suavidad en el borde, y un selector `:last-child` puede tocar el `<svg>` que el motor agrega a la raíz.
- Después de activarlo, pide cuadros con `video_cuadros` en medio de los movimientos y revisa los avisos.

### Llegar lento, salir limpio
- Las llegadas usan ease-out de cola larga: **aterrizar dura más que irse**.
- Una salida es **un solo movimiento suave**, nunca «deslizar, parar y luego irse».
- Las entradas demasiado secas se leen como errores. Si todo se siente atropellado, alargar el video completo cerca de 1 s suele arreglarlo.

### Ease según el papel
| Papel | Ease |
|---|---|
| Llegada (aterriza en cola larga) | `expo.out`, `power4.out` |
| Movimiento de cámara, inundación de color | `power2.inOut` |
| Zoom a través de algo, salida (acelera) | `power3.in` |
| Rotación, barra de progreso, velocidad constante que es el punto | `none` (lineal) |

El mismo `power2.out` de 0,5 s en todo es el valor plano que hace que un video se sienta generado por máquina. **No lo uses para todo.**

### Resortes
- Se nombran por su amortiguación: **1,0** nunca rebota; **0,7–0,85** se ve premium; **0,4–0,6** juguetón; **menos de 0,3** dibujo animado.
- Posición y tamaño pueden rebotar; **opacidad y color nunca**.
- Los más cercanos que trae GSAP: `elastic.out(1, 0.5)` y `back.out(1.4)`.
- Un resorte escrito como fórmula cerrada del tiempo `t` (una función que GSAP recibe como `ease`) mantiene cualquier cuadro dibujable por sí solo. Nada de simulaciones paso a paso.

### Salidas, solapes y escalonado
- Las **salidas duran 40–50 % menos** que sus entradas.
- **Solape:** el siguiente elemento empieza cuando el anterior va al **30–50 %**. Todo en fila se ve robótico; todo a la vez se ve barato.
- **Escalonado (stagger):** letras a **1 cuadro** (0,033 s) de distancia; palabras **60–120 ms**; elementos de lista **40–80 ms**.

### Rejilla de pulsos (solo si hay música que entregó la persona)
- Cuadros por pulso = fps × 60 / BPM.
- Calcula cada pulso desde su índice y redondea ese resultado; **nunca sumes un pulso ya redondeado una y otra vez** (a 128 BPM y 30 fps eso se corre 2 cuadros en 32 pulsos).
- Corta en el pulso; cambia el diseño en el compás.
- No inventes BPM de una pista que no tienes: si la persona no lo da, no sincronices al pulso.

### Cortes
- Corta en el **cuadro más rápido** de un movimiento, con la misma dirección y velocidad a ambos lados.
- Un clic hacia una pantalla nueva es un corte por coincidencia en el rebote del clic; la pantalla nueva entra un poco grande y se asienta.

### Títulos
- Un título que ya llegó queda **quieto del todo**. El movimiento pasa al siguiente elemento, a la cámara o al mundo detrás.
- **Varía la entrada dentro del mismo video**; nunca «aparece y sube» para cada título. Opciones medidas:
  - por palabra: `blur(6px)` → 0 y opacidad 0 → 1 en **0,13 s**, palabras a **0,067 s** de distancia, sin desplazamiento;
  - por palabra, de gris claro al color de tinta, **0,07–0,1 s** de distancia, sin cambiar de posición;
  - la línea entera desenfocada que se enfoca, **8 px → 0 en 0,13–0,2 s**;
  - por letra, para un nombre: **0,1 s** de distancia, opacidad 0,3 → 1 con un leve desenfoque;
  - detrás del sujeto: el título entre la foto de fondo y un recorte de la persona u objeto (solo si tienes ese recorte como imagen aparte);
  - una palabra de la frase que gira entre opciones como tragamonedas, unos **0,1 s** por giro.
- Para animar por palabra o por letra, separa el texto en `<span>` escritos en el HTML. No hay plugins de GSAP disponibles (nada de SplitText).

### Cuánto se sostiene un texto
- Una línea que hay que leer: **0,5 s + 0,3 s por palabra**.
- La última línea del video: **al menos 2 s**.
- Un título de capítulo de una o dos palabras: puede quedar **0,4 s**.
- Luego sale con desenfoque y fundido de **0,13–0,25 s**, palabra por palabra, o con el movimiento de la escena.

### Tamaño de los títulos
- **4–9 % del alto del cuadro**, en una o dos líneas.
- Líneas secundarias al **2,5–4 %**, contra palabras protagonistas que llenan el **60–90 % del ancho**.
- Una sola palabra destacada en el color de acento, y que ese color signifique algo.
- (Respeta además los mínimos de tamaño y márgenes de la skill principal.)

### Ritmo
- Contrasta velocidades.
- Montajes: cortes cada **0,13–0,8 s**.
- Una demostración sostiene un mismo encuadre **7–10 s** mientras la interfaz actúa.
- Planos de **1,8–3 s** de promedio, con movimiento dentro de ellos.
- Sostén **0,3–0,75 s** antes del remate, y el remate va a velocidad normal.

### Movimiento continuo que sí funciona
- La interfaz del producto funcionando (dibujada en HTML), una foto que se recorre lentamente, un personaje que actúa, un mundo que gira.
- Una órbita lenta del fondo: **3–5° por segundo**.

### Lo que delata un video generado (no lo hagas)
- Bucles de respiración, flotación o pulso en títulos e interfaz en lugar de movimiento real.
- Títulos que siguen deslizándose o escalando después de llegar.
- Una escala lenta que se arrastra sobre un título, o un acercamiento lento al final de una escena.
- Rebote en elementos de interfaz.
- Anillos de clic.
- Todas las escenas entrando igual.
- Todos los elementos con fundido y subida.
- Escenas que solo aparecen y desaparecen con fundido: eso es lo que hace que el video parezca diapositivas.

(La pausa y el pequeño exceso de un personaje son actuación, no estos defectos.)

## Transiciones con causa

- Usa **3–5 tipos** en un video, cada una causada por algo que está en pantalla.
- Los cortes secos van **dentro** de una escena (acercamientos bruscos). Como máximo **un tercio** de las costuras entre momentos son cortes secos.
- Dos mundos distintos **nunca** se funden uno en otro con un fundido cruzado.

Medidas en los videos oficiales:

| Transición | Cómo se construye |
|---|---|
| Zoom a través de un botón | la cámara va hacia el botón con desenfoque (0,6 s); luego el botón escala de ~8 % a ~250 % del cuadro en 0,35 s con ease-in fuerte; su relleno se vuelve el cuadro siguiente |
| El objeto se vuelve el mundo | una píldora o tarjeta crece más allá del cuadro en 0,65 s, ease-in-out, mientras su radio de borde se achica; lo que la rodea se desenfoca ~15 px y se desvanece en 0,3 s; el contenido nuevo aparece mientras todavía crece |
| Transformación (morph) | un contenedor se ensancha y se vuelve el siguiente (tarjeta de ícono → caja de texto, ~110 → ~880 px en 0,2 s `power3.out`) con desenfoque horizontal 12 → 0 |
| Llevar al otro lado | el resultado se achica 1 → 0,6 con desenfoque que llega a 6 px a mitad del camino, y aterriza dentro de la escena siguiente mientras esta se arma a su alrededor |
| Inundación de color | el objeto protagonista se queda mientras todo el fondo cambia de color en ~0,4 s `power2.inOut` |
| Barrido (whip) | una mancha horizontal o vertical de 0,13–0,3 s; lo que llega aterriza desenfocado y se enfoca en ~0,13 s |
| Iris desde el clic | `clip-path: circle()` se abre desde el punto del clic hacia el mundo siguiente en 0,15 s |
| Corte con caída | el cuadro saliente se oscurece ~40 % durante 3 cuadros antes de un corte seco, para que el corte se lea intencional |
| Cambio con desenfoque en un mismo escenario | sale: opacidad → 0 con ~8 px de desenfoque en 0,13–0,2 s; entra: desenfoque → 0 en 0,13 s; el fondo nunca se corta |

En una transición, **nunca dejes un cuadro vacío**: el fondo o un objeto protagonista sigue visible mientras el contenido cambia.

## Cuando la persona pide cambios

| La persona dice | Cambio |
|---|---|
| «muy rápido» | lleva cada zoom y paneo al 0,7× de su velocidad; nada más |
| «más rápido» | acelera el contenido y acorta el momento en la misma proporción; los momentos siguientes se adelantan |
| «los títulos se mueven» | que aterricen y queden quietos del todo hasta que salgan |
| «parece presentación de diapositivas» | entra a la escena siguiente a través de un objeto en pantalla; corta un movimiento a mitad de camino |

## El mecanismo correcto

| Pedido | Mecanismo |
|---|---|
| Acercamiento, zoom, paneo, efecto Ken Burns sobre una foto, reencuadre | tweenea `scale` y `x`/`y` en un **contenedor** dentro del elemento, nunca en el elemento con tiempo (`class="clip"`); encadena los estados en una sola timeline |
| Revelar con recorte o máscara | tweenea `clip-path` o una máscara en un contenedor interior |
| Mantener o congelar | sostén el último estado de una escena terminada; no detengas la timeline |

Reglas que evitan saltos:
- Anima transformaciones (`x`, `y`, `scale`, `rotation`) y `opacity`, no `left`/`top`/`width`/`height`.
- El primer tween de cada propiedad de un elemento es `fromTo`; los siguientes sobre esa misma propiedad son `tl.to(…)` (como la salida de `#tarjeta` en los ejemplos de abajo). Si repites `fromTo`, su punto de partida se pinta al armar la línea de tiempo y se ve en el cuadro 0.
- No pongas un `transform` de CSS en un elemento que GSAP también transforma: usa un contenedor.
- Nunca tweenees `display`, `visibility` ni `autoAlpha` en un elemento `.clip`: anima un hijo, o su `opacity`.
- Nada de `Date.now()`, `Math.random()` sin semilla, temporizadores, `requestAnimationFrame`, animaciones CSS fuera de las reglas de `formato.md` §10 ni `repeat: -1`. Todo lo visible depende solo del tiempo de la timeline.

## Ejemplos cortos

Entrada de título por palabra (desenfoque, sin desplazamiento):

```html
<h1 id="titulo"><span class="p">Pan</span> <span class="p">recién</span> <span class="p">hecho</span></h1>
```
```js
tl.fromTo('#titulo .p', {opacity:0, filter:'blur(6px)'},
  {opacity:1, filter:'blur(0px)', duration:0.13, stagger:0.067, ease:'power2.out'}, 0.4);
```

Llegada con cola larga y salida más corta, de un solo movimiento:

```js
tl.fromTo('#tarjeta', {x:-260, filter:'blur(10px)'},
  {x:0, filter:'blur(0px)', duration:0.6, ease:'expo.out'}, 1.2);
tl.to('#tarjeta', {x:420, filter:'blur(10px)', opacity:0, duration:0.32, ease:'power3.in'}, 4.6);
```

Recorrido lento de una foto (Ken Burns) en el contenedor, no en el `.clip`:

```js
tl.fromTo('#foto-marco', {scale:1.0, x:0}, {scale:1.12, x:-40, duration:5, ease:'power2.inOut'}, 0);
```

Son ilustraciones de los números de arriba: adapta selectores, tiempos y valores al pedido.

## Ver el movimiento

Tienes `video_cuadros`: de 1 a 6 instantes por llamada (`segundos`), en imágenes a mitad de tamaño, más los avisos automáticos de la herramienta (con segundo y elemento). Úsalo así para revisar el movimiento:

- **Estado general:** instantes repartidos por todo el video (por ejemplo D/6, D/2 y 5D/6).
- **Un movimiento:** varios instantes dentro de él (inicio, mitad, final). Así ves si el desenfoque llega a su máximo a mitad de camino y si el elemento aterriza donde debe.
- **Una costura:** un instante justo antes y otro justo después del cambio. Si los estados no coinciden, hay un salto.
- **Un título:** un instante al llegar y otro un segundo después; debe verse idéntico (quieto).
- **Contra cuadros vacíos:** instantes en medio de cada transición; siempre debe haber contenido visible.

Las imágenes son muestras, no el video completo. No afirmes que «todo se mueve bien» si no lo viste en los cuadros.

## Fallas comunes

| Síntoma | Causa habitual |
|---|---|
| Escena en blanco o congelada | la timeline se registró antes de que terminara de construirse la escena; `visibility` tweeneado en un `.clip`; o el id de la escena no coincide con la clave de su timeline en `window.__timelines` |
| Tirones o diferencias entre renders | medidas de diseño tomadas dentro de `onUpdate`, `requestAnimationFrame` o con el reloj; dos timelines animando la misma propiedad |
| El cuadro 0 muestra el color de fondo de otra escena, o un texto de salida encimado sobre el de entrada | un segundo `fromTo` sobre la misma propiedad del mismo elemento: cámbialo por `tl.to(…)` |
| Salto en un corte | los estados saliente y entrante difieren en la costura: pide un cuadro justo antes y otro justo después |
| El ease se ve raro en el traspaso | las velocidades no coinciden en la costura: refleja el ease (`power3.in` al salir, `power3.out` al entrar) |
