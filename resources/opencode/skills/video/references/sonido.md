# Sonido

El sonido es la mitad de cómo se siente un video, y quien lo mira nota un video mudo antes que cualquier cuadro. Pero en esta app hay una regla fija: **el único audio es el que entrega la persona.** No inventes música, no la descargues, no generes voces, no escribas sonido con código (osciladores, tonos, «pitidos»). Nadie puede oír si eso queda bien.

## 1. Cuándo hay sonido

- **La persona entregó audio** (una canción, una locución grabada, efectos) y quiere usarlo en el video: colócalo como dice este archivo.
- **La persona pidió música pero no entregó ningún archivo:** haz el video igual, sin detenerte, y al entregar pídele en una línea el archivo de audio para añadirlo. No busques música por tu cuenta.
- **Nadie habló de sonido:** entrega el video mudo y no ofrezcas música como extra. Un video que se ve sin sonido (un fondo en bucle, un reel que arranca silenciado) lo cuentan el texto grande y las imágenes.
- **Voz:** solo una locución grabada que entregue la persona. Nunca voces generadas.

Si la respuesta de `video_render` no trae `audio`, el MP4 salió mudo: no prometas el sonido, entrega el video, conserva el archivo de la persona tal cual y dilo en una línea.

## 2. Cómo entra el audio

Formatos: `.mp3`, `.m4a`, `.wav` o `.aac`, hasta 32 MB cada uno y 16 pistas en total. `video_render` mezcla todo en el MP4 (AAC, 48 kHz) con un limitador suave; `video_cuadros` no suena. Hay dos formas, que dan lo mismo:

**A. La lista `audio` de `video_render`** (sirve en Chat, Code y Overdrive; en Chat es la única):

```json
"audio": [{ "origen": "cancion.mp3", "inicio": 0, "desde": 12, "hasta": 27, "volumen": 0.8, "fundidoEntrada": 0.4, "fundidoSalida": 1.5 }]
```

| Campo | Qué hace | Equivale a |
| --- | --- | --- |
| `origen` | En Chat, el nombre o id del archivo que adjuntó la persona. En Code y Overdrive, la ruta relativa del archivo en el proyecto o la tarea | `src` |
| `inicio` | Segundo del video en que empieza a sonar (menor que la duración) | `data-start` |
| `desde` | Desde qué segundo del archivo empieza (el recorte de entrada) | `data-media-start` |
| `hasta` | Segundo del archivo donde deja de sonar (no es una duración; mayor que `desde`). Sin él, suena hasta el final del archivo o del video | `data-media-start` + `data-duration` |
| `volumen` | 0 a 3.98; 1 = sin cambio | `data-volume` |
| `fundidoEntrada`, `fundidoSalida` | Segundos de fundido lineal | `data-fade-in`, `data-fade-out` |

Solo `origen` es obligatorio. Lo que pasa del final del video se corta.

**B. Un `<audio>` en la composición** (solo Code y Overdrive, con el archivo copiado dentro de `assets/audio/` de la carpeta de la composición):

```html
<audio id="musica" class="clip" src="assets/audio/musica.mp3"
       data-start="0" data-duration="15" data-media-start="12"
       data-volume="0.8" data-fade-in="0.4" data-fade-out="1.5"></audio>
```

| Atributo | Qué hace |
| --- | --- |
| `id` | Obligatorio (la revisión oficial marca un `<audio>` sin `id`) |
| `src` | Ruta relativa a un archivo local (en `assets/`). Nunca una URL |
| `data-start` | Segundo del video en que empieza a sonar |
| `data-duration` | Cuánto suena, en segundos. Sin él suena el archivo entero |
| `data-media-start` | Desde qué segundo del archivo empieza (el recorte de entrada) |
| `data-volume` | Ganancia: `1` = sin cambio, `0` = silencio, más de `1` sube (hasta `3.98`, +12 dB) |
| `data-fade-in`, `data-fade-out` | Fundidos lineales al inicio y al final del clip, en segundos |

Reglas:

- Usa una sola forma por pista: si el mismo archivo va en la lista `audio` y en un `<audio>`, suena dos veces.
- Sin `crossorigin` en `<audio>` ni `<video>`.
- Nunca llames `play()`, `pause()` ni cambies `currentTime` de un medio: el motor lo controla.
- Con un solo `index.html`, los `<audio>` van dentro del contenedor `data-composition-id="main"`. Con escenas en `compositions/`, la música y la voz van en el `index.html` raíz (el raíz contiene solo los anfitriones de escena, los medios y el audio); los `data-start` de un medio dentro de una escena cuentan desde el inicio de esa escena.
- Un `<video>` de la persona va siempre `muted`: la app no mezcla el sonido propio de un `<video>`. Si la persona quiere ese sonido, pídele el audio como archivo aparte. La música, la voz o un sonido de reemplazo van como audio aparte (forma A o B).
- Conserva siempre el archivo original de la persona sin modificarlo.

