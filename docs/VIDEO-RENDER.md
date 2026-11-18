# Video: proyectos, revisión y audio (F8-B334, F8-B336)

`video_cuadros` y `video_render` pertenecen al MCP de video de main. Chat, Code y Tareas usan el mismo worker y las mismas piezas fijadas. El transporte anuncia `cuadros` y `render`; el motor antepone el nombre del servidor. Primero se miran los cuadros y la hoja de contactos, se corrige y después se pide el MP4.

## Proyecto y archivos de Chat

El proyecto tiene `index.html`, escenas `<template>` en `compositions/` y recursos en `assets/`. El runtime oficial monta las escenas en el mismo DOM y posiciona sus timelines; no hace falta compilar el proyecto. Cada host, raíz de escena y clave de timeline debe compartir id. La revisión mide el DOM ensamblado, incluidas las escenas.

El elemento raíz declara `data-composition-id="main"`, `data-width`, `data-height` y `data-duration`; `window.__timelines.main` debe ser una timeline GSAP pausada. Formatos: vertical 1080×1920, cuadrado 1080×1080 y horizontal 1920×1080; 30 fps y hasta 120 segundos. GSAP fijado se sirve en `assets/vendor/gsap.min.js`, `node_modules/gsap/dist/gsap.min.js` y `../node_modules/gsap/dist/gsap.min.js`. La ruta de vendor prevalece sobre cualquier copia del proyecto.

La copia privada tiene topes de 256 entradas, ocho niveles, 32 MiB por archivo y 128 MiB total. Rechaza enlaces simbólicos/duros, archivos especiales y tipos ajenos al proyecto. La lectura comprueba identidad y tamaño por descriptor sin seguir enlaces. No se carga configuración, plugins ni código Node del proyecto.

En Chat, `cuadros` admite `html` (512 KiB) o `archivos`, un objeto de rutas relativas → texto. Solo HTML, CSS, JS, JSON y SVG: 64 archivos, 512 KiB por archivo y 4 MiB de texto total. Se rechazan binarios, rutas absolutas, `..`, separadores ambiguos y duplicados por mayúsculas. El primer envío necesita `index.html`; la respuesta devuelve `composicion`. Un envío posterior con esa ruta y `archivos` reemplaza únicamente los archivos enviados, mediante escritura segura. El presupuesto incluye el texto ya guardado. El transporte de video admite 9 MiB para texto escapado; el resto de los MCP conserva su tope previo.

Todo queda bajo la carpeta privada de esa conversación, en `.lazunox/trabajo/video/composicion-…`. La app determina sesión y carpeta; el modelo no puede elegir otra conversación. Code comprueba proyectos abiertos en cada llamada; Tareas conserva el proxy y la traducción de rutas existente, sin cambios de WSL.

## Fuentes sin conexión

Se usan los **42 WOFF2 embebidos** de HyperFrames 0.9.64. El worker los lee del paquete verificado, sirve únicamente esos archivos por un prefijo privado y declara `@font-face` antes de cargar la composición. No llama al compilador ni a Google Fonts. Una familia incluida funciona por su nombre, sin copiar fuentes al proyecto.

| Familias | Pesos normales incluidos |
| --- | --- |
| Inter, Montserrat, Outfit, Nunito, Playfair Display, Roboto, Lato, Poppins | 400, 700, 900 |
| Oswald, Space Mono, IBM Plex Mono, JetBrains Mono, EB Garamond, Source Code Pro, Noto Sans JP, Open Sans | 400, 700 |
| League Gothic, Archivo Black | 400 |

Los archivos incluidos son subconjuntos latinos: no se promete cobertura de otros alfabetos ni otros pesos exactos. Otra familia necesita su archivo local y `@font-face`; no se descarga. Las familias también figuran en las descripciones de herramientas.

## Fotos

Ambas herramientas aceptan `fotos: [{origen, destino: "assets/foto.jpg"}]`, hasta 24. `origen` puede ser una ruta del ámbito concedido o un id/ruta preparado por `documentos_imagenes_usar`. En Chat también puede ser nombre o id de un adjunto humano de la conversación activa. Un nombre ambiguo exige id. Main resuelve los ids en el registro de esa misma carpeta/conversación; nunca en otra.

Cada foto debe tener firma PNG/JPEG/WebP/GIF, hasta 32 MiB y 40 megapíxeles. Se rechazan vistas previas marcadas y enlaces. Fotos y audio explícito suman como máximo 96 MiB por llamada; la copia completa conserva 128 MiB. Las fotos persisten en el proyecto para siguientes llamadas. No se insertan créditos automáticamente y una foto local no se rechaza por su licencia.

