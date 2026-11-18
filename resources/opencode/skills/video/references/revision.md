# Revisión

Tú escribiste la timeline, así que sabes qué pasa. Quien mira el video lo ve una sola vez, a velocidad normal y muchas veces en un teléfono. Revisar es ver el video como lo verá esa persona: con ojos de director de movimiento exigente, no de autor orgulloso. Los errores de la herramienta te dicen qué está roto; esta revisión te dice qué está débil.

Revisa siempre: en cada video nuevo y en cada cambio que mueva tiempos o posiciones, antes de responder y antes de `video_render`. No pidas permiso para revisar ni para corregir: es parte del trabajo.

## 1. Qué te da la herramienta

`video_cuadros` es tu única forma de ver el video antes del MP4.

- **Argumentos:** `formato` (`vertical`, `cuadrado` u `horizontal`), `segundos` (de 1 a 6 tiempos por llamada, desde 0 y menores que la duración) y `composicion` (ruta relativa del `index.html`). En Code añade `carpeta` con la ruta absoluta del proyecto abierto; en Overdrive y en Chat no la pases. En Chat, en la primera llamada envía `html` (un archivo, hasta 512 KB) o `archivos` (varios textos) en vez de `composicion`; la respuesta trae la `composicion` que debes usar después. Para corregir en Chat, envía esa `composicion` junto con otro `html` completo o con los `archivos` que cambian. Las fotos van en `fotos` (`SKILL.md`, sección Fotos).
- **Respuesta:** un texto JSON con `composicion`, `duracion`, `cuadros` (rutas de los PNG), `hojaContactos`, `avisos`, `cobertura` y `revision` (qué alcanzó a revisar), más las imágenes: tus cuadros a mitad de tamaño (540×960 en vertical, 540×540 en cuadrado, 960×540 en horizontal; más chicos si son muchos) y al final la **hoja de contactos**, con hasta 24 instantes revisados en miniatura y su segundo. Mírala para juzgar el movimiento y los tramos muertos entre tus cuadros.
- **`avisos`:** la herramienta revisa la composición en los tiempos que pediste, **además en 8 tiempos repartidos** por todo el video (D/9, 2D/9 … 8D/9, con D = duración) y, con escenas en `compositions/`, alrededor del inicio y en la mitad de cada escena. Cada aviso empieza con el segundo o el tramo (`"4.17 s: …"`, `"5.1–5.3 s: …"`). Los que empiezan con `Revisión oficial (código):` vienen de la revisión de HyperFrames, en inglés; cuáles son esperables está en `formato.md` §13. Los avisos propios de la app son:

| Aviso | Qué significa | Arreglo habitual |
| --- | --- | --- |
| `el texto "…" se sale de su caja` | El texto desborda su elemento | Acorta la frase, baja un poco el tamaño o da más ancho; nunca `overflow:hidden` para esconderlo |
| `el texto "…" se sale del área segura del lienzo` | En vertical: a menos de 90 px de los lados o de 200 px arriba/abajo. En cuadrado y horizontal: a menos de 54 px del borde | Mueve o reduce el bloque; en vertical esa franja la tapan los controles de las redes |
| `el texto "…" queda recortado por su contenedor` | Un padre con `overflow` lo corta | Agranda el contenedor o cambia el recorte. Si es una máscara a propósito (texto que entra desde un recorte), confirma que al terminar el movimiento queda entero |
| `el texto "…" queda tapado por otro elemento` | Una forma, foto u otro texto lo cubre | Separa capas, cambia `z-index` o el momento en que se cruzan |
| `el contenido ocupa solo el N % del lienzo; revisa el espacio vacío` | Texto y formas visibles ocupan menos del 60 % del cuadro | Agranda el sujeto, acerca la cámara, usa todo el lienzo. Puede ser correcto en una entrada o salida breve |
| `cuadro casi vacío: sin texto visible y con poca variación de color` | Un cuadro liso, sin nada | Casi siempre es un hueco entre escenas: cruza las escenas para que siempre haya algo visible |

- **`cobertura`:** lista de `{segundo, proporcion}` en cada tiempo revisado (0 a 1). Una caída brusca a mitad del video suele ser un hueco o una escena demasiado vacía.
- Los avisos son geometría medida, no gusto: no ven si un movimiento es aburrido, si una palabra dura poco o si la foto es la adecuada. Eso lo ves tú en las imágenes.

