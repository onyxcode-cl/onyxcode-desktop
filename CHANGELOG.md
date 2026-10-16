# Cambios de Lazunox

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen [SemVer](https://semver.org/lang/es/).
Cada sección se usa tal cual como notas de la release en GitHub (`scripts/release-notes.mjs`), así que se escribe en lenguaje llano para
quien usa la app. El detalle técnico de cada cambio está en `CHANGELOG-FASE6.md`, `CHANGELOG-FASE7.md` y `CHANGELOG-FASE8.md`.

## [0.5.33] - 2026-10-16

### Mejoras

- **Chat con la misma barra lateral que Overdrive y Code.** Cada conversación muestra su título y una segunda línea con su estado («Trabajando», «Terminado · hace 5 min»). Al pasar el mouse aparecen la papelera (siempre con confirmación) y los tres puntos, con un menú que ya no se corta.
- **Aviso del motor de IA, en palabras claras.** Si usas un motor instalado aparte, en lugar de la franja técnica ahora ves una tarjeta con dos botones: «Usar el motor incluido» (lo cambia y reinicia el motor, pidiendo confirmación si hay trabajo en marcha) y «Ahora no» (no vuelve a avisar para esa versión).
- **Inicio de Overdrive más útil.** Arriba aparece «Esperando tu aprobación» con las tareas que te piden algo (con botón «Abrir»), y debajo «Retomar» con tus tareas recientes. Las sugerencias pasan a segundo plano cuando ya tienes tareas.

## [0.5.32] - 2026-10-16

### Mejoras

- **Nuevo panel «Entorno» en Code y en Overdrive.** Con un clic ves de un vistazo dónde está trabajando la IA: el nombre del equipo, la carpeta del proyecto con su ruta, y en Code la rama con sus cambios sin guardar; en Overdrive, además, el modo («Solo en tu carpeta» o «Control total», con un botón para cambiarlo) y si hay punto de restauración.

## [0.5.31] - 2026-10-16

### Mejoras

- **Overdrive: «Cambiar a Solo en tu carpeta» ya no te hace reescribir el mensaje.** Al pulsarlo en la tarjeta del plan de Control total, la tarea se cancela y tu mensaje queda escrito en el cuadro, listo para enviar en el modo seguro (si ya estabas escribiendo algo, no se pisa).
- **Code: un proyecto que cierras ya no reaparece al reiniciar la app.** Y los proyectos que ya tenías abiertos no desaparecen de la barra.

## [0.5.30] - 2026-10-15

### Mejoras

- **Overdrive: ya no parte solo en «Usar todo tu Mac».** Antes, si habías usado Control total en tu carpeta personal, se volvía a activar cada vez que abrías Overdrive y hasta una consulta de solo lectura te pedía aprobar un plan. Ahora cada sesión empieza en «Solo en tu carpeta» y subes a Control total cuando lo necesitas.
- **Overdrive: el bloqueo del plan se explica en palabras claras.** En vez del texto técnico en rojo («Todavía no hay un plan aprobado… computer_request_access…») ahora dice «Esperando tu aprobación del plan», sin contarlo como error. Vale para cualquier MCP o herramienta.
- **Overdrive: la tarjeta de progreso ya no inventa fases.** Sin plan mostraba «Reunir datos · Crear el documento · Revisar» aunque no hubieras pedido ningún documento; ahora muestra solo lo que hace («Leyendo ventas_marzo.csv») y sus contadores reales.
- **Overdrive: menos avisos repetidos de restauración.** En Control total sobre tu carpeta personal ya no sale «Esta vez no se guardó un punto de restauración» en cada mensaje.
- **Overdrive: barra lateral nueva.** La carpeta es una tarjeta con su ícono, «Proyecto e instrucciones» es un botón al lado, ordenar y archivadas van en una sola fila con íconos, y cada tarea muestra su estado y hora («Trabajando», «Terminado · hace 5 min»), con las que están en curso arriba.
- **Overdrive: el modo siempre a la vista.** Una insignia fija dice «Solo en tu carpeta» o «Control total», y la tarjeta del plan ofrece «Cambiar a Solo en tu carpeta» cuando el plan no controla ninguna app.
- **Avisos del sistema cuando una tarea termina, falla o necesita tu aprobación**, solo si la app no está en primer plano, sin rutas ni contenido en el aviso y con un interruptor en Ajustes > Tareas.
- **Mensajes en palabras llanas.** Unos 40 textos técnicos («sandbox», «MCP», «binario», errores del sistema como permiso denegado o archivo no encontrado) ahora dicen qué pasó y qué puedes hacer.
- **Code: el menú «⋯» de una sesión ya no se corta** y hay una papelera al pasar el mouse.

## [0.5.29] - 2026-10-15

### Mejoras

- **Overdrive: el progreso ahora avanza de verdad.** La tarjeta «Pensando…» mostraba «Paso 3 de 3» y la barra llena apenas empezabas una petición nueva, porque arrastraba el plan de la tarea anterior; además se quedaba en el paso 1 y saltaba al final. Ahora cada petición empieza desde cero: el título dice lo que está haciendo («Leyendo ventas_marzo.csv»), con el plan muestra «Paso 2 de 5 · 4 acciones · 0:42» y una barra por pasos que avanza de a poco; sin plan muestra contadores reales (acciones, archivos leídos y creados) y la fase en que va, sin inventar porcentajes.
- **Overdrive: ya no pide controlar tu PC sin necesitarlo.** Al asistente se le indica que para documentos, archivos y búsquedas web no use el ratón ni el teclado, y la tarjeta que avisa que necesita Control total solo aparece si lo dice de forma explícita. Si te pide controlar la pantalla, el botón principal es «No, seguir sin controlar el PC».
- **Pegar imágenes y archivos en el cuadro de mensaje** (Chat, Code y Overdrive): copiar un archivo en el Finder o el Explorador y pegarlo ahora lo adjunta (hasta 10 archivos, 25 MB cada uno). **Si no funciona en tu equipo, cuéntanos qué copiaste y desde dónde.**
- **Code: el menú «⋯» de una sesión ya no se corta.** Al apretar los tres puntos solo se veía «Fijar sesión» porque la lista recortaba el resto. Ahora el menú se muestra completo (Fijar, Renombrar, Archivar y Eliminar, separado en rojo) y se abre hacia arriba si abajo no hay espacio. Además, al pasar el mouse por una sesión aparece una papelera para eliminar con un clic (siempre pide confirmación).

## [0.5.28] - 2026-10-15

### Mejoras

- **Code: tarjeta para cada documento que crea el asistente.** Cuando genera un Excel, Word, PowerPoint, PDF o presentación HTML, aparece una tarjeta con el nombre, el tipo y el peso real del archivo, con los botones **Abrir** (lo abre con tu programa de siempre: tu Word, tu Excel, tu PowerPoint o tu visor de PDF) y **Mostrar en la carpeta**. Antes solo quedaba la ruta escrita en el texto. Siempre se ve, también en el modo Resumen.

## [0.5.27] - 2026-10-15

### Mejoras

- **Tres modos de lectura: Resumen, Normal y Detallado.** Arriba a la derecha de la conversación (Chat, Code y Overdrive) eliges cuánto ver; en ventanas chicas aparece como un botón con menú. **Resumen** deja solo las respuestas, los documentos, las preguntas, los permisos pendientes y los errores, sin los pasos técnicos. **Normal** es como antes. **Detallado** abre cada paso. Siempre se ve lo que necesita tu atención.
- **Tarjetas de documentos en el Chat.** Cuando el asistente crea un Excel, Word, PowerPoint o presentación, aparece una tarjeta con vista previa, nombre y tipo, con los botones «Abrir» y «Descargar»; el peso del archivo se muestra en cuanto se genera.
- **Plan visible en Code.** Una tarjeta «Plan · 3 de 5 listos» muestra los pasos hechos, el que está en curso (con su tiempo) y los que faltan, y se actualiza sola.
- **El texto seleccionado ahora se nota.** El resaltado al seleccionar texto era casi invisible en el tema oscuro; ahora se ve claro en todos los temas.

## [0.5.26] - 2026-10-15

### Arreglos

- **Windows: la actualización dentro de la app ya se instala.** Si abrías Lazunox desde el acceso directo del menú Inicio o del escritorio, al pulsar «Actualizar» salía que no se pudo instalar y quedaba la versión anterior: Windows no deja renombrar una carpeta que otro programa usa como carpeta de trabajo, y el reemplazo la heredaba de la app. Ahora el reemplazo se hace desde otra carpeta y, si algo falla, guarda el motivo. **Si tienes la 0.5.25 o anterior en Windows, instala esta versión una vez a mano desde la página (la actualización dentro de la app todavía no puede con ese caso); de ahí en adelante se actualiza sola.**

## [0.5.25] - 2026-10-15

### Arreglos

- **Mac: la 0.5.24 se cerraba al abrirla («Cannot find module»).** Esa versión salió de Mac sin unos archivos internos y la app se caía apenas arrancaba. **Si instalaste la 0.5.24 en Mac, esta versión la reemplaza: descárgala una vez desde la página y de ahí en adelante se actualiza sola.** La 0.5.24 se retiró; trae lo mismo que ahora llega en esta (la barra lateral nueva, el panel de Cambios y el pulido visual). Además, ahora cada versión se revisa automáticamente para comprobar que no falte ningún archivo interno antes de publicarla.

## [0.5.24] - 2026-10-15 (retirada)

### Mejoras

- **Barra lateral nueva.** Los cuatro modos (Chat, Code, Overdrive y Rutinas) pasan a una tira de íconos a la izquierda, y al lado queda la lista de conversaciones, sesiones o tareas con «Nueva…», buscar y, en Code, filtros (Todas, Activas, Cambios). En ventanas angostas la lista se pliega sola y queda solo la tira. Ajustes, tema y ayuda quedan abajo.
- **Code: panel «Cambios» a la derecha.** Muestra los archivos modificados con sus +/−, el detalle de cada cambio, y botones para marcar como revisado o revertir. Cada sesión muestra su estado con un punto de color: trabajando, esperando tu permiso o respuesta, o con cambios por revisar. Con ventanas angostas el panel se acomoda al lado de la conversación sin taparla.
- **Pulido visual.** Los botones deshabilitados se leen bien en tema claro, el código del diff ya no se parte en varias líneas, los títulos de las sesiones no los pisa el estado, y la lista de Overdrive, las Rutinas y la cabecera de Code quedaron alineadas y ordenadas.

### Arreglos

- Los archivos con tildes, ñ o comillas en el nombre ya aparecen en el panel de cambios.
- «Revertir todo» ya no se puede pulsar mientras el asistente sigue trabajando.

## [0.5.23] - 2026-10-14

### Mejoras

- **Las preguntas con opciones ahora salen como botones.** Cuando el asistente te pregunta algo con opciones (por ejemplo, si quieres la presentación editable en PowerPoint o con diseño libre HTML/CSS), aparece una tarjeta para elegir y pulsar Responder, en vez de tener que escribir «1» o «2». Es la misma tarjeta en Chat, Code y Overdrive.

### Arreglos

- **Overdrive:** el aviso de proveedores ya no nombra marcas que no corresponden, y el nombre largo del modelo se acorta con «…» solo en escritorio, sin afectar el celular.

## [0.5.22] - 2026-10-14

### Arreglos

- **Chat: al pedir una presentación, siempre pregunta el formato.** Si escribías «una presentación en PowerPoint» o «un PPT», el asistente la armaba directo sin preguntar. Ahora, salvo que digas «editable» o pidas HTML/CSS o PDF, antes de armarla te pregunta si la quieres editable (PowerPoint) o con diseño libre (HTML/CSS), te explica la diferencia y te recomienda una.

## [0.5.21] - 2026-10-14

### Mejoras

- **Overdrive ahora funciona con casi todas las IA que usan clave de API.** Hasta ahora, en Overdrive (el modo aislado) solo se podía usar OpenCode Go. Ahora también funcionan OpenAI, Anthropic (Claude), Google (Gemini), DeepSeek, OpenRouter, Mistral, Groq, xAI, Together y muchas más (más de 200 proveedores). Tu clave sigue sin entrar nunca al entorno aislado: la guarda Lazunox fuera y la usa por ti.
- **Más protección al usar tu clave en Overdrive.** El entorno aislado solo puede conversar con el modelo (no puede tocar archivos, facturación ni claves de tu cuenta del proveedor).
- **Lo que sigue sin estar en Overdrive:** las IA con inicio de sesión (ChatGPT, GitHub Copilot) y los servicios en la nube (Amazon Bedrock, Azure, Google Vertex). Para esos usa Control total, Chat o Code.

## [0.5.20] - 2026-10-14

### Arreglos

- **Code: «Preguntar siempre» ya no se parte en dos líneas.** En la 0.5.19, con un modelo de nombre largo y el selector de esfuerzo visible, el texto del modo de permisos (y otros botones de la barra) se partía en dos líneas. Ahora cada botón mantiene su texto en una línea y quien se acorta con «…» es el nombre del modelo.

## [0.5.19] - 2026-10-14

### Mejoras

- **Code: la barra de abajo del cuadro de escritura quedó ordenada.** Antes, con un nombre de modelo largo (por ejemplo «DeepSeek V4 Pro (New)») los botones se pisaban y la barra se partía en dos líneas. Ahora es siempre una sola fila: al achicar la ventana primero se esconden las palabras, después algunos íconos (@ y adjuntar pasan al menú «⋯»), y el nombre del modelo se acorta con «…». El botón de enviar nunca se tapa.

### Arreglos

- **Excel: las fórmulas modernas ya no salen con error `#NAME?`.** Las funciones nuevas de Excel (como `XLOOKUP` o `FILTER`) se escriben ahora de la forma que Excel entiende.

## [0.5.18] - 2026-10-14

### Arreglos

- **Windows: la versión que muestra el Panel de control y winget ahora se actualiza.** Después de actualizar desde la app, Windows seguía mostrando el número de la versión anterior en «Aplicaciones instaladas». Ahora queda al día. El resto de la app no cambia.

## [0.5.17] - 2026-10-14

### Arreglos

- **Windows: la actualización dentro de la app ahora termina bien.** En la 0.5.16 el botón «Actualizar» aparecía, pero al pulsarlo la app se cerraba y no volvía a abrirse (la versión anterior quedaba intacta y bastaba con abrirla de nuevo). Ahora se cierra, se reemplaza y se vuelve a abrir sola. **Si tienes la 0.5.16 en Windows, instala esta versión una vez a mano; de ahí en adelante se actualiza sola.**

## [0.5.16] - 2026-10-14

### Arreglos

- **Windows: la app ahora se actualiza sola.** Hasta ahora, en Windows la app avisaba que había una versión nueva pero solo ofrecía «Descargar» y había que instalarla a mano. Se arregló la comprobación de que la app quedó instalada con el instalador oficial. **Si ya tienes Lazunox en Windows, instala esta versión una vez a mano; de ahí en adelante se actualiza sola, como en Mac.**

## [0.5.15] - 2026-10-14

### Arreglos

- **Seguridad: motor del navegador interno actualizado.** Lazunox usa por dentro el mismo motor que Chrome (Electron); pasó a la versión 44.7.2, con los últimos parches de seguridad.
- **Limpieza automática de lo que ya no se usa.** Si tu equipo guardaba una copia abandonada de LibreOffice de versiones anteriores (unos 800 MB), la app la borra sola unos segundos después de abrirse. También sacamos del instalador archivos de Python sobrantes, así que la app pesa un poco menos.

## [0.5.14] - 2026-10-14

### Novedades

- **Presentaciones: ahora te pregunta cómo la quieres.** Si pides una presentación sin decir el formato, el Chat te da las dos opciones y te explica las diferencias antes de armarla. **Editable:** un archivo de PowerPoint que puedes modificar después. **Diseño libre (HTML/CSS):** se ve mucho mejor y tiene más variedad, pero no se edita; la puedes presentar dentro de Lazunox a pantalla completa, bajar como PDF o bajar como PowerPoint para proyectar.

## [0.5.13] - 2026-10-14

### Novedades

- **Las actualizaciones te llegan antes.** La app revisa si hay una versión nueva cada pocas horas mientras está abierta, no solo al abrirla y una vez al día. Si está abierta durante días, igual se entera.

### Arreglos

- **Menos espacio perdido.** Cuando ArtCraft se actualiza, la app borra sola las versiones anteriores y los restos de descargas que quedaron a medias, solo después de comprobar que la nueva quedó bien instalada.

## [0.5.12] - 2026-10-14

### Novedades

- **Revisión al abrir la app.** Cada vez que abres Lazunox, revisa en un instante que tengas todo lo necesario (el motor, ArtCraft, y en Mac los permisos). Si falta algo, aparece la pantalla «Preparando Lazunox» con un botón para instalarlo, con el avance de cada descarga y el motivo claro si algo falla. Antes, esa revisión solo ocurría la primera vez y se podía saltar.
- **Estado de componentes** en Ajustes › Diagnóstico, con un botón para revisar de nuevo.

### Arreglos

- **Permisos del Mac que «no se activaban».** Si Accesibilidad ya está concedida y falta Grabación de pantalla, la app lo explica al instante y ofrece reiniciar; avisa si la app está abierta desde el instalador y no desde Aplicaciones; y trae ayuda para repararlos.
- **ArtCraft en una Mac nueva.** La descarga ahora respeta la red del sistema (proxy y certificados), los fallos se explican y se guardan en Diagnóstico, la vista web ya no se queda «generando» para siempre y, si falta ArtCraft al crear un documento, ofrece instalarlo ahí mismo.
- **Documentos con modelos GPT.** La app ya no descarta un documento completo por un detalle de formato, avisa cuando un documento sale mal o se corta y ofrece pedirlo de nuevo.
- **Cambiar de cuenta.** Al conectar otra cuenta (por ejemplo OpenCode Go después de ChatGPT) la app revisa los modelos elegidos y avisa con qué modelo trabaja; ahora se puede desconectar el inicio de sesión de ChatGPT, y un inicio de sesión sin terminar ya no bloquea guardar otra clave.
- **Inicio de sesión de ChatGPT.** Muestra el código cuando usas el método sin navegador, explica el motivo si algo falla y deja volver a intentar.
- **Windows:** la bienvenida espera a que termine de instalarse el entorno aislado en vez de darlo por fallido apenas empieza.

## [0.5.11] - 2026-10-14

### Novedades

- **Registro de problemas en Diagnóstico.** La app ahora guarda en tu equipo los errores que va teniendo (de la ventana, del motor, del actualizador o si se cierra algo por un fallo) y los muestra en Ajustes › Diagnóstico, para que si algo falla puedas copiarlos o exportarlos y mandarlos. Se guardan sin claves ni tu nombre de usuario, y ocupan poco: los más viejos se borran solos.

## [0.5.10] - 2026-10-14

### Novedades

- **Documentos con ArtCraft, igual que en el programa real.** El Chat crea PowerPoint, Excel y Word con las herramientas de ArtCraft y el panel los muestra tal como se verían abiertos en el programa, con la misma pantalla; también hay vista de PDF. La app descarga y verifica ArtCraft sola en el primer uso. LibreOffice ya no hace falta y se quitó. La IA tiene libertad de diseño (paleta propia, fuentes, lienzo libre, gráficos nativos) y hay diapositivas nuevas: línea de tiempo, agenda, cita y tabla, con transiciones suaves. Los Excel salen con encabezado oscuro, filas alternadas y total destacado.
- **«Abrir aparte».** Un botón del panel abre el documento en el programa de escritorio de ArtCraft (o en el que tu sistema use por defecto).
- **Tareas ahora se llama Overdrive,** y los modos (Chat, Code, Overdrive y Rutinas) van en una lista vertical con ícono y nombre completo, para que nada se corte.
- **Arrastrar una carpeta** a la ventana de Overdrive la conecta, con la confirmación de siempre. **Clic derecho** con copiar, pegar y seleccionar todo en los campos de texto.
- **Acerca de** nombra a los creadores y los créditos de ArtCraft.
- **Celular en beta.** La conexión con el celular ahora dice «beta» en Ajustes: sigue en prueba y puede fallar; el resto de la app no cambia.

### Arreglos

- **Motor de IA actualizado a OpenCode 1.19.0.** Misma forma de trabajar que antes; solo cambia la versión del motor incluido en Mac y Windows.
- **Windows:** los indicadores de «trabajando» se mueven aunque el sistema pida menos movimiento; el botón «Permitir» ya no queda gris con comandos largos; los botones de la ventana no tapan las cabeceras.
- **Vista previa de documentos:** si el modelo escribe un desliz común (una comilla de más, una coma colgando, un elemento «line»), se corrige solo en vez de dejar sin vista previa.
- **Presentaciones y documentos con fotos de internet.** Si la IA arma una presentación o un documento con imágenes de la web, ahora se ven (en la ventana, en el modo presentación, en el PDF y en el PowerPoint). La ventana sigue sin internet: es la propia app la que descarga las fotos y las incrusta en el archivo antes de mostrarlo. Solo de bancos de imágenes conocidos (Unsplash, Pexels, Pixabay, Wikimedia y Flickr), con límites de cantidad y tamaño; cualquier otro sitio se sustituye por una imagen gris que lo explica.

## [0.5.9] - próxima

Esta versión lleva Lazunox a Windows con casi todo lo que ya tenía en Mac, y cambia de dónde llegan las actualizaciones.

### Novedades

- **Control total opcional en Windows.** Si quieres que el agente trabaje en tu PC fuera del entorno aislado, puedes activarlo: hace falta
  que des tu consentimiento, que Tareas y Control del PC estén activos y que Lazunox **no** corra como administrador. El modo normal sigue
  siendo el aislado. El atajo de parada de emergencia se muestra como Ctrl+Alt+Mayús+Esc.
- **Control del PC en Windows, probado en un equipo real.** El agente abre las aplicaciones por su nombre (con el menú Inicio). Si la
  aplicación ya estaba abierta con trabajo tuyo, la tarjeta te lo avisa y el agente trabaja en una ventana o documento nuevo, sin tocar lo que
  ya había (también en Mac).
- **Paso final «Prepara tu equipo» en la guía de primeros pasos.** Con un solo botón pide los permisos de macOS, baja LibreOffice y, en Windows,
  prepara el entorno de Tareas. También hay «Probar con un ejemplo», que abre Tareas con una tarea de ejemplo ya escrita.
- **PowerPoint y PDF completos en Windows.** Las skills de presentaciones y de PDF ya funcionan en el entorno aislado de Windows (imagen
  2026.10.10, con las herramientas de Python que necesitan). La app aprende a trabajar con LibreOffice del sistema si lo tienes.
- **Bienvenida animada en el primer uso.** Al abrir la app por primera vez aparece una pantalla con la marca («Hecho por Onyx Code»), que revisa lo que ya tienes en tu equipo y prepara lo que falta (LibreOffice para ver documentos y, en Windows, el entorno aislado de Tareas). Ves la lista con los tamaños y una cuenta atrás de 6 segundos; puedes empezar ya u «Omitir por ahora». Los permisos de macOS siguen en el último paso del asistente.
- **Sin la pregunta del Llavero tras cada actualización (macOS).** Lazunox ya no toca el Llavero al abrirse si nunca vinculaste un celular, y los celulares vinculados se cifran con una llave que guarda un auxiliar diminuto (`lazunox-keybox`) cuya identidad no cambia entre versiones, así que macOS no vuelve a pedir la contraseña del Llavero en cada actualización. El auxiliar solo entrega la llave a Lazunox (comprueba la firma de quien lo lanza). Si el auxiliar no está disponible se usa el cifrado de siempre.
- **Actualizaciones desde GitHub Releases.** La app consulta y descarga las actualizaciones de las releases del repositorio; cada una
  sigue verificada con firma, tamaño y hash antes de instalarse. (El servidor propio queda como alternativa, `docs/VPS.md`.)
- **Instalación con un comando, opcional y solo para quien usa la terminal**, en Mac (`install.sh`) y en Windows (`install.ps1`): descargan,
  comprueban el hash SHA-256 e instalan sin administrador y sin avisos. Lo normal es descargar el DMG o el `.exe`; la guía está en `docs/INSTALAR.md`.
- **Logo nuevo**: una gema azul de cuatro facetas sobre un cuadrado blanco suave, en el ícono de la app (Mac y Windows), la barra lateral, la bandeja del sistema y la app del celular. El anillo con punto dorado se mantiene como indicador de «trabajando».
- **Ajustes › General: tamaño del texto** (pequeño, normal, grande), que se aplica al instante.
- **Tarjeta de resultado en Tareas**: al terminar, los archivos que dejó el agente con su icono, tamaño, «Abrir» y «Mostrar en la carpeta».

### Mejoras

- **Windows se ve más como en Mac.** Incluye la tipografía Inter, pesos de letra más finos, y los paneles del borde derecho y los botones de
  cabecera ya no quedan bajo los controles de la ventana. Los nombres de carpeta se cortan también por «\».
- **Modo automático con apps de Windows**: la lista inicial de aplicaciones de solo lectura es propia de Windows y con nombres legibles.
- **Barra lateral más accesible** para lectores de pantalla y teclado: la fila entera es un elemento del árbol, «Cargar más» y «Mostrar más»
  también, y los diálogos ya no quedan dentro del árbol.
- **Lenguaje más llano.** Tareas con tarjetas de modo «Solo en tu carpeta» y «Usar todo tu Mac/PC», pasos que describen lo que hizo el agente
  («Creó la hoja de Excel»), plan más amable y trabajo en curso con «Paso X de Y». Code tiene pantalla de inicio con tarjetas, modos de permisos con nombres
  claros (Preguntar siempre, Editar sin preguntar, Solo explorar, Automático, Todo sin preguntar), cambios con +líneas/−líneas y sesiones
  agrupadas por día.
- **Ventanas estrechas**: en Code y Tareas el chat conserva su ancho y el panel derecho cede espacio.
- **Textos de Windows en todas partes**: ventanas secundarias y avisos dicen «PC» y el atajo correcto, no «Mac» ni ⌘⇧Esc.
- **Tareas**: al enviar mientras el entorno arranca, ves al instante «Enviando…» y un segundo clic ya no crea otra tarea. En Windows, si el
  entorno aislado solo necesita actualizarse, no sale un banner rojo engañoso: lo explica la tarjeta, y se reconecta solo al quedar listo.
- **Tareas en Windows, sin tarjetas de más**: la carpeta de skills de la app se autoriza en solo lectura sin preguntar.

### Correcciones

- **El actualizador rechazaba todas las actualizaciones en Windows** (trataba el paquete descargado como una carpeta). Arreglado.
- En Windows, la carpeta de trabajo del agente se crea antes de iniciar el entorno aislado; el inicio de Tareas ya no ofrece «Usar todo tu
  PC» mientras no esté disponible.
- Las skills de documentos ya no intentan abrir LibreOffice dentro del entorno aislado de Mac (provocaba un aviso de problema de macOS); en
  su lugar avisan de que solo se comprueba la estructura. El entorno aislado de Mac copia también `ripgrep`, así que las skills funcionan desde la primera tarea.
- Las capturas automáticas ya no activan el modo control (ni minimizan la ventana, ni muestran el banner rojo) cuando el plan no usa apps.
- El asistente muestra el comando correcto de instalación de OpenCode en Windows y «Ya está listo» cuando la pieza ya estaba instalada.

### Cosas a saber

- **Aviso importante en Windows: la primera vez que se abra Tareas con esta versión, el entorno aislado se reinstala** (imagen nueva
  2026.10.10). **Todo lo que hubieras guardado dentro de esa distro fuera de `/opt/lazunox` se pierde.** Tus carpetas de Windows no se tocan. Si
  guardaste algo ahí dentro, cópialo a una carpeta de Windows antes de actualizar.
- **El instalador de Windows no está firmado** (no hay certificado de pago): si lo bajas desde el navegador, SmartScreen puede mostrar «Windows
  protegió su PC». Con `install.ps1` no sale. **El DMG de Mac no está notarizado**: macOS puede pedir «Abrir de todos modos». Ver `docs/INSTALAR.md`.
- **Aún sin comprobar en un equipo real**: la actualización automática descargada desde GitHub (en Mac se probó el reemplazo completo con estos mismos archivos desde un servidor local; en Windows, no), el Celular con un teléfono real, Rutinas y Code con terminal y worktrees en Windows, un Windows limpio sin WSL y el modo en segundo plano de Control del PC en Windows. Detalle en `docs/VERIFICACION.md`.
- Las apps ya instaladas consultan el repositorio `onyxcode-cl/onyxcode-desktop` de GitHub: si algún día cambia, hay que publicar antes una versión
  desde el repositorio anterior que apunte al nuevo.

## [0.5.0] - 2026-10-05

**Renombre total a Lazunox: instalación nueva, permisos y vinculación de celulares desde cero.**

### Cambiado

- La app es ahora **Lazunox** en todo, no solo en lo que ves: nombre, identificador de la aplicación, carpeta de datos, almacén de claves del Llavero,
  actualizaciones, instalador y certificado de firma («Lazunox Local Signing»). Es una instalación nueva: no hereda nada de la versión anterior.
- Hay que volver a conceder los permisos de macOS (Accesibilidad, Grabación de pantalla, Micrófono…) y **volver a vincular los celulares** (cambian las claves
  de la conexión), y las claves de IA y los ajustes se configuran de nuevo. Los iconos de la página del celular ya instalados hay que reinstalarlos.
- Las variables de entorno `ONYXCODE_*` pasan a `LAZUNOX_*` (sin compatibilidad con las antiguas).
- Los datos de versiones muy antiguas (Lapis, OpenDesk) se siguen migrando como antes.

### Pendiente

- El dominio del servicio de conexión del celular, la licencia (titular) y el repositorio público siguen a la espera de decisión del dueño.

## [Sin publicar]

### Cambiado

- La app pasa a llamarse **Lazunox** (antes OnyxCode) en todo lo que ves: ventanas, menús, panel «Acerca de», avisos, el celular y los textos de ayuda.
  Tus datos, claves, celulares vinculados y permisos no cambian. En macOS, algunos sitios del sistema (por ejemplo la lista de Ajustes del Sistema ›
  Privacidad o la negrita de la barra de menús) pueden seguir mostrando «OnyxCode» por ahora. Los iconos de la página del celular ya instalados
  conservan el nombre antiguo hasta que los vuelvas a instalar.

### Añadido

- Windows: preparadas las actualizaciones automáticas. Los scripts de publicación, firma y verificación aceptan `--platform win32-x64` y la app
  de Windows sabe descargar, verificar y reemplazar su carpeta con vuelta atrás si la nueva no arranca. Todavía **no está activo**: falta definir la
  clave pública de actualizaciones. Probado: los scripts y el verificador de la app con un paquete falso en macOS, y el reemplazo de carpeta
  (`swap.ps1`) en un PC Windows real. Sin probar: `tar.exe` con un ZIP real, el reemplazo con la app completa y el instalador por usuario.
- Preparación para publicar: instalador firmado y notarizado por Apple, actualizaciones automáticas verificadas y flujo de publicación con aprobación manual.

### Eliminado

- Ya no hace falta iniciar sesión: Lazunox deja de tener cuentas. Desaparecen la pantalla de acceso (Google o correo
  con código) y Ajustes › Cuenta. La app ya no se conecta a ningún servidor de cuentas. Al abrir esta versión se borra
  del equipo la sesión que hubiera quedado guardada; tus claves de IA, tus conversaciones y los celulares vinculados no
  se tocan.

## [0.3.0] - Sin publicar

Versión interna actual. No se ha distribuido todavía; sus notas se completarán antes de la primera publicación.
