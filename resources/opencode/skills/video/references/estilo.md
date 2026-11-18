# El estilo (el «look»)

Si nadie decide el estilo, el mismo pedido sale con el mismo aspecto una y otra vez. Y prohibir ese aspecto solo lo cambia por el siguiente por defecto. Lo que rompe esa costumbre es material de afuera, en este orden:

1. la especificación de diseño del proyecto (si existe);
2. una marca real (logo, colores, fuentes, fotos que entregó la persona);
3. una imagen o un video de referencia que te dio la persona;
4. el mundo propio del tema (una panadería tiene harina, madera, papel kraft y pan dorado; una clínica dental no).

Decide el estilo **antes de la primera escena**, como números en la línea ESTILO de la especificación (`especificacion.md`). No pidas aprobación del estilo: decídelo y haz el video.

## La especificación de diseño del proyecto

En Code y Overdrive, si la carpeta del proyecto tiene `frame.md`, `design.md` o `DESIGN.md` en la raíz, lee **el primero que exista** de esa lista e ignora los demás. En Chat, haz lo mismo con un archivo así que la persona haya adjuntado.

- **El encabezado (frontmatter) es obligatorio**: `colors`, `typography`, `spacing`, `components`. Copia los hex, las familias y los pesos exactos; nunca los redondees ni los inventes.
- **El texto es intención**: para qué sirve el estilo, qué hacer y qué no hacer. Síguelo como criterio, no como valores.
- **Marca sí, maquetación no**: los hex, las fuentes, la relación entre pesos y los «qué hacer / qué no hacer» son estrictos. Los tamaños de letra, los espacios, el grosor de bordes y la decoración los escalas tú para video. Un borde de 1 px o una sombra al 6 % de una página web desaparecen en pantalla.

## Desde una marca

- **Material que entregó la persona** (logo, capturas de su web, fotos, folleto, PDF): saca la paleta y la tipografía de lo que ves. Mira las imágenes antes de elegir nada.
- **Una marca nombrada sin material**: no inventes sus hex ni afirmes que usas sus fuentes oficiales. Toma lo que sepas con seguridad o elige un estilo propio del tema, y dilo en una línea al entregar.
- No hay captura de sitios web ni importación de Figma: trabaja solo con lo que la persona entregó o con lo que encuentres con las herramientas de imágenes de la app (sección Fotos de `SKILL.md`).

**Fuentes:** la composición no tiene red. Hay tres vías (detalle y pesos exactos en `formato.md`, sección 8):