Cuando los números y tu vista no coinciden, confía en los números: un texto cortado por 4 px o una frase que dura 0,6 s se ven bien en un cuadro suelto.

Un aviso es una pregunta, no una orden: corrígelo o, si lo dejas a propósito (una palabra que entra desde fuera del cuadro y termina dentro, una entrada vacía de 0,3 s), dilo en la nota de entrega con el motivo. Nunca entregues con avisos sin corregir ni explicar.

## 2. Qué cuadros pedir

Seis tiempos por llamada como máximo, así que elige con intención. Una revisión completa suele ser 3 o 4 llamadas:

1. **Los momentos clave (beats).** Cada escena justo después de empezar (inicio + 0,3 s) y en su mitad, más los momentos que cuentan la historia: el gancho, el cambio, el remate y el cierre. Incluye siempre `0` o un tiempo muy cercano: el primer cuadro es la miniatura en muchas redes y nunca debe estar vacío.
2. **Cada corte.** Alrededor de un corte en el segundo C, pide `C-0.2, C-0.1, C, C+0.1, C+0.2`. Así ves si algo salta, si queda un cuadro vacío o si dos escenas chocan en la unión.
3. **El movimiento principal y el remate.** Para ver si un movimiento de verdad se mueve (y cómo), pide 6 tiempos seguidos dentro de ese tramo (por ejemplo cada 0,1–0,15 s). Ahí se ve si la curva arranca y frena bien, si el objeto llega a su sitio, si la trayectoria hace el arco que querías o si todo se mueve a la vez.
4. **El final.** Un cuadro en los últimos 0,5 s: el cierre debe estar entero y quieto lo suficiente para leerse.

Si piensas cambiar solo una parte, después pide solo esa parte.

## 3. Lo que tienes que medir tú

La herramienta no mide tiempos de lectura ni quietud. Revísalo en la composición, con estos números:

- **Tiempo de lectura:** una línea necesita unos `0,3 s por palabra + 0,5 s`; la última línea, al menos 2 s. Una línea de 5 palabras: 2 s en pantalla, ya quieta. Una palabra pensada para leerse dura al menos un tiempo de la música, si la hay.
- **Tramos muertos:** más de 3 s seguidos sin que nada cambie en pantalla es un tramo muerto (salvo los últimos 3 s del video, donde el cierre puede quedarse quieto). Una quietud a propósito vale si la decidiste; dilo en la nota.
- **Tamaño mínimo del texto:** nada que deba leerse por debajo del 2,6 % del lado corto del cuadro (unos 28 px en 1080). Para cuerpo y títulos usa los mínimos de la app: vertical y cuadrado 48/80 px; horizontal 40/72 px.
- **Pantalla de teléfono:** las imágenes que recibes ya están a mitad de tamaño. Si una línea cuesta leerla ahí, en el teléfono también costará.

## 4. Qué buscar en las imágenes

Primero, describe cada cuadro clave en una frase, como lo haría un desconocido, nombrando cada objeto. Si un objeto necesita explicación («esas barras son espejos»), es un problema grave. Luego lee los cuadros clave en orden: ¿cuentan una historia que un desconocido sigue, donde cada uno causa el siguiente? Compara cada uno con lo que planeaste para esa escena; lo que no coincide es una nota. Después nombra cada «recurso por defecto» que se vea (lista de abajo) y corrígelo antes que cualquier otra cosa.

Luego pasa por las imágenes una vez por pregunta:

| Pregunta | Qué detecta |
| --- | --- |
| ¿Se entiende lo que es? | Una forma que parece otro objeto, un material que parece plástico, una pantalla de producto que parece maqueta, una cara o mascota que se ve mal |
| ¿El sujeto se separa del fondo? | Sujeto y fondo con valores parecidos, dos focos en un cuadro, la vista sin saber adónde ir |
| Encuadre y contacto | Recortes, texto en el borde o bajo los controles de las redes, choques en una unión, cosas flotando que deberían apoyarse |
| Tiempo, como quien lo ve por primera vez | Una lectura más corta que sus palabras, algo que aparece de golpe sin movimiento, un salto en un corte, todo moviéndose a la vez con la misma curva |
| Señales de video generado | Cualquier punto de la lista de abajo |
| Solo las imágenes | Tapando los textos, ¿los cuadros clave siguen contando la historia? |
| Fotos | ¿Es la foto aprobada? ¿Está bien recortada, sin deformar, con el sujeto visible? ¿El texto encima se lee? ¿Hay algún crédito o pie de foto que nadie pidió? (Quítalo.) |

