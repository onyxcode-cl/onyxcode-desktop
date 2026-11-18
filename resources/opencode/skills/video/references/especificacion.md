# La especificación

En los adjetivos vive el aspecto por defecto. Con «premium, moderno, limpio», el modelo llena cada hueco con sus costumbres, y salen iguales en cada intento: un fondo negro vacío, un brillo, letra chica flotando al centro, todo apareciendo con un fundido. Cada adjetivo que conviertes en un número es una decisión que le quitas a la costumbre.

Por eso, **antes de cualquier escena, escribe la especificación**: el video como instrucciones de un director para ti mismo, con un número donde habrías puesto un adjetivo. Construye a partir de ella, revisa los cuadros contra ella y cámbiala cuando la revisión cambie el video.

- **En Code y Overdrive**: guárdala como `SPEC.md` junto a `index.html`, dentro de la subcarpeta de la composición en `./.lazunox/trabajo/`.
- **En Chat**: no hay herramientas de archivos. Escríbela en tu razonamiento antes de componer; no hace falta mostrarla completa.
- **No la presentes para aprobación** ni propongas varias versiones. Si piden un video, decide y hazlo. Pregunta solo si el pedido es ambiguo de verdad (por ejemplo, no se sabe de qué negocio o producto se trata).

La especificación sirve a la historia, nunca al revés (ver `historia.md`). Un estilo que convierte las cosas de la historia en formas abstractas fracasó, por llamativo que sea el cuadro.

## La plantilla

```text
META:       qué siente o hace quien mira al final, una frase
SALIDA:     formato (vertical 1080×1920, cuadrado 1080×1080 u horizontal 1920×1080), 30 fps
TIEMPO:     segundos × 30 = cuadros; con audio de la persona: BPM y cuadros por pulso
ESTILO:     fondo (hex, textura y cuánta), tinta, un acento y dónde puede aparecer;
            familia de títulos + peso + tamaño en px + espaciado entre letras, lo mismo para el texto;
            el medio (papel y tinta, fotografías, interfaz de producto, vidrio, arcilla, estudio 3D) con sus números;
            luz y profundidad: desplazamiento, desenfoque y opacidad de sombra, % de grano, % de viñeta
OBJETOS:    cada cosa que la historia necesita que se reconozca (un espejo, un reloj, un teléfono, una persona),
            dibujada con el material y los detalles que la hacen legible sin etiqueta: un espejo es
            vidrio plateado con un borde brillante y un soporte, no una barra
MOVIMIENTO: curvas (eases) por función, con nombre de GSAP (entrada, desplazamiento, salida, cámara);
            rebotes como razón de amortiguación; duraciones y desfases en cuadros
PLANOS:     una línea por plano: rango de cuadros, el único movimiento protagonista, qué lee quien mira
            (con su ventana de lectura), el sonido, y cómo le pasa el relevo al plano siguiente
PROHIBIDO:  la lista de abajo, más lo que este video no debe llegar a ser
REVISIÓN:   los segundos que pedirás a video_cuadros y qué debe mostrar cada uno
```

Notas para Lazunox:

- **Cuadros y segundos**: piensa los tiempos en cuadros (a 30 fps, 1 cuadro = 1/30 s), pero GSAP usa **segundos**. Para la timeline divide por 30: 18 cuadros = 0,6 s; 45 cuadros = 1,5 s.
- **Sonido**: prioriza el audio de la persona; si no hay, busca música con `video_musica_buscar` (`sonido.md`). Una promo lleva música salvo que la persona diga que no. No inventes voces.
- **REVISIÓN**: elige los segundos que más pueden fallar: la mitad de cada movimiento protagonista, el cuadro de cada relevo entre planos y el último cuadro. `video_cuadros` acepta hasta 6 segundos por llamada; si necesitas más, haz otra llamada.

## De palabras a números

| La palabra  | Se convierte en                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| premium     | un material con números: papel satinado con 2 % de grano; un producto sobre fondo continuo con sombra de contacto a 0,55; cromo con rugosidad 0,05 |
| moderno     | una cámara y un sistema de letra: un acercamiento de 30 cuadros con una sola curva; títulos al 9 % del alto del cuadro con espaciado de −2 %        |
| limpio      | una grilla y una ración: 12 columnas, márgenes de 96 px, el acento en una sola palabra por plano                                                    |
| dinámico    | cortes en el pulso, un cambio de composición en cada compás (cada 4 pulsos), un solo movimiento protagonista por plano                              |
| juguetón    | rebotes con amortiguación 0,45–0,6 en posición y escala (nunca en opacidad ni color), poses exageradas un 10–30 %                                     |
| cinematográfico | un lente y una luz: encuadre de 35 mm, luz principal desde arriba a la izquierda, contraluz desde atrás, 6 % de viñeta                          |

Para los rebotes en GSAP, lo más cercano que trae son `elastic.out(1, 0.5)` y `back.out(1.4)` (ver `movimiento.md`). «Dinámico» con pulsos y compases solo aplica si hay audio; sin audio, usa un ritmo fijo (por ejemplo, un cambio cada 2 s = 60 cuadros).

## Números de composición