**Uso de las fotos buscadas:** el flujo predeterminado de documentos sigue estricto. Con `uso: "video"`, búsqueda, candidatos, preparación y registro aceptan cualquier licencia (F8-B337; contrato al final). Se conserva la procedencia como dato interno y no se convierte en crédito visible. Video también acepta archivos locales aportados de cualquier licencia.

## Audio de la persona

`render` admite hasta 16 pistas: `{origen, inicio, desde, hasta, volumen, fundidoEntrada, fundidoSalida}`. Tiempos en segundos; valores por defecto 0, salvo volumen 1 y `hasta` al final del archivo. Entrada MP3/M4A/WAV/AAC, hasta 32 MiB por archivo. Solo archivos del ámbito concedido o adjuntos humanos verificables; ninguna URL remota. En Chat, el compositor actual admite imágenes y documentos, **todavía no adjuntar audio**: el resolvedor admite partes humanas de audio si llegan por un canal compatible, pero no se añadió esa interfaz.

Los `<audio>` locales del DOM ensamblado también se mezclan. Se leen `data-start`, `data-duration`, `data-media-start`, `data-playback-rate` (0.1–10), `data-volume` (0–3.98), `data-fade-in` y `data-fade-out`, con desplazamiento y límite de la escena. `muted`/`data-hidden` silencian la pista. La automatización compleja `data-automation` no se aplica y genera aviso; no se extrae audio de `<video>` en este paso.

ffprobe valida el origen, el recorte y la pista. ffmpeg mezcla dentro del mismo worker: volumen, fundidos lineales, retraso, mezcla, limitador y silencio hasta completar el clip. Usa protocolos/demuxers cerrados (`file,pipe`; MP3/WAV/MOV/AAC), sin playlists ni red. La salida es H.264/yuv420p, 30 fps y AAC a 48 kHz cuando hay audio; ffprobe comprueba códec y duración de ambas pistas. Un video sin audio permanece mudo. No se genera ni descarga música o voz. El tono del smoke es exclusivamente un fixture de prueba.

## Revisión y hoja de contactos

Dentro del worker se reutilizan los módulos **del paquete fijado**:

- `lintHyperframeHtml`, sobre el texto de cada HTML, incluidas las escenas.
- `createPageDriver`, sobre la página ya aislada: auditoría oficial de geometría y superposiciones.
- `createContactSheet`, el generador de hojas del paquete usado por snapshot. Si Sharp no está presente, no se instala: se dibuja una hoja propia con los mismos cuadros y se informa.

La respuesta indica `revision.oficial`, `hojaOficial` y `alcance`. **No se ejecuta el check completo de CLI.** No hay API exportada del pipeline completo sobre una página ya autorizada; su ruta normal abre navegadores/servidores propios. Además, `lintProject` sigue rutas de recursos escritas por el autor desde Node, fuera de las restricciones del navegador en Windows. Se usa su lint puro y el auditor sobre la página existente, más la alternativa propia. No se incluyen todas las comprobaciones de movimiento, contraste y craft del CLI.

Se muestrean los tiempos pedidos, ocho interiores y entradas/medios/bordes de escena o beats, hasta 24 tiempos. La revisión propia detecta texto desbordado, recortado o tapado, área segura, cobertura y cuadros casi vacíos. Los avisos se agrupan por problema y elemento, con rango de tiempo; no se emite una copia por segundo. Los avisos no bloquean el MP4. Es un muestreo y puede omitir defectos breves; no hace OCR de imágenes/canvas ni sustituye mirar el movimiento.

`cuadros` entrega de uno a seis PNG a mitad por dimensión (540×960 vertical) y una hoja de contactos como imagen adicional, con tiempos. Los PNG individuales se reducen a un cuarto si superan 3 MiB en conjunto o 2 MiB por imagen. La hoja tiene un presupuesto separado de 1 MiB. El render devuelve tres controles extraídos del MP4 final. Main solo publica nombres fijos PNG/MP4 del temporal, mediante escritura segura; nunca sigue rutas arbitrarias del JSON del worker.

## Aislamiento y cancelación

Chrome usa proxy a un puerto cerrado, con excepción exacta para el servidor de ese render; DNS externo, QUIC y UDP WebRTC sin proxy desactivados. Intercepción antes de navegar: solo GET/HEAD al origen/prefijo aleatorio de la composición, además de imágenes/fuentes/medios `data:`. Servidor sin APIs, proxy ni redirecciones; solo proyecto, GSAP fijado y las 42 fuentes. CSP propia, sin frames, workers, objetos, formularios ni base. No se cambia la CSP principal ni la del visor.