## 3. El reloj

- **Con voz:** la voz manda. Haz que cada momento empiece en su palabra clave; el texto aparece en la palabra que lo dice. La pantalla nunca repite palabra por palabra la frase hablada. Tú no puedes escuchar la grabación: si la persona te da el texto con tiempos, úsalos; si no, pídele los segundos de las frases clave o reparte con lo que sepas y dilo en la nota.
- **Solo música:** la música manda. Si la persona te dice el tempo (bpm) o dónde están los golpes, un tiempo dura `60 / bpm` segundos (120 bpm = 0,5 s): pon el remate y la marca sobre tiempos fuertes. Los cortes siguen al movimiento, no a la batería. Si no sabes dónde están los golpes, no los inventes: no sincronices al golpe y dilo.
- Un movimiento que debe caer en un golpe empieza entre 40 y 190 ms antes; una reacción empieza entre 0 y 45 ms después. El golpe mismo es un `tl.set` de 0 ms: suavizar un golpe lo mata.
- Una palabra pensada para leerse dura al menos un tiempo de la música. Cualquier tratamiento se gasta a los ~6 s: alarga una sección con una pausa o un tratamiento nuevo, nunca haciendo más lentos los movimientos.
- Si encaja, deja que el sonido actúe la historia: la parte «de antes» casi en silencio y la música abre cuando aparece el producto, o la música se contiene hasta el remate. Esto solo con volumen, fundidos e inicio (`volumen`/`data-volume`, fundidos, `inicio`/`data-start`): no edites el archivo.

## 4. Música

- Usa el tema de la persona tal como lo dio.
- Entra en la parte más fuerte del tema, no en una introducción tranquila, **si la persona te dijo dónde está** (`desde` o `data-media-start`). Si no lo sabes, empieza en el segundo 0 del archivo; no adivines.
- Fundidos: entrada de 0,4 s y salida de 1,5 s bajo la tarjeta final. El audio termina cuando termina el video (lo que sobra se corta; el fundido de salida se aplica al final del tramo que suena).
- Si el tema es más corto que el video, no lo estires ni lo aceleres. Puedes poner una segunda pista del mismo archivo que empiece donde termina la primera, con fundidos que se crucen, o decirle a la persona que el tema no alcanza. Avisa siempre en la nota.

## 5. Efectos

Solo si la persona entregó archivos de efectos. Pocos y exactos: cada efecto tiene una causa en pantalla; demasiados suenan a plantilla.

| Sonido | Solo en |
| --- | --- |
| clic | un clic real de cursor en pantalla |
| whoosh (barrido) | un corte de escena, o una tarjeta grande que se mueve rápido |
| tecla suave | texto que llega letra a letra o línea a línea |
| pop | una insignia, etiqueta o número que aterriza |
| subida que termina en impacto | el remate o la marca, una sola vez en el video |

- Coloca el efecto para que su pico caiga un cuadro (1/30 s) después de su imagen: la luz llega antes que el sonido, y un sonido adelantado se nota más que uno atrasado. Muchos archivos tienen el pico un poco después de su inicio; si no sabes dónde, empiézalo justo en el cuadro de la imagen.
- Si el mismo sonido se repite y la persona dio varias tomas, altérnalas; el mismo whoosh en cada corte es la señal más común de plantilla.
- Con música fuerte, un video con mucho texto escrito puede prescindir de clics y teclas.
- Nunca tonos, campanitas ni pitidos sintetizados.

## 6. Niveles

Solo puedes ajustar volumen (`volumen` o `data-volume`) y fundidos. No puedes medir ni normalizar el audio, así que sé prudente:

- Música bajo una voz: volumen alrededor de `0.14`. Voz en `1`.
- Cada efecto suena de 3 a 6 dB por encima de la música: en ganancia, de ~1,4 a 2 veces el volumen de la música (música en `0.5` → efecto entre `0.7` y `1`). La app pone un limitador al final para que la suma no sature, pero no reemplaza un buen balance.
- No subas por encima de `1` salvo que la persona diga que un archivo está muy bajo: subir puede saturar.
- Una música con casi toda su energía por debajo de 150 Hz no se oye en el parlante de un teléfono; si la persona te lo comenta, díselo.

## 7. Lo que tienes que decir

En la nota de entrega (`revision.md` §7), en una línea: qué audio usaste, desde qué segundo del archivo, con qué volumen y fundidos, y que **quedó colocado y mezclado, pero no lo escuchaste**. Si la respuesta de `video_render` informa algo del audio (si hay pista, su duración), cítalo; si no informa nada, no afirmes que suena bien.