- **El protagonista de un plano llena al menos el 40 % del alto o del ancho del cuadro.** Un objeto chico al centro de un cuadro vacío nunca es un plano: acércate, recorta o dale un mundo alrededor.
- **Un solo movimiento protagonista por plano.** Los movimientos secundarios recorren el 50–70 % de esa distancia, empiezan 100–200 ms después (3–6 cuadros) y todo lo demás se queda quieto.
- **En un video con historia, cada plano la hace avanzar**: pasa algo que causa el plano siguiente. Las frases se leen como causa y efecto («así que…», «o sea que…»), no como eslóganes.
- **Una tarjeta de información es distinta** (un dato, una tarjeta vertical que explica algo): su información está en pantalla en unos 2,5 s y luego se queda quieta, para que cualquier cuadro pausado se lea como un afiche terminado.
- **Algo nuevo cada 2–4 s** a lo largo del video; con audio de la persona, una composición nueva en cada compás.
- **Texto para leer**: nunca menos de 28 px a 1080 (2,6 % del lado corto), y en pantalla al menos 0,5 s + 0,3 s por palabra (una frase de 6 palabras: 2,3 s = 69 cuadros). Si hay demasiadas palabras, **corta palabras, nunca achiques la letra**.
- **Tamaños mínimos en Lazunox** (por encima del piso de 28 px): vertical 1080×1920 y cuadrado 1080×1080, texto 48 px y títulos 80 px; horizontal 1920×1080, texto 40 px y títulos 72 px.
- **Márgenes**: al menos 90 px a los lados; en vertical, al menos 200 px arriba y abajo, donde las redes ponen sus botones. Nada cortado ni encimado.

## PROHIBIDO por defecto

Aquí cae el video generado cuando nada más está decidido. Cada punto está prohibido salvo que el material propio de la marca o la referencia de la persona lo use, y entonces solo como ellos lo usan:

- un fondo negro o azul marino oscuro vacío, con elementos chicos flotando al centro;
- brillo, resplandor (bloom), neón, destellos de lente, esferas y anillos brillantes; partículas flotando como decoración;
- degradados morados o azules, degradados de malla, tarjetas de vidrio;
- un fondo de papel crema o blanco hueso con títulos en serif, palabras de acento en cursiva, etiquetas numeradas «01 / 02», etiquetas chicas en mayúsculas monoespaciadas, chips y botones en forma de píldora;
- todo centrado; todo apareciendo con un fundido al mismo tiempo; cada elemento apareciendo con fundido y subiendo;
- texto que se mueve mientras se lee; títulos que siguen derivando después de llegar;
- etiquetas en las esquinas, marcos alrededor del cuadro, corchetes de esquina, lecturas tipo HUD como decoración;
- tres tarjetas en fila, grillas de indicadores (KPI), un título sobre una captura de pantalla oscurecida;
- el logo estacionado en una esquina.

Después de la primera ronda de `video_cuadros` (y de nuevo con los cuadros de control de `video_render`), nombra cada costumbre por defecto que se coló igual, esté o no en esta lista, agrégala a la línea PROHIBIDO de este video y corrígela. La lista crece con cada video.

## Un estilo construido desde un medio

Un estilo se sostiene cuando es **las reglas de un medio**, no una paleta. Un estilo risografía, por ejemplo, tiene cinco partes y nada más:

- **papel**: un solo color plano con ruido de fibra, sin degradados;
- **tinta A**: cada palabra que hay que leer y cada línea estructural;
- **tinta B**: un acento fluorescente, un solo foco por cuadro (el número, la barra, el sello);
- **sobreimpresión**: donde las tintas se cruzan aparece un tercer color, y la plancha B queda 3 px fuera de registro;
- **trama de puntos**: todo degradado se hace con puntos.

El movimiento sale del mismo medio: el cuadro se **imprime**, plancha por plancha, no aparece con un fundido. Escribe cualquier estilo así: sus partes, qué puede llevar cada una y cómo se mueve el medio mismo (el papel se corta y se levanta, la tinta se imprime, el vidrio refracta, la arcilla se presiona, una foto se revela, se encuadra y la cámara se mueve sobre ella).

## Ejemplo corto

Pedido: «hazme un video para Instagram de mi panadería, Pan de Barrio, abre a las 7».

```text
META:       quien mira siente olor a pan recién hecho y sabe que abren a las 7
SALIDA:     vertical 1080×1920, 30 fps
TIEMPO:     15 s × 30 = 450 cuadros; sin audio
ESTILO:     fondo papel kraft #c89b6a con 3 % de grano; tinta #2b1d12; acento #f2c14e solo en «7:00»;
            títulos Impact, 150 px, espaciado −1 %; texto Arial bold, 52 px;
            medio: fotos reales de pan a sangre + papel kraft impreso; sombra 0 18px 40px a 0,35; viñeta 6 %
OBJETOS:    marraqueta con corteza dorada y harina (foto), bolsa de papel kraft doblada
MOVIMIENTO: entradas expo.out 24 cuadros; cámara power2.inOut; salidas power3.in 12 cuadros;
            secundarios a 4 cuadros de desfase y 60 % del recorrido
PLANOS:     0–120: foto del pan a sangre, acercamiento lento 100→112 %; lee «Pan de Barrio» (60–120); sin sonido;
                   la foto se desliza hacia arriba y deja ver el papel
            120–270: la bolsa se dobla y aparece «Recién salido del horno» (150–270); …
            270–450: «Abrimos a las 7:00» se imprime letra por letra, «7:00» en acento; queda quieto desde 360
PROHIBIDO:  la lista de arriba + logo en esquina + fundido general al final
REVISIÓN:   2, 4, 7, 9, 12, 14,9 s: foto llena el cuadro, texto entero dentro de márgenes, «7:00» legible
```

Es una muestra del nivel de detalle, no un estilo para copiar: cada video saca el suyo de su marca, su referencia o su tema.