- Las 18 familias que incluye la app, por su nombre y sin archivo: `Inter`, `Montserrat`, `Outfit`, `Nunito`, `Poppins`, `Roboto`, `Lato`, `Playfair Display`, `Oswald`, `Open Sans`, `EB Garamond`, `Space Mono`, `IBM Plex Mono`, `JetBrains Mono`, `Source Code Pro`, `Noto Sans JP`, `League Gothic` y `Archivo Black`. Solo estilo normal y los pesos que trae cada una (400/700, algunas 900; League Gothic y Archivo Black solo 400).
- Fuentes que existen en Mac y en Windows, sin archivo: `Arial`, `Arial Black`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Georgia`, `Times New Roman`, `Courier New` e `Impact` (solo titulares cortos). Siempre con una de respaldo de la misma clase. No uses `Helvetica`, `Segoe UI`, `San Francisco` ni `system-ui`: cambian según el equipo.
- En negrita usa `bold` (700) o una familia ya gruesa (`Arial Black`); otros pesos se simulan y se ven distintos según el equipo.
- Cualquier otra familia necesita su `@font-face` en el mismo archivo que la usa, con el archivo de la fuente dentro de la composición: `src: url('assets/fonts/nombre.woff2')`. Solo si ese archivo ya está en el proyecto o lo entregó la persona (solo en Code y Overdrive). No descargues fuentes.
- No uses `local('Nombre')`: dibuja la fuente instalada en este equipo, y Mac y Windows tienen fuentes distintas. El video debe salir igual en los dos.
- Si la fuente de la marca no está disponible, usa la más parecida de las listas y dilo en una línea.

## Desde una referencia

Una imagen o un video de referencia te da su **gramática, nunca su contenido**:

- la duración de los planos;
- cómo entran y salen los títulos;
- las transiciones;
- qué papel cumple cada color (fondo, tinta, acento);
- la escala y el peso de la letra.

Mira la referencia con atención y anota esa gramática en la especificación. Separa lo que **mediste** (por ejemplo, «el título ocupa un 12 % del alto») de lo que **supusiste** («parece que los cortes van cada 2 s»). Después compara tus cuadros de `video_cuadros` con la referencia y corrige lo que se aleje. No copies sus textos, su logo ni sus imágenes.

## La línea ESTILO

Sin especificación de diseño, el estilo es la línea ESTILO de la especificación del video (`especificacion.md`). Sácala de la marca, de la referencia o del tema mismo: su época, sus materiales, dónde se vería.

- **Cada parte es un número**: hex, px, %, una familia con nombre y su peso.
- **El fondo y el protagonista salen de un medio** (papel, foto, tinta, pantalla de producto, vidrio, arcilla), no de efectos.
- **La línea PROHIBIDO** de la especificación lo aleja de lo que sale por defecto.
- Inter, Space Grotesk, Instrument Serif, Geist y JetBrains Mono son donde cae el diseño generado. Úsalas cuando la marca las usa, no por costumbre. (De ellas, la app incluye `Inter` y `JetBrains Mono`; las otras necesitan su archivo en `assets/fonts/`).
- Copia la paleta y las fuentes a las variables de la raíz (abajo).

## Datos de video que importan

- **Degradados lineales a pantalla completa sobre fondos oscuros se ven en bandas** al comprimir a H.264. Usa un degradado radial, un color sólido, o un sólido con un brillo local.
- **Un acento al 5 % de opacidad desaparece** con la compresión. Para ambiente usa 15–25 %; para el elemento principal, saturación completa.

## Fotos como medio

Cuando el estilo es fotográfico (un producto real, un lugar, comida, personas), las fotos son el material, no un adorno:

- Búscalas y apruébalas con el flujo de fotos de `SKILL.md` (`documentos_imagenes_buscar` → `_ver` → `_usar`), o usa las que entregó la persona. Nunca pongas URLs en la composición: la foto entra como archivo local.
- Que la foto llene: el protagonista ocupa al menos el 40 % del alto o del ancho del cuadro (`especificacion.md`). Recorta con `object-fit: cover` y elige el encuadre (`object-position`) para que el sujeto no quede cortado.
- Saca la paleta de la foto: el acento es un color que ya está en ella.
- Sin créditos ni pies de foto automáticos en el video. Solo si la persona los pide.

## Hazlo fácil de cambiar

Declara la paleta y las fuentes **una sola vez**, como variables CSS en la raíz, y úsalas en todas partes. Así un cambio de marca es cambiar cuatro líneas:

```html
<style>
  :root {
    --color-fondo: #1f3a2e;   /* fondo de la especificación */
    --color-tinta: #f6ead2;   /* tinta */
    --color-acento: #e0a24a;  /* acento */
    --fuente-titulo: Georgia, "Times New Roman", serif;  /* familia de títulos */
    --fuente-texto: Arial, sans-serif;     /* familia de texto */
  }
  #main { background: var(--color-fondo); color: var(--color-tinta); font-family: var(--fuente-texto); }
  h1 { font-family: var(--fuente-titulo); }
  .acento { color: var(--color-acento); }
</style>
```

Los valores del ejemplo son solo de muestra: pon los de tu especificación. Si la composición tiene varios archivos (`index.html` + `compositions/`), copia el mismo bloque `:root` (mismos nombres, mismos valores) en cada archivo de escena, para que cada una se vea bien también sola.