### Recursos por defecto (prohibidos salvo que la marca o la referencia de la persona los use)

- un fondo negro o azul marino oscuro y vacío con cositas flotando en el medio;
- brillos, resplandores, neón, destellos de lente, orbes y anillos luminosos; partículas flotando de adorno;
- degradados morados o azules, degradados de malla, tarjetas de vidrio;
- fondo crema o papel con tipografía serif, palabras en cursiva de acento, etiquetas numeradas «01 / 02», etiquetas pequeñas en mayúsculas monoespaciadas, chips y botones en forma de píldora;
- todo centrado; todo apareciendo a la vez; cada elemento entrando con fundido y subida;
- texto que se mueve mientras se lee; títulos que siguen deslizándose o encogiéndose después de llegar;
- etiquetas en las esquinas, marcos, corchetes de esquina, indicadores tipo HUD como adorno;
- tres tarjetas en fila, grillas de indicadores, un título sobre una captura oscurecida;
- el logo fijo en una esquina.

Y para la historia:

- todas las escenas entrando igual, o el mismo movimiento un momento tras otro;
- paneles lado a lado o tarjetas flotando en lugar de una escena;
- loops de «respiración» o flotación en títulos e interfaz en lugar de movimiento real.

Cuando veas uno, nómbralo, reemplázalo por algo que venga del tema, de la marca o del medio, y no lo vuelvas a usar en ese video.

## 5. Notas y arreglos

Escribe cada problema en una línea: `t=4.2s · dónde · problema → cambio exacto · qué se mantiene`. Ordénalos:

- **P0** rompe la lectura o el pedido: ilegible, incorrecto, roto, un cuadro vacío, un recurso por defecto en la escena principal, un aviso sin resolver.
- **P1** debilita el video: un tramo muerto, un remate flojo, una unión que salta.
- **P2** detalles.

Corrige todos los P0 y los P1 que valgan la pena: primero texto, después tiempos, después detalles. Corrige todo junto en una sola edición y luego pide cuadros **solo de lo que cambiaste**, una vez. Haz otra ronda solo si queda un P0 abierto. Como máximo tres rondas de cuadros en total (una completa y dos de corrección); si después de eso algo sigue mal, dilo con claridad y no renderices un video con un hueco o un texto cortado.

- No te pongas nota del 1 al 10: una nota no encuentra nada que arreglar.
- Si un arreglo no funciona, pide los cuadros justo antes y justo después del problema, anota cada diferencia y cambia solo la línea que lo causa.
- Si el video se siente recargado, quita un tercio del movimiento y quédate con los movimientos que guían la vista.
- En Code y Overdrive, antes de un arreglo grande guarda una copia del `index.html` (por ejemplo `index.antes.html` en la misma carpeta) para poder volver atrás si empeora. En Chat, la versión anterior es el `html` que ya enviaste.

## 6. Después del render

`video_render` devuelve `ruta`, `bytes`, `duracion`, tres cuadros de control del MP4 (en D/6, D/2 y 5D/6), otra vez `avisos` y `cobertura`, y `audio` (códec y duración) si el MP4 tiene sonido. Mira los tres cuadros: deben coincidir con lo que revisaste. Si aparece un aviso nuevo o un cuadro distinto de lo esperado, corrígelo o explícalo antes de entregar. Si pasaste audio y la respuesta no trae `audio`, el MP4 salió mudo: dilo. Nunca afirmes que el sonido está bien: no lo escuchaste (ver `sonido.md`).

## 7. La nota de entrega

En la respuesta, en palabras simples para una persona normal (sin P0, sin jerga):

- la línea de entrega: enlace a la ruta del MP4 · duración en segundos · peso calculado desde `bytes` (KB = 1000 bytes, MB = 1 000 000 bytes);
- en una o dos frases, la idea que elegiste para el video;
- qué comprobaste con la herramienta y qué solo miraste; el audio, si lo hay, quedó colocado pero no escuchado;
- lo más débil del video y qué cambiarías con más tiempo, solo si es real;
- los avisos que dejaste a propósito y por qué.

En Code y Overdrive guarda además esa nota como `REVISION.md` en la carpeta de la composición: si la persona pide un cambio después, léela antes de tocar nada. En Chat la nota queda en la conversación.