Mac lanza worker, Chrome, ffmpeg y ffprobe con Seatbelt deny default, lectura limitada a temporal/piezas/bibliotecas/fuentes y escritura solo al temporal. Si falla no se relanza sin perfil. Windows conserva sandbox Chrome, proxy e intercepción. El worker recibe `HYPERFRAMES_NO_TELEMETRY`, `HYPERFRAMES_NO_UPDATE_CHECK`, `HYPERFRAMES_NO_AUTO_INSTALL` y `HYPERFRAMES_NO_OPTIONAL_INSTALL` a 1; entorno acotado sin credenciales del motor ni del proveedor.

Una operación por atadura, dos globales; cinco minutos de render y dieciséis con consentimiento/instalación. Cancelación por desconexión, revocación o cambio de sesión; grupo POSIX propio y taskkill por PID/árbol propio en Windows. stdin vigila la muerte de main. Se borran temporales al terminar. Instalación conserva consentimiento nativo y progreso cancelable.

## Repetir en Mac y Windows

Copiar el proyecto de referencia **solo con `index.html`, `compositions/` y `assets/`** a una carpeta de prueba. No incluir `renders/`. Usar piezas instaladas únicamente en un perfil temporal `lzx-video-*`:

```sh
node scripts/video/render-smoke.mjs --project RUTA_VIDEO_PRUEBA --composition-project COPIA_PANADERIA --installed-user-data PERFIL_TEMPORAL --report informe.json
```

El smoke copia las piezas al perfil temporal propio y borra sus copias y piezas de trabajo al terminar; el informe debe quedar fuera de ese temporal. Sin piezas, omitir `--installed-user-data` y pasar `--install` para consentir instalación solo allí. El mismo comando funciona en una terminal Windows no elevada. Alternativa Node: añadir `--node`. **Solo para diagnóstico Mac**: añadir `--node --diagnostic-without-seatbelt`; no certifica Seatbelt ni Electron.

Exigir: panadería H.264 1080×1920, 30 fps, 15 s; hoja de contactos con escenas; render con imagen; tono de 10 s recortado/mezclado en un MP4 de 9 s con AAC de 9 s, también desde `<audio>`; `networkProbePixel: 00ff00`, `localCanaryHits: 0`; temporales y procesos propios vacíos tras cancelar. Mirar la hoja y reproducir el MP4; las pruebas automáticas miden audio, no lo escuchan. Repetir fotos/archivos desde Chat y rutas desde Code/Tareas, cancelación y revocación.

**Estado:** diagnóstico real Node en Mac aprobado para escenas, foto, audio, revisión, red y limpieza. Electron termina con SIGABRT y Seatbelt rechaza `sandbox_apply` en este entorno. Ejecución Mac nativa y Windows real pendientes. No se usa el perfil personal ni la app instalada, no se cambia WSL ni se publica nada.


### Fotos buscadas para video (F8-B337)

Pasa `uso: "video"` a `imagenes_buscar` y a `imagenes_usar`. `imagenes_ver` conserva el uso del candidato y devuelve el dato para la preparación. También se conserva al buscar otra ronda con `searchId`. En video se aceptan fotos de cualquier licencia: se registra la etiqueta recibida y la fuente, sin créditos automáticos ni comentarios de licencia salvo pregunta de la persona. Commons y Wikipedia en inglés son los orígenes de búsqueda acotados; no se aceptan URLs arbitrarias.

Tras buscar y ampliar, prepara con `{"uso":"video","id":"ID_DEVUELTO","evaluation":{"mode":"visual","observed":"Lo observado en la ampliación","meets":[],"doubts":""}}`. Recuperación persistente sin red: `{"uso":"video","id":"ID_PREPARADO"}`. Para documentos se omite `uso` o se pasa `"documento"`, con licencia estricta y registro separado.

En Chat, `imagenes_usar` devuelve `source: "imagen:ID"`; en Code/Tareas devuelve id y path del ámbito autorizado (Code requiere `carpeta`). Ambas herramientas de video admiten `fotos: [{"origen":"imagen:ID","destino":"assets/foto.jpg"}]`; Code/Tareas también pueden pasar el path devuelto. El HTML usa `assets/foto.jpg`, sin URL remota. Los archivos pasan por los mismos límites y comprobaciones de firma, píxeles, rutas y enlaces del apartado de medios. El registro se comparte desde main; cada foto mantiene la conversación o carpeta que la autorizó.
