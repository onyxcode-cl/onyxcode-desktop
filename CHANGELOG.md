# Cambios de Lazunox

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen [SemVer](https://semver.org/lang/es/).
Cada sección se usa tal cual como notas de la release en GitHub (`scripts/release-notes.mjs`), así que se escribe en lenguaje llano para
quien usa la app. El detalle técnico de cada cambio está en `CHANGELOG-FASE6.md`, `CHANGELOG-FASE7.md` y `CHANGELOG-FASE8.md`.

## [1.8.18] - 2026-11-11

### Corrección de seguridad en Tareas en Mac

- **Qué pasaba.** En Mac, un programa ejecutado dentro de una tarea podía dejar «accesos directos» (enlaces) en carpetas que la app usa, y lograr que la propia app escribiera, borrara o leyera fuera de la carpeta de la tarea. Había varias maneras: reemplazando la carpeta privada de la tarea para que, al abrirla de nuevo, tuviera permiso sobre otra carpeta; haciendo que la app copiara archivos encima de un archivo tuyo; o haciendo que guardar las instrucciones, la memoria, una guía aprobada, un archivo importado, una descarga o una restauración terminara en otro lugar. Como en los casos anteriores, el modelo tenía que ejecutar ese código dentro de una tarea (por ejemplo, engañado por instrucciones escondidas en un archivo o en una página). Estaba así desde antes de esta versión. No tenemos señales de que se haya usado; lo encontramos nosotros al revisar.
- **Qué cambia.** La app ya no escribe a través de accesos directos en las carpetas de una tarea: lo comprueba antes y después de escribir. Una tarea ya no puede mover ni borrar las carpetas propias de la app dentro de su carpeta. La app dejó de copiar el catálogo de modelos y el programa de búsqueda a la carpeta privada de cada tarea; ahora se entregan en solo lectura. Y si una carpeta privada quedó como acceso directo, se reemplaza por una carpeta real al abrir la tarea.
- **Cambios que puedes notar.** Si borras la carpeta `.lazunox/trabajo` desde una tarea, ahora se vacía su contenido pero la carpeta ya no se elimina. Si una carpeta de proyecto es de solo lectura, la tarea abre igual, pero guardar memoria, descargas o grabaciones ahí avisa que no se puede escribir.
- **A quién afecta.** El fallo era de Mac. En Windows cambia por dentro la forma de guardar la memoria y de dejar las descargas en la carpeta. En Windows se probó guardar memoria e instrucciones dos veces seguidas, aprobar una guía, importar, pegar, crear un documento y deshacerlo; con el archivo abierto por otro programa la app avisa y no daña el archivo anterior.

### Otros arreglos

- **Las descargas dentro de una tarea no llegaban a la carpeta de la tarea.** Al descargar un archivo aparecía, además del permiso de la app, una ventana del sistema «Guardar como», y el archivo terminaba donde dijera esa ventana (normalmente Descargas). Pasaba en Mac y en Windows desde versiones anteriores. Ahora el archivo se baja primero a una carpeta interna de la app y, cuando lo permites, se deja en la carpeta de descargas de la tarea; ya no sale la ventana de más. Si rechazas, no queda nada.
- **Panel del proyecto: instrucciones del proyecto equivocado.** Al cambiar de proyecto, si el nuevo no cargaba, seguían a la vista las instrucciones del proyecto anterior y se podían guardar en el actual. Ahora el panel se vacía y «Guardar» espera a que cargue.
- **Aviso doble al no poder empezar una tarea.** Cuando una tarea no podía empezar, además del aviso que explica por qué salía un segundo cartel («El servidor de las tareas no está listo»). Ahora sale solo el aviso claro y lo que habías escrito se conserva.

### Lo que todavía no está cerrado

- **Un programa de una tarea puede seguir vivo después de cerrarla** y seguir escribiendo dentro de su propia carpeta, incluso dejando instrucciones o permisos para la tarea siguiente. Cerrarlo de verdad necesita una pieza nueva.
- **No se hizo una prueba con un programa atacando en vivo contra este arreglo.** Se comprobó leyendo el código, con pruebas simuladas y con una medición de más de 900.000 escrituras concurrentes, sin que el contenido saliera de su carpeta.
- **Quedan carreras muy estrechas** en carpetas no protegidas (ayudantes y guías del proyecto) y en borrados.
- **No se probó en unidades de red.**
- **No se probó en carpetas de OneDrive ni en memorias USB.**
- **No se probó una descarga con la carpeta de la tarea en otro disco.**
- **El encierro de Tareas sigue funcionando con una lista de cosas prohibidas.** Su reemplazo por uno que prohíbe todo y permite solo una lista está en construcción.
- **Los pendientes de la 1.8.17 siguen igual.**

## [1.8.17] - 2026-11-10

### Arreglos

- **En Tareas, el asistente ya puede abrir sus guías para crear documentos y buscar dentro de la carpeta.** Antes, al abrir una tarea el motor intentaba bajar un programa de búsqueda desde internet; el encierro de Tareas se lo impedía, aparecía un aviso de que se bloqueó el acceso a un sitio, y las guías de Word, Excel, PowerPoint y PDF no se podían abrir (los documentos se creaban igual, pero sin sus instrucciones). Ahora Lazunox trae ese programa incluido.
- **Code y Chat ya no necesitan bajar ese programa la primera vez que buscan.**
- **A quién afecta.** El fallo era de Mac. En Windows, Tareas ya traía ese programa.

### Componente incluido nuevo

- **ripgrep 15.1.0** (licencia MIT), el programa de búsqueda en carpetas. Su aviso está en los avisos de terceros.

### Lo que todavía no está cerrado

- **No se midió cuánto mejora la calidad de los documentos con las guías cargadas.** Solo se comprobó que ahora se abren y que la búsqueda funciona.
- **Se probó a mano con la app ya armada, una ronda en Mac y una corta en Windows.** En Mac: dentro de una tarea, el asistente abrió las guías de Excel, Word y PowerPoint y creó los tres documentos, ya sin el aviso de que se bloqueó el acceso a un sitio; la búsqueda funcionó en Tareas y en Code, sin bajar nada. En Windows: el programa de búsqueda viaja dentro de la app y Code lo usa; una tarea con WSL y un Excel con una suma siguieron funcionando. **No se probó**: PDF, el primer arranque de una instalación nueva, el celular, Telegram, la actualización automática hacia esta versión ni el instalador en un equipo limpio.
- **La herramienta de crear documentos puede fallar con «Error interno» sin decir qué estaba mal.** Pasa cuando el asistente le entrega los datos mal armados; en las pruebas terminó el documento por otro camino. Viene de antes de esta versión.
- **El panel de vista previa de documentos puede quedar en blanco.** Viene de antes de esta versión.
- **Los pendientes de la 1.8.16 siguen igual** (el encierro de Tareas sigue con lista de cosas prohibidas, y lo que no se pudo probar a mano).

## [1.8.16] - 2026-11-10

### Corrección de seguridad en Tareas en Mac

- **Qué pasaba.** En Mac, un programa ejecutado dentro de una tarea podía salirse del encierro que lo contiene, de tres maneras: abriendo una aplicación que quedaba funcionando fuera del encierro; registrando un programa de inicio que quedaba funcionando fuera y volvía a ejecutarse en cada inicio de sesión; y cambiando el archivo de reglas del encierro para que las tareas lanzadas después quedaran sin él. Para que ocurriera, el modelo tenía que ejecutar ese código dentro de una tarea (por ejemplo, engañado por instrucciones escondidas en un archivo o en una página). Estaba así desde la primera versión. No tenemos señales de que se haya usado; lo encontramos nosotros al revisar.
- **Qué cambia.** Las tres vías quedan cerradas. Además, las reglas del encierro ya no pasan por un archivo que la tarea pueda tocar. Lo normal de una tarea (Python, Node, git, crear documentos, el motor de Tareas) siguió funcionando en las pruebas.
- **A quién afecta.** Solo a Mac. En Windows, Tareas usa otro mecanismo y no cambia.

### Lo que todavía no está cerrado

- **El encierro de Tareas sigue funcionando con una lista de cosas prohibidas.** Por eso puede existir otra vía que no hayamos encontrado. Rehacerlo al revés (prohibir todo y permitir solo una lista) queda para una versión propia.
- **No se revisaron uno por uno todos los servicios del sistema.** Solo se probaron las vías conocidas y las que podían alcanzarse con las herramientas normales; los mensajes privados entre programas del sistema no se probaron.
- **Un programa dentro de una tarea todavía puede enviar señales a otros programas tuyos** (cerrarlos o pausarlos). Ya no sirve para salir del encierro, pero sigue siendo posible.
- **El PDF que crea una tarea funciona; la impresión con un navegador externo sin ventana no se pudo comparar.** En las pruebas, Tareas creó PDF sin problemas. La otra vía, que usa un navegador instalado en el equipo, falló igual dentro y fuera del encierro en el equipo de pruebas, así que no sabemos si el encierro le afecta.
- **Se probó a mano con la app ya armada, una ronda en Mac y una corta en Windows.** En Mac: una tarea simple, varias tareas seguidas y tras reiniciar la app, la creación de Word, Excel, PowerPoint y PDF dentro de una tarea, la vista en imagen de esos documentos, y los intentos de salir del encierro (abrir una aplicación, registrar un programa de inicio, escribir fuera, leer claves y usar la red): ninguno lo logró. En Windows: arranque, Code, una tarea con WSL y la creación de Word y Excel. **No se probó**: el celular, Telegram, la actualización automática hacia esta versión ni el instalador en un equipo limpio.
- **En Tareas, las guías de documentos pueden no cargarse.** Al abrir una tarea el motor intenta bajar un programa de búsqueda desde internet y el encierro se lo impide; aparece un aviso de que se bloqueó el acceso a un sitio. Los documentos se crean igual. Viene de antes de esta versión.
- **En Windows, al abrir una segunda tarea apareció una vez el aviso «El entorno de Overdrive necesita atención».** Con «Volver a comprobar» se resolvió. No sabemos la causa.
- **Los pendientes de la 1.8.15 siguen igual.**

## [1.8.15] - 2026-11-10

### Arreglos

- **Una edición negada o fallida ya no se muestra ni se cuenta como hecha.** Antes, si el motor no podía editar un archivo (porque lo negaste o porque falló), la conversación igual lo mostraba como una edición lograda y la sumaba al conteo. Ahora aparece como lo que fue. Lo mismo vale para el resumen que llega por Telegram.
- **El modelo de respaldo de Ajustes ahora llega también a Tareas.** Si elegiste modelos de respaldo, Tareas los usa cuando el principal se queda sin cuota. Solo se pasan los modelos que Tareas puede alcanzar desde su entorno aislado. Se aplica la próxima vez que arranque Tareas, no a las que ya están corriendo.
- **Al confiar en una carpeta, la app le pide al motor que la vaya preparando** en segundo plano. Así el primer mensaje, si lo escribes enseguida, espera menos. Esto no ocurre cuando la app vuelve a declarar tus carpetas al arrancar.

### Valorar la respuesta

- **Nuevos botones de pulgar arriba y pulgar abajo en Code**, junto a «Copiar respuesta», al final de cada respuesta terminada. Si marcas «mala», puedes escribir en una línea qué salió mal (es opcional). Volver a pulsar el mismo pulgar quita tu valoración; pulsar el otro la cambia.
- **Se guarda solo en tu equipo y no se envía a ninguna parte.** No lleva el texto de la conversación ni rutas de carpetas. Si exportas el informe de diagnóstico, las valoraciones guardadas van dentro de él.

### Motor nuevo (lazunox.17)

- **El primer mensaje ya no se queda esperando a un conector lento.** Espera como máximo 2 segundos y sigue con los conectores que ya estén listos; los que faltan se suman en el paso siguiente. En una prueba con un conector que tardaba 8 segundos, el primer mensaje pasó de 8,3 a 2,4 segundos. Mientras un conector sigue conectando, el modelo recibe una nota que lo dice.
- **Al confiar en una carpeta, el motor la prepara de antemano.** Con la carpeta ya confiada, el primer mensaje no paga esa carga (la carga completa cuesta unos 0,2 a 0,3 segundos).
- **Las claves que aparecen en lo que devuelve una herramienta ahora se tapan también en lo que se envía al servicio de IA y en el historial guardado.** Antes solo se tapaban en pantalla. En la prueba del banco (una clave falsa dentro de un archivo de entorno), pasó de 0 de 3 a 3 de 3, y con el tapado encendido las 60 tareas del banco siguieron pasando (60 de 60), así que no vimos que rompa nada útil.

### Lo que todavía no está cerrado

- **Se probó a mano en Mac y en Windows, una ronda en cada uno, con la app ya armada**: arranque, una conversación en Code, la edición negada, los botones de valorar, el primer mensaje con un conector lento, confiar y no confiar una carpeta, una clave falsa en un archivo y una tarea de Tareas (en Windows, con WSL). Todo pasó. **No se probó**: el celular, Telegram, la actualización automática hacia esta versión, ni el instalador de Windows en un equipo limpio.
- **El indicador de modo puede no coincidir con lo que rige.** Con «Hacer» y «Solo explorar» elegidos, las reglas reales son las de «Preguntar siempre»: el motor pide permiso en vez de negar. Nada se edita sin tu permiso, pero la pantalla dice otra cosa. Viene de antes de esta versión.
- **En Tareas, el primer envío justo al abrir puede decir «El servidor de las tareas no está listo».** Al reenviar funciona.
- **La tarjeta «No se hizo» todavía muestra el cambio propuesto y el botón «Revertir».**
- **No se forzó una caída de cuota para ver que Tareas use de verdad el modelo de respaldo**; se comprobó que lo recibe.
- **Una tabla de PowerPoint con una celda muy larga queda toda en letra chica.** Una sola celda larga hace que toda la tabla baje a letra pequeña (9 puntos), por debajo del mínimo que la propia app pide en las láminas. Con celdas cortas no pasa.
- **Los conectores remotos (por internet) no se probaron con el plazo nuevo**; solo los que se ejecutan en tu equipo. Tampoco se probó que la pantalla de conectores muestre el estado «conectando» (esa pantalla sigue esperando a todos).
- **No sabemos si todos los modelos obedecen la nota de «conectando».** Y si un conector termina de conectar justo mientras el modelo ya tiene su lista de herramientas, sus herramientas aparecen en el paso siguiente.
- **Si niegas solo algunas herramientas de un conector**, la nota de «conectando» igual lo nombra, porque todavía no se sabe qué herramientas trae.
- **Si quitas la confianza de una carpeta mientras se está preparando**, esa preparación no se interrumpe; sigue hasta terminar.
- **El tapado de claves no reconoce todo.** No tapa direcciones con usuario y clave (por ejemplo `postgres://usuario:clave@...`), ni variables cuyo nombre no lleve palabras típicas (como `AUTH` o `COOKIE`), ni valores sueltos sin un formato conocido. Además, el modelo ya no ve el valor real: una edición que cite exactamente una clave no la va a encontrar, y un comando que copie la clave de una salida llevará la marca `[REDACTED_SECRET]`. Se puede apagar con `LAZUNOX_SANITIZAR_MODELO=0`.
- **El tapado no se probó con un conector real de punta a punta**, ni con la compactación o reanudación de conversaciones con la marca puesta.
- **Los botones de valorar solo están en Code de escritorio**: no aparecen en Tareas, Chat, el celular ni Telegram. El botón «Exportar» del diagnóstico no se probó; se revisó el informe en pantalla.
- **Los pendientes de la 1.8.14 y la 1.8.13 siguen igual.**

## [1.8.14] - 2026-11-10

### Arreglos

- **«Solo explorar» elegido antes del primer mensaje ahora se respeta.** En una conversación nueva de Code, si elegías «Solo explorar» antes de escribir, la conversación partía con las reglas de «Preguntar siempre» (preguntaba antes de editar en vez de no editar). Se corregía solo al cambiar de modo.
- **Una carpeta de confianza ya no vuelve a preguntar por un archivo que crea el propio motor.** Al reabrir una carpeta con complementos salía «Esta carpeta trae algo nuevo: package.json». El primer diálogo de confianza lo sigue mostrando.
- **Overdrive y Tareas ya no llenan el registro con un rechazo repetido** al consultar los trabajos de fondo. No se veía en pantalla.

### Lo que todavía no está cerrado

- **Si alguien con acceso a una carpeta ya confiada cambia los complementos instalados**, la app ya no vuelve a preguntar por eso.
- **Los pendientes de la 1.8.13 siguen igual.**

## [1.8.13] - 2026-11-09

### Code: planear con un modelo y hacer con otro

- **Puedes elegir un modelo para «Planear» y otro para «Hacer»** (Ajustes › Modelos). Por ejemplo, uno más fuerte para pensar el plan y uno más barato para ejecutarlo, aunque sean de servicios distintos. Si lo dejas vacío, se usa el modelo de la conversación.
- **La conversación muestra qué modelo se está usando en cada paso**, y avisa si tuvo que usar otro.

### Tablero de ayudantes

- **Nuevo tablero en Code** con los ayudantes de la conversación: qué está haciendo cada uno, en qué estado está, con qué modelo y cuánto lleva gastado.
- **Puedes detener un ayudante o todos**, y abrir lo que conversó cada uno.

### Permisos más claros

- **Después de «Solo explorar», los ayudantes ya pueden editar** cuando cambias de modo en la misma conversación. Antes quedaban bloqueados hasta abrir una conversación nueva.
- **Lo que niegas en la configuración queda negado en todos los modos**, también en «Todo sin preguntar» y también para los ayudantes.
- **Cuando un ayudante no puede arrancar, la tarjeta dice por qué** y qué hacer.

### Carpetas de confianza

- **El motor ya no carga nada de una carpeta hasta que confías en ella**: ni conectores, ni complementos, ni ayudantes, ni comandos propios. Antes eso lo cuidaba solo la app.
- **El diálogo de confianza muestra el comando completo** que arranca cada conector (por ejemplo `npx -y @acme/mcp`), con las claves y direcciones tapadas.

### Modelo de respaldo

- **Nueva sección en Ajustes › Modelos**: elige hasta 3 modelos gratis para seguir cuando el principal se queda sin cuota. Usar otro servicio como respaldo viene apagado, porque envía la conversación a ese servicio.
- **La conversación avisa** cuando un turno se hizo con el modelo de respaldo.

### Motor nuevo (lazunox.16)

- **Cada paso gasta menos**: la parte fija de cada pedido al modelo (instrucciones y herramientas) bajó cerca de un 20 % en nuestras mediciones, sin quitar herramientas.

### Lo que todavía no está cerrado

- **El ahorro se midió con un modelo de prueba.** No medimos todavía si algún modelo real usa peor una herramienta con las descripciones más cortas.
- **Tareas, Overdrive, Rutinas, Comparar, el celular y Telegram siguen sin diálogo de confianza**: la app declara esas carpetas como confiables por ti, igual que en la 1.8.12.
- **Ajustes › Ayudantes con una carpeta que nunca abriste** solo avisa que no es de confianza; para confiar hay que abrirla en Code.
- **Un árbol de trabajo de Git hecho a mano** fuera de la carpeta que crea Lazunox hay que abrirlo y confiarlo aparte.
- **Los pendientes de la 1.8.12 que no se nombran arriba siguen igual** (repositorio Git «desnudo» falso, `cmd.exe` y `git.bat` en Windows).

## [1.8.12] - 2026-11-09

### Code pregunta más antes de ejecutar cosas

- **«Automático» ya no corre las pruebas del proyecto sin preguntar**: `npm test`, `npm run …` y similares muestran la tarjeta «¿Permitir?» como cualquier otro comando. Puedes marcar «Permitir siempre» en esa carpeta. Los comandos de solo lectura (`ls`, `git status`…) se siguen aprobando solos. Lo mismo vale en «Comparar».
- **«Solo explorar» pregunta antes de abrir una página web o buscar en internet.**
- **`opencode.json` del proyecto** (donde se configura el motor) pregunta antes de editarse en «Editar sin preguntar» y «Automático», y el motor nuevo lo protege en todos los modos.
- **Git más cuidadoso**: el motor nuevo no ejecuta ayudantes de Git que una carpeta ajena podría traer escondidos.

### Carpetas de confianza

- **El diálogo de confianza dice qué trae la carpeta** (conectores y el programa que arrancan, complementos, ayudantes y comandos propios) cuando la abres por primera vez. Si una carpeta que ya confiaste empieza a traer algo nuevo, vuelve a preguntar.
- **Las herramientas de un conector que trae la carpeta preguntan antes de usarse.**

### Ayudantes y ganchos

- **En Code los ayudantes ya pueden editar archivos.** Antes el ayudante «general» quedaba bloqueado. Ahora corre, pero pregunta antes de editar, ejecutar comandos o usar la web, aunque la conversación principal no pregunte.
- **Los ayudantes que trae la app usan el modelo de la conversación** en vez de uno fijo.
- **Ganchos con los 14 eventos** que el motor sabe ejecutar (antes solo 5). El motor se niega a ejecutar ganchos si el archivo cambió sin pasar por la pantalla.

### Búsqueda web y sugerencias

- **La búsqueda web funciona con cualquier IA** (Anthropic, OpenAI, OpenRouter, Ollama…), no solo con OpenCode Zen/Go. Usa el buscador Exa, así que las búsquedas salen a ese servicio. Es un ajuste que tú controlas.
- **Sugerencia en la tarjeta de permiso**: una IA pequeña puede sugerir «permitir, porque…». Nunca decide sola.
- **Política de empresa** también para el motor de Code (archivo de administrador).

### Motor nuevo (lazunox.15)

- **`AGENTS.md` muy grande**: el motor lee como máximo 32 KB de cada uno, para no gastar tu contexto.
- **Modelo de respaldo**: si el modelo gratis se queda sin cuota, el motor puede seguir con otro de la lista de respaldo. La pantalla para elegirlo llega en la próxima versión.

### Lo que todavía no está cerrado

- **Un repositorio Git «desnudo» falso** dentro de una carpeta puede seguir engañando a un `git status` aprobado solo en «Automático». El motor nuevo lo endurece; no lo damos por cerrado hasta probarlo más.
- **Si confías en una carpeta, los conectores y complementos que trae se arrancan** (eso es lo que significa confiar). Las herramientas de un conector preguntan antes de usarse. Al abrir la app, una carpeta que ya tenías abierta se revisa primero: si trae algo nuevo, o no se pudo revisar, sale el aviso y no se carga nada hasta que decidas; «Cancelar» la cierra.
- **Sin diálogo de confianza** en Tareas, Overdrive, Telegram, el celular, Rutinas y Comparar: ahí rigen las mismas preguntas de permiso, pero la carpeta no se revisa antes.
- En Windows, `cmd.exe` y `git.bat` no tienen aún el mismo cuidado que PowerShell.
- **Después de usar «Solo explorar» en una conversación,** los ayudantes pueden quedarse sin poder editar aunque vuelvas a «Hacer» y «Automático»: el motor conserva ese bloqueo en esa conversación. La app ahora te avisa sobre el cuadro de escribir («Esta conversación pasó por Solo explorar… abre una conversación nueva»). Arreglarlo de fondo pide cambiar el motor y queda para la próxima versión. Es más estricto, no más laxo.
- Si un ayudante queda bloqueado, la tarjeta sigue sin explicar el motivo (solo un icono rojo).
- **Cambiar un Ajuste que reinicia el motor mientras un proyecto de Code recién cerrado sigue con un turno en marcha** puede cortarlo si pasa 2 minutos sin escribir. La 1.8.11 lo evitaba; a cambio, ya no se tocan carpetas en las que no confiaste.
- En «Comparar», las columnas canceladas o descartadas pueden seguir mostrando los botones «Permitir una vez / Rechazar» (no hacen nada).
- «Permitir siempre» a una página web deja pasar las siguientes durante esa misma sesión, aunque no se guarda para la próxima.

## [1.8.11] - 2026-11-06

### Documentos también en Code

- **Code crea Word, Excel, PowerPoint y PDF**: el agente de Code usa la misma herramienta de documentos que el Chat y Overdrive, con las mismas guías de diseño. Solo trabaja dentro de las carpetas de tus proyectos, pide tu permiso antes de crear y, en modo Plan, no crea nada.
- **Revisión más fina de lo que se entrega**: antes de dar un documento por bueno, se revisan más detalles de Word (títulos, párrafos larguísimos, listas), PowerPoint (títulos repetidos, láminas cargadas), Excel (porcentajes mal escritos, hojas vacías) y PDF.
- **Traducir Excel**: además de PDF, la tarjeta de traducción del Chat acepta hojas de Excel.

### Todo se instala solo

- **Sin preguntar**: ArtCraft (el diseñador de documentos) se descarga solo en segundo plano, en Mac y en Windows; en Mac también Node.js y uv, que usan los conectores locales de correo y calendario. Puedes usar la app mientras tanto; abajo a la izquierda se ve «Preparando herramientas…». Si falla la red, reintenta sola. Cada descarga se verifica antes de usarla.
- **Windows**: el entorno aislado de Overdrive también se prepara solo y no necesita administrador. Si Windows pide activar WSL o reiniciar, Overdrive te explica cómo.
- **Equipos lentos**: si la revisión de arranque tarda, la instalación automática empieza igual cuando termina, sin molestarte.
- **Solo lo que el sistema exige**: la pantalla «Preparando Lazunox» ya no aparece por esas piezas; queda solo para lo que macOS o Windows piden aprobar a una persona, y sus textos dicen lo que realmente pasa.

### Windows, a la par del Mac

- **Traducir PDF y editar documentos en Windows**: Windows incluye ahora su propio Python, así que traducir PDF y Excel y editar Word, Excel y PowerPoint funcionan igual que en Mac, sin instalar nada.
- **Textos de Windows**: en Windows ya no se habla de «Mac», Finder ni Llavero, ni en la app ni en la app del celular: antes de conectar dice «tu computador» y, una vez conectada, sabe si es Mac o PC.
- **Overdrive abierto como administrador**: si abres Lazunox como administrador, la tarjeta de Overdrive lo explica en simple («Ciérralo y ábrelo de forma normal») en vez de un «no disponible» confuso.
- **Cerrar la ventana con el acceso desde el celular activo**: la app queda viva en la bandeja, como en Mac.
- **Descargas del navegador integrado**: Windows las marca como «descargadas de Internet» para que SmartScreen las revise.
- **Servidores locales y comandos en segundo plano**: ya no usan rutas de Mac en Windows.
- **Diagnóstico**: avisa si falta Git para Windows.
- **Vista previa de Word (.docx)** de lo que entrega Overdrive en Windows.
- **Control del PC**: guía de oficina para Windows.

## [1.8.10] - 2026-11-06

### Traducir documentos, mucho mejor (macOS)

- **Los PDF escaneados ya se traducen**: si el PDF es una foto con texto reconocido por OCR, la traducción tapa el idioma original de la foto y escribe encima. Antes quedaban los dos idiomas apilados e ilegibles.
- **La IA mira cada hoja escaneada** (con un modelo que lee imágenes) y corrige errores evidentes del reconocimiento, sin inventar texto.
- **Traducción más consistente**: antes de empezar, la IA arma una ficha del documento y un glosario fijo (por ejemplo «Asegurado», «Póliza»), y cada tanda usa los términos que le corresponden.
- **Versión limpia de un escaneo (opcional)**: además del PDF fiel, se crea un PDF nuevo con el texto traducido, ordenado y editable, sin la foto del original.
- **Avisos antes de entregar**: si una cifra, fecha o importe cambió, o una traducción quedó sospechosamente corta o larga, el informe lo marca.
- **Dentro de la conversación**: en el Chat, la traducción es una tarjeta sobre el cuadro de escribir (progreso, cancelar, abrir, guardar), sin ventana aparte, y puedes seguir escribiendo. En Tareas y Code, el agente traduce siguiendo la misma guía, también con escaneos.

### Correcciones

- **Letra pareja en los escaneos**: un párrafo ya no sale mucho más grande que los demás de la misma hoja.
- **Fuentes incorporadas**: la traducción de PDF ya no depende de las fuentes instaladas en el equipo; cubre español, ñ, ¿, ¡ y comillas.

## [1.8.9] - 2026-11-06

### Primera vez más simple

- **Un solo recorrido**: Bienvenida → «Aceptar todo e instalar» → Permisos → Conectar IA. Lo necesario se descarga de una vez.
- **Permisos de macOS que sí se reconocen**: la pantalla «Preparando Lazunox» ya no dice «Pendiente» aunque estén dados. Si macOS no registra Grabación de pantalla sola, «Mostrar Lazunox» abre el panel y te muestra la app para agregarla.
- **Confiar en la firma de Lazunox (opcional)**: un paso con tu contraseña de Mac que hace que macOS recuerde los permisos entre versiones.

### Documentos de mejor calidad

- **Word, Excel, PowerPoint y PDF más cuidados**: la IA sigue guías de diseño por formato, revisa el resultado y ya no entrega presentaciones con textos «pendientes» ni letra diminuta.
- **PDF con imágenes** y revisión de los PDF generados con script.

### Correcciones

- **Panel derecho**: ya no se queda negro ni pegado al cambiar de chat, y las tarjetas de «Listo» no se cortan.
- **Indicador «Pensando»** ya no tapa la esquina superior derecha, y el medidor de **Contexto** muestra datos reales.
- **Tareas**: si marcas «No permitir» al agregar una carpeta, ahora puedes usar «Volver a preguntar a macOS» (antes no pasaba nada).

## [1.8.8] - 2026-11-04

### Tareas: revisión a la vista y arreglos de uso

- **Revisión en la tarjeta del archivo**: cada Word, Excel o PowerPoint entregado muestra «Revisado ✔», «N avisos ✘» o «Sin revisar», con la lista al desplegar.
- **Terminado con avisos**: si el plan quedó incompleto o falta el archivo pedido, la tarea ya no queda en verde sino en ámbar.
- **La IA ve el documento sin ArtCraft**: un Word o una presentación se muestra a la IA con el visor de la propia app cuando ArtCraft no está instalado o falla, y la IA sabe que es una vista simplificada.
- **Pasos con nombres claros**: «Creando / Creó el documento» y «Mirando / Miró el documento», y el aviso de ArtCraft señala la ruta correcta de Ajustes.

### Correcciones

- **Menú «⋯» de la tarea**: siempre se puede pulsar, también con el panel abierto y con la ventana angosta.
- **Tablas del Chat**: ya no se parten letra por letra; aparece el desplazamiento horizontal.
- **Visor de Word**: la hoja ya no se corta por la izquierda y se abre ajustada al ancho.

## [1.8.7] - 2026-11-03

### Documentos de Office mejor revisados

- **Revisión de calidad antes de entregar**: cuando una Tarea crea un Word, un Excel o un PowerPoint, la app lo revisa sola (títulos con estilo, viñetas reales, totales con fórmula, portada con subtítulo…) y muestra una lista ✔/✘. Si algo no se pudo revisar (por ejemplo un PDF), lo dice en vez de darlo por bueno. La revisión es local y gratuita, en macOS y en Windows.
- **«Cómo se verificó»**: el resumen final de una Tarea dice qué comando o lectura respalda cada cifra o afirmación, y solo cita revisiones que de verdad se corrieron.
- **Presentaciones con títulos de verdad**: cada diapositiva lleva su título como título real de PowerPoint (sirve para el esquema, la navegación y los lectores de pantalla) sin cambiar el aspecto, y el subtítulo de la portada ya no se pierde, también cuando ArtCraft no está instalado.
- **El documento se abre solo al terminar**: al acabar una Tarea, el visor abre el entregable principal (Word, Excel, PowerPoint o PDF) aunque lo haya creado un script. Si lo cierras, no vuelve a abrirse.

### Correcciones

- **Pasos de las Tareas**: borrar, mover, copiar o abrir un archivo de Office ya no aparece como «Creó el documento…», aunque después se compruebe el resultado en la misma orden; revisarlo con las herramientas de las skills aparece como «Revisó».
- **Windows**: el aviso de ArtCraft dentro del entorno aislado ya no te pide instalarlo cuando ya está instalado.
- **Reporte de fallos**: plantillas para avisar de un fallo o proponer una mejora en GitHub, y la lista de lo que sale de tu equipo quedó completa en el README y en la página.

## [1.8.6] - 2026-11-01

### Lectura sobre el vidrio

- **Barra lateral y Ajustes con vidrio, más legibles en Windows y en macOS**: con el tema oscuro y una ventana blanca detrás (o el claro sobre una oscura), los textos secundarios («Buscar…», las ayudas, las etiquetas) y las insignias de estado quedaban entre 2,4 y 4,4 de contraste. Se midieron con capturas reales en las dos plataformas y ahora llegan a 4,5 o más. El vidrio sigue dejando ver el color del fondo.
- **Windows, Diagnóstico**: ya no avisa de la herramienta de teclado remoto ni del Python incluido (solo existen en macOS), así que el estado no queda en ámbar por eso.
- **Tarjeta de documento**: «1 hoja» y «1 diapositiva» en singular.

### Correcciones

- **Instalaciones y pruebas**: ajustes internos para que las comprobaciones automáticas de GitHub pasen (formato y pruebas que asumían un sistema Unix). Sin cambios para quien usa la app.

## [1.8.5] - 2026-11-01

### Correcciones

- **Windows, Diagnóstico**: ya no muestra como fallo la Accesibilidad ni la Grabación de pantalla (son permisos de macOS que en Windows no existen) ni la insignia roja «Falta algo importante» por eso.
- **Pantallas con escala alta o ventanas bajas**: el saludo del inicio ya no queda cortado por arriba y la barra de iconos se puede recorrer hasta Ajustes; en ventanas muy bajas sus botones son un poco más chicos para que quepa.
- **Primer arranque**: si dejas «Preparando» para más tarde, la bienvenida ya no vuelve a pedirte lo mismo; lo puedes instalar después desde Ajustes.
- **Servidores locales de conectores**: un mensaje demasiado grande ahora recibe su aviso de error en lugar de cortar la conexión (en Windows se veía como un fallo de red).

## [1.8.4] - 2026-10-31

### Barra lateral de vidrio y Ajustes nuevos

- **Barra lateral de vidrio**: nuevo ajuste «Barra lateral» (Sólida, Vidrio suave, Vidrio) en Ajustes > General. Deja ver un poco de tu escritorio detrás de la barra lateral y de Ajustes (en macOS con el material del sistema; en Windows 11 con Mica o Acrylic). Las conversaciones siguen sobre fondo sólido. Si tu sistema pide menos transparencia, o no lo permite, queda sólida.
- **Ajustes rediseñados con vidrio**: pestañas por grupo arriba y secciones debajo; General en rejilla, las secciones largas en lista limpia y Uso, Conectores, Importar y Celular en tarjetas. Con la barra sólida y en el celular se conserva el menú lateral de siempre.
- **Contenido como tarjeta flotante**, con más separación entre la barra lateral y la zona de trabajo; en macOS el riel es más ancho para que no se corten los botones de cerrar, minimizar y maximizar.
- **Windows**: los botones de ventana son transparentes con el vidrio y se repintan al cambiar el tema o la barra lateral.
- **Contraste**: textos y botones de Ajustes se midieron sobre fondos claros, oscuros y de colores (mínimo 4,5:1 en ambos temas). Se corrigió el texto gris sobre los botones de acción («Agregar conector», «Activar», «Instalar») y los estados «Conectado» y «Permitido» en tema claro.

### Correcciones

- **Cambios (Code)**: al borrarse un archivo fuera de la app, el panel ya no pide el contenido de un archivo que no existe.
- **Formularios de conectores**: el botón «No enviar» ya no se pierde cuando el aviso de «obligatorio» mueve el diseño al hacer clic.
- **Vista previa de PDF**: ajuste interno para pdf.js 6 (sin cambios visibles).

## [1.8.3] - 2026-10-29

### Ficha del proyecto (Overdrive y Code)

- **Ficha del proyecto**: tarjeta en el panel derecho de Overdrive y en el panel «Resumen» de Code, con nombre, carpeta, nivel de acceso de la IA (Aislado, Con comandos aprobados, Control total; en Code, sin Control total) y Bóveda de variables. El engranaje abre el modal: nombre, carpetas (en Overdrive, «Añadir» y quitar carpetas vinculadas con su modo), acceso en un selector de tres tramos y Bóveda.
- **Bóveda de variables**: pega formato `.env` por proyecto. Los valores se guardan cifrados con el almacén seguro del sistema (sin cifrado no se guarda nada), no vuelven nunca a la pantalla, llegan solo a los comandos que apruebas con `equipo_ejecutar` en ese proyecto y se tapan (`«NOMBRE»`) en lo que vuelve a la IA, a la auditoría y a las respuestas. Nombres que alteran cómo arrancan los programas (`PATH`, `LD_*`, `NODE_OPTIONS`…) no se aceptan.
- **Acceso «Aislado»**: la carpeta deja de recibir la herramienta de comandos del equipo; se aplica ya relanzando el servidor si está ocioso.
- **Panel derecho de Overdrive en tarjetas** (Ficha, Plan, Contexto, y el resto igual). El «Entorno» de la cabecera abre la Ficha.
- **Añadir otra carpeta en Code**: la Ficha de un proyecto de Code ya permite «Añadir» carpetas (lectura y escritura, o solo lectura). La IA entra a ellas sin tarjeta de permiso; el resto de lo externo sigue preguntando. Se validan en la app (no se aceptan raíces, la carpeta personal entera, carpetas del sistema, claves, el estado interno de la app ni carpetas dentro o por encima del proyecto; máximo 10).
- **Conectores externos en Overdrive**: los conectores definidos en la config global de OpenCode («Config externa») ahora tienen su interruptor «Disponible en Overdrive» y «Preguntar en cada uso». Los remotos con clave pasan por el mismo proxy de la app: la IA y el sandbox nunca ven la cabecera. La app solo lee esa config, nunca la modifica.
- **Barra de Code**: los paneles en una cápsula y todo lo demás (Ficha, vista del trabajo, memoria, exportar, bifurcar, compactar) en el menú «⋯».
- Canales `project:*` y `tasks:access:apply`: prohibidos desde el celular (clase X). Sin cambios en zonas intocables.

### Contexto detallado y motor nuevo

- **Desglose del contexto, como el `/context` de Claude Code**: en la tarjeta «Contexto» del panel derecho (Code y Overdrive) el botón «Ver desglose» abre una barra apilada y una tabla con los tokens y el % de cada parte: mensajes, instrucciones y herramientas del sistema, herramientas e instrucciones de MCP, skills, archivos de memoria, reserva de autocompactado y espacio libre. Las listas de herramientas MCP y de archivos de memoria se despliegan. Lo estimado lleva «≈»; el total usado es exacto. El medidor del compositor sigue corto para no tapar la conversación.
- **Motor lazunox.14**: calcula ese desglose (nuevo punto `contexto-fijo`) y entrega la ventana real del modelo. Con un motor anterior la app sigue mostrando la barra simple.

### Novedades

- **Las Tareas (Overdrive) hacen presentaciones, Word, Excel y PDF con el mismo motor y la misma guía de diseño que el Chat, también en Windows.** Antes el Chat daba mejores resultados y en Windows las Tareas caían a un diseño sobrio de respaldo (el Linux aislado donde corren no tiene Node ni el diseñador de documentos). Ahora la propia app arma el archivo con el mismo motor del Chat (herramienta nueva `documentos`, que solo crea archivos NUEVOS dentro de la carpeta de la tarea y nunca pisa uno existente) y la IA puede mirar cómo quedaron las diapositivas y las páginas antes de entregarlas. Code usa el mismo motor mediante los scripts de las skills (necesita Node, que se instala desde Ajustes). Ahora el diseño se inventa distinto cada vez (sin plantilla fija) y, al pedir una presentación, la IA pregunta si la quieres editable (.pptx) o en HTML.
- **Traducir Word, Excel y PDF conservando el diseño**, también desde las Tareas.
- **Si el proveedor de la IA rechaza o reintenta** (por ejemplo «Se acabó el uso gratuito»), ahora se ve el motivo y qué hacer, en lugar de un «Pensando…» que no termina (Tareas, Chat y Code).
- **Control de apps más honesto:** la IA lee de vuelta lo que escribió en el campo, y cuando no se ve ningún cambio en pantalla lo informa como «sin comprobar» en vez de dar por hecho que funcionó. Si pulsa algo desactivado, recibe el motivo y qué probar.
- **Capturas sin repetir** y texto saneado antes de teclear.

### Correcciones

- **Windows: letras cambiadas o perdidas al teclear en apps lentas** («29 de» salía «eee»). Ahora hay un ritmo mínimo entre caracteres y la lectura de vuelta no confirma un texto distinto del pedido.
- **Windows: rechazo falso al pedir «Bloc de notas» cuando la app es `Notepad.exe`.** Ahora se compara la identidad real de la app, no el nombre escrito.
- **Pruebas automáticas que movían tus apps** (Finder, Safari…) al ejecutarse en el Mac: ya no usan el ayudante real.

### Qué no cambia / límites

- **La vista previa en imágenes solo existe para PowerPoint y Word.** Para Excel y PDF la IA revisa el contenido, pero no ve una imagen.
- **El modo Code no se probó en vivo con la IA** con estas habilidades (comparte las de las Tareas, cubiertas por pruebas automáticas). La ruta HTML y la traducción de Excel y PDF se probaron con el modelo de pago solo en el Mac.
- **No se vio ningún resultado abierto en PowerPoint real**: se revisaron renderizados con el propio motor. El ritmo nuevo al teclear solo se verificó en el Bloc de notas.
- **Al abrir por primera vez, macOS puede pedir la contraseña del llavero** («Lazunox Safe Storage»); elige «Permitir siempre».
- Motor `lazunox.13`, sin cambios.

## [1.8.2] - 2026-10-28

### Novedades

- **Un permiso por app basta para manejarla.** En Overdrive, si en la tarjeta le das «Ver y clic» o «Control total» a una app, la IA puede usar el ratón y el teclado reales sobre ESA app, sin pedirte una segunda tarjeta. Sigue acotado: solo sobre apps concedidas, teclear y pulsar teclas exigen «Control total», «Solo ver» nunca da ratón, y Detener lo quita.
- **La IA pide el nivel justo.** Para mirar pide «Solo ver»; para manejar una app (cambiar una canción, teclear, abrir) pide «Control total» solo de esa app. Si le pides control de todo el equipo, o la tarea lo necesita de verdad, te muestra el botón para pasar a «El computador completo» y confirmas tú. Antes, por un error nuestro, la IA no sabía ofrecer ese botón y se enredaba.
- **Clic en cualquier monitor.** La app que quieres manejar puede estar en otra pantalla: la IA mira la ventana con una captura y hace clic sobre esa imagen. Antes fallaba con «Coordenadas fuera de la pantalla».
- **Windows: el helper nuevo** ya permite clics en monitores que no son el principal, y informa dónde está la ventana capturada.

### Correcciones

- **El Finder y el Explorador no se manejan con el ratón y el teclado reales con el permiso de una app.** Desde ahí se podría abrir un archivo y ejecutarlo fuera del aislamiento; para eso sigue haciendo falta la tarjeta explícita de «tomar el control».
- **Traer una app al frente exige «Control total» de esa app.** Con menos, se abre en segundo plano.
- **Atajos del sistema bloqueados** (los que llevan el foco a los menús de la barra de menús o activan VoiceOver).
- **Si dos ventanas de la misma app miden lo mismo, la IA no hace clic a ciegas en una**, y una captura que falla ya no deja vigente la anterior.

### Qué no cambia / límites

- **El caso de varios monitores solo se probó con pruebas automáticas (helper falso).** En un Windows real se probó el clic con un solo monitor. No se ha visto con un segundo monitor de verdad.
- **Las pruebas en Rust de los monitores del helper de Windows no se han ejecutado** (solo compilan). Una prueba de contrato del helper que ya fallaba antes sigue fallando.
- **No se probó con una IA real en el Mac** (el modelo gratuito no respondía); sí con OpenCode Go en Windows.
- Motor `lazunox.13`, sin cambios. El apagador sigue igual: `LAZUNOX_UNIFIED_APPS=0` (en Windows también `LAZUNOX_UNIFIED_APPS_WIN=0`).

## [1.8.1] - 2026-10-28

### Correcciones

- **«Detener» en un chat aislado ahora deja el control detenido.** Si la IA estaba usando apps de tu equipo, Detener corta la tarea, revoca los permisos de esa sesión y muestra «Control detenido» con el botón «Reanudar control». Si el chat nunca usó apps, Detener sigue siendo solo cortar la tarea.
- **Al abrir la app ya no falla con una carpeta de chat que se borró.** Antes, si la última carpeta de chat usada ya no existía en el disco (por ejemplo, una vacía que la limpieza automática borró), el chat nuevo terminaba en «No se pudo comprobar que la carpeta esté libre de enlaces» y «El servidor de las tareas no está listo». Ahora esa carpeta simplemente no se ofrece y se crea otra.

### Novedades

- **En Windows, el permiso de Control del PC se puede activar desde el chat.** Si la IA pide una app y Control del PC no está activado, aparece en el propio chat la misma tarjeta de Ajustes (con su casilla «Entiendo» y su botón que se arma unos instantes después), y al activarlo te avisa que vuelvas a pedirle lo que querías.
- Motor `lazunox.13`, sin cambios.

### Qué no cambia / límites

- **La tarjeta de consentimiento en el chat se probó con pruebas automáticas, no se vio funcionando en la app real de Windows** (el perfil de prueba ya tenía el permiso dado).
- **El apagador sigue igual:** `LAZUNOX_UNIFIED_APPS=0` (en Windows también `LAZUNOX_UNIFIED_APPS_WIN=0`) devuelve todo a como era en la 1.7.9.

## [1.8.0] - 2026-10-28

### Novedades

- **Un solo chat para todo.** Escribes lo que quieres y la IA pide las apps que necesita, una por una, con la tarjeta de permiso (logo real de la app, motivo y nivel: «Solo ver», «Ver y clic» o «Control total», que eliges tú). Ya no hace falta elegir un modo antes de empezar ni armar un plan obligatorio.
- **Aislado por defecto.** Cada chat trabaja dentro del aislamiento de «Una carpeta»: sin carpeta elegida, Lazunox crea una propia para ese chat en `Lazunox/Chats`, y un chat no puede ver las carpetas de los otros. «Avanzado: sin aislamiento» sigue existiendo y pide tu consentimiento.
- **Historial unificado.** La barra lateral muestra todos tus chats, estén en la carpeta que estén, y vuelven a aparecer tras reiniciar la app. «Seguir en otra carpeta» abre un chat nuevo en la carpeta que elijas y deja el anterior intacto.
- **Funciona en Mac y en Windows.** En Windows el chat aislado corre dentro del entorno aislado de Tareas (WSL) y necesita Control del PC activado y Lazunox sin permisos de administrador; si falta algo, todo queda como en la 1.7.
- **Limpieza automática.** Las carpetas de chat vacías de más de un día se borran solas (solo si están vacías).
- **Bloc de notas, Paint y Calculadora** muestran su icono real en la tarjeta de Windows, y el aviso de la pantalla dice «Control del PC».
- Motor `lazunox.13`, sin cambios.

### Qué no cambia / límites

- **Se apaga con una variable** si algo no te sirve: `LAZUNOX_UNIFIED_APPS=0` (en Windows también `LAZUNOX_UNIFIED_APPS_WIN=0`). Apagado, todo funciona como en la 1.7.9.
- **En este modo la IA nunca ve la pantalla completa**, solo la ventana de la app que concediste.
- **En Windows, el permiso de Control del PC se activa en Ajustes**, no desde el propio chat.
- **El botón Detener de un chat aislado corta la tarea, pero no deja el control en «detenido»** como en el modo avanzado.
- **Entre dos sesiones del mismo servidor aislado** la validación de la sesión es más débil que entre chats distintos.
- Probado con una IA real en Mac y en el PC con Windows (tarjeta, denegar, tres chats a la vez).

## [1.7.9] - 2026-10-27

### Novedades

- **Pantalla de inicio de Overdrive más simple.** Ahora hay un solo selector con dos opciones, «Una carpeta» y «El computador completo», en vez de varias pantallas distintas.
- **Tarjeta de permiso por app.** Cuando la IA necesita usar una app, la tarjeta muestra el logo real de la app, el motivo, el plan de lo que va a hacer y el nivel que pide: «Solo ver», «Ver y clic» o «Control total». El nivel nunca viene elegido solo: lo eliges tú. Los botones son «Denegar» y «Aprobar y empezar». «Permitir para esta sesión» vale solo mientras dura la tarea y no se guarda.
- **Bloquear una app.** Cada app de la tarjeta tiene «Bloquear siempre». En Ajustes hay una lista «Bloqueadas por ti» con el botón «Quitar», una lista de apps sugeridas para bloquear (carteras y brokers) y la lista de apps bloqueadas por seguridad, con candado, que no se pueden cambiar. Cada aviso de bloqueo dice quién la bloqueó, por qué y cómo desbloquearla.
- **El agente puede pedir una app o mostrarte su carpeta desde el modo carpeta.** Si trabajas en una carpeta y la IA necesita otra app, te lo pide con la tarjeta de permiso; también puede abrirte su carpeta de trabajo. Y cuando algo no se puede borrar, ahora dice dónde está el permiso de borrar.
- **En Windows, los textos dicen «PC»** en vez de «Mac» o «computador» donde corresponde.
- Motor `lazunox.13`, sin cambios.

### Correcciones

- **Los marcadores internos `[[LAZUNOX:…]]` ya no se ven en el mensaje.** Antes, en ciertos casos, el texto técnico con que la IA pide una app o una carpeta aparecía a la vista.
- **La tarjeta ya no dice «segundo plano» cuando la IA usa el ratón y el teclado reales.** Ahora avisa que se moverán el ratón y el teclado de verdad.
- **«Bloquear siempre» y «Denegar» ahora avisan al instante.** El aviso dice quién bloqueó la app y cómo desbloquearla, y la IA recibe el mensaje de bloqueo. Antes la IA recibía «denegado» y ofrecía volver a pedir la aprobación.

### Qué no cambia / límites

- **La tarjeta de permiso no se probó en Windows con una IA real.** En Windows solo se comprobó la instalación y las pruebas automáticas; en el Mac sí se probó con una IA real y con pruebas de extremo a extremo.
- **El logo de las apps de la tienda de Windows (UWP) no se muestra** todavía; en esos casos la tarjeta usa el nombre en texto.
- **La tarjeta de «toma de control» sin plan mantiene el diseño anterior.**
- **Bloquear una app impide controlarla con el ratón, el teclado y la pantalla, pero no impide un plan de comandos que tú apruebes.** Si apruebas un plan que ejecuta comandos, esos comandos pueden abrir o manejar esa app.
- **En macOS, el nombre de algunas apps en los avisos sale en inglés.**
- **Los logos todavía no aparecen en las listas de Ajustes** (bloqueadas por ti, sugeridas y bloqueadas por seguridad).
- El motor sigue en `lazunox.13`, sin cambios.

## [1.7.8] - 2026-10-27

### Novedades

- **Incluye todo lo de la 1.7.7**, que no llegó a publicarse por separado (las tres pantallas nuevas de Code, «ya revertido» y las correcciones de «Revisar cambios»; el detalle está en la sección de la 1.7.7, más abajo en este archivo).
- **Editar archivos sin perder datos.** Antes, si la IA editaba un archivo que no estaba en UTF-8 (por ejemplo, con acentos guardados en Latin-1) o que mezclaba finales de línea de Windows y de Mac/Linux, el archivo podía quedar con caracteres dañados o con los saltos de línea cambiados. Ahora el motor se niega a reescribir lo que no puede leer entero, conserva los finales de línea originales y no deforma los acentos. Lo comprobamos con pruebas del propio motor y con tareas de banco con un modelo simulado; con un modelo real el banco no mostró diferencia en cuántas tareas terminan bien.
- **Permisos más seguros en la terminal.** El motor revisa con más cuidado las órdenes compuestas (varias órdenes unidas, sustituciones, redirecciones). Solo puede resultar en más preguntas o más negativas que antes, nunca en menos. Hay dos casos conocidos que todavía no cubre (una orden metida con `<<<` y consultar si existe una orden prohibida).
- **Ver y quitar los «siempre» guardados.** En Ajustes › Funciones experimentales hay un bloque nuevo para ver, por carpeta reciente, qué órdenes marcaste con «Siempre permitir» y quitarlas una por una. Antes solo se podía «Olvidar todos». Necesita el motor nuevo; con uno anterior la pantalla lo dice. Desde el celular no se ven ni se quitan.
- **Varias lecturas a la vez, escrituras en orden.** Cuando la IA pide leer o buscar varias cosas, se hacen juntas; lo que cambia archivos o ejecuta órdenes sigue yendo de una en una, en orden.
- **Menos tropiezos con las herramientas.** Si el modelo manda un dato con el tipo equivocado (por ejemplo, un número escrito como texto), el motor lo corrige en vez de fallar. Si la respuesta se corta por el límite de salida del modelo, se retoma en vez de dejar la herramienta a medias.
- **Instrucciones y compactación más firmes.** Los archivos de instrucciones (`AGENTS.md`, `LAZUNOX.md`) pueden incluir otros con `@archivo`; cuando una instrucción cambia a mitad de una conversación, la IA recibe solo la diferencia; y al compactar no se pierden las instrucciones vigentes.
- **Resultados de conectores con imágenes o archivos.** Lo que un conector devuelve como imagen o binario grande se guarda en un archivo y la IA recibe la ruta, en vez de meter todo en la conversación.
- **Credenciales enmascaradas.** Las claves que aparecen en la salida de comandos se ocultan al mostrarlas y al guardar la conversación.
- **Ganchos más completos.** Los ganchos del motor pueden depender de una condición y reaccionar si fallan, y hay cuatro eventos nuevos. Se probaron solo con pruebas del motor, y la app todavía no tiene pantalla propia para estos ajustes nuevos.
- **Cuadernos Jupyter.** En carpetas con archivos `.ipynb`, la IA puede editar celdas sin romper el cuaderno.
- Motor `lazunox.13`.

### Qué no cambia

- **No prometemos ahorro de tokens.** Medimos con un modelo real (28 tareas, cinco repeticiones): el gasto cambió un −4 % y quedó dentro del ruido, y el éxito fue prácticamente igual (134 de 140 antes, 132 de 140 con un motor intermedio). La mejora de esta versión es de corrección y de seguridad, no de gasto.
- **No decimos que Lazunox iguale ni supere a otras herramientas.** No pudimos comparar con ellas en igualdad de condiciones; falta esa prueba.
- Siguen **apagados**: los flujos por script (gastaban entre 43 % y 612 % más tokens), las tareas programadas, la limpieza de claves en lo que ve el modelo (puede romper ediciones que citan un secreto), las políticas de la organización y la auto-revisión de permisos. Tampoco hay todavía un espacio de trabajo aparte (worktree) para la conversación principal.

## [1.7.7] - 2026-10-26

### Novedades

- **Tres pantallas nuevas en Code, apagadas por defecto.** «Objetivo» (una condición que la IA debe cumplir y que se comprueba sola, con tope de intentos), «Presupuesto» (límite de tokens, pasos y minutos por conversación) y «Revisar cambios» (un ayudante de solo lectura revisa lo que aún no confirmaste y lista los problemas por archivo y línea, como texto). Son experimentales: se encienden una por una en Ajustes › Funciones experimentales › «Objetivo, presupuesto y revisión (Code)» y entonces aparecen en el menú de la barra de Code. Con el motor oficial de OpenCode no funcionan.
- **«Ya revertido» al volver atrás.** Después de «Volver a antes de este turno», la tarjeta «Cambios de este turno» marca los archivos revertidos en vez de seguir diciendo «nuevo», y no te deja repetir el rebobinado de algo que ya está revertido.
- **Ayudantes: herramientas permitidas.** En Ajustes › Ayudantes puedes limitar a qué herramientas tiene acceso un ayudante tuyo (nunca más de las de la conversación).
- Motor `lazunox.12`.

### Correcciones

- **«Revisar cambios» ya no se corta a los 5 minutos** (la conexión se cerraba antes de que el ayudante terminara) y avisa en la ventana cuando el ayudante está esperando un permiso, que antes quedaba escondido detrás del diálogo. Si rechazas ese permiso, ahora dice que la revisión se interrumpió por eso, en vez de «no se pudo leer el resultado».
- **Revisor y verificador con modos de permisos.** Ya no quedan bloqueados cuando la conversación está en «Preguntar siempre», «Automático» o tras pasar por «Todo sin preguntar»: sus lecturas de git piden permiso como cualquier otra orden, y nunca leen fuera del proyecto sin preguntar.

### Qué no cambia

- No prometemos ahorro de tokens en esta versión: lo medimos con un modelo real y las diferencias quedaron dentro del ruido (en una tarea, con las opciones de ahorro encendidas, pareció salir peor). Por eso esas opciones del motor siguen apagadas y la app no las enciende.
- El motor `lazunox.12` trae además dos funciones apagadas por defecto que la app todavía no ofrece: cambiar a un modelo gratuito cuando el elegido se queda sin cuota o falla, y un ayudante que parte con la conversación copiada.

## [1.7.6] - 2026-10-26

### Novedades

- **Volver atrás en una conversación de Code, turno por turno.** Cada respuesta que cambió archivos muestra una tarjeta «Cambios de este turno» (qué archivos, cuántas líneas) y, si quieres volver a antes de ese turno, un diálogo te deja elegir: código y conversación, solo la conversación o solo el código. Antes de tocar nada te muestra qué se va a restaurar, qué archivos editaste a mano (esos se respetan salvo que tú lo pidas) y si hay commits o ayudantes en marcha. Después puedes «Deshacer». En carpetas sin git, solo se vuelve atrás la conversación y la app lo dice.
- **Compactar mejor.** La tarjeta de compactación te cuenta cuántos mensajes se resumieron y cuánto contexto se liberó, y qué se conservó (plan, habilidades, instrucciones de la carpeta). En Code puedes «Compactar hasta aquí». Ajustes › Ganchos suma el evento «Después de compactar».
- **Ayudantes que se pueden esperar y reanudar.** La IA puede lanzar varios ayudantes y esperarlos con una sola llamada. Si la app se reinicia con ayudantes en marcha, quedan marcados como «perdidos» en «Trabajos en segundo plano» y puedes pulsar «Reanudar».
- **Ayudantes definidos por ti.** Puedes escribir tus propios ayudantes en `.opencode/agents` (o usar los de `.claude/agents` de Claude Code): con herramientas permitidas y prohibidas, un tope de turnos y un modelo pequeño. Nunca pueden hacer más de lo que puede quien los lanza.
- **Gasto de tokens más cuidado.** Salidas muy largas de comandos y lecturas se acotan, los ayudantes devuelven informes cortos, y no se vuelve a leer un archivo que no cambió. (Todavía no medimos cuánto se ahorra con un modelo real; no prometemos un número.)
- **La lista de tareas de la IA gana dos funciones.** Cada tarea puede llevar un comando de comprobación (por ejemplo, correr las pruebas) que se ejecuta pidiendo permiso como cualquier orden, y puede depender de otras tareas. Si la IA marca varias tareas «en curso» a la vez, el motor lo arregla solo en vez de fallar.
- Motor `lazunox.11`.

### Correcciones

- **Seguridad al revertir.** Con el motor anterior, revertir un cambio podía, en ciertos casos raros, borrar o tocar archivos fuera de la carpeta del proyecto. Quedó corregido: ahora solo restaura dentro del proyecto, nunca sigue enlaces hacia afuera, y se detiene sin tocar nada si falta la copia de seguridad en vez de arriesgarse a pisar tus cambios.
- Los informes de los ayudantes ya no pueden hacerse pasar por otro ayudante, y las listas de trabajos se validan.

## [1.7.5] - 2026-10-26

### Novedades

- **Conectar muchos conectores ya no hincha cada conversación.** Antes, la app le enviaba a la IA el detalle de TODAS las herramientas de todos tus conectores en cada mensaje (con Gmail y un par más, miles de palabras); ahora, cuando son muchas, la IA primero busca la que necesita y solo entonces la usa. En una prueba con un conector de 40 herramientas, lo que se envía de ese conector bajó un 95 %. Los permisos son los mismos de siempre: cada herramienta sigue pidiendo tu aprobación por su nombre real, y las reglas que tengas siguen mandando. Está en Ajustes › Funciones experimentales (encendido en Chat y Code).
- **Los conectores pueden pedirte datos con un formulario.** Si un conector necesita que escribas algo (nombre, una fecha, elegir una opción), aparece una tarjeta clara que dice qué conector lo pide, si es de confianza, y que el texto es suyo. Puedes enviar o no enviar, y «Detener» lo cancela. Si el conector pide una contraseña o una clave, la app lo rechaza sin mostrarte nada. Solo en Chat y Code; el celular no los recibe. Se puede apagar en Ajustes › Funciones experimentales.
- Motor `lazunox.9`.

## [1.7.4] - 2026-10-25

### Correcciones

- **La IA responde en tuteo.** Los textos con los que la app le explica su trabajo al asistente estaban escritos en voseo («podés», «querés», «¿Cuál preferís?») y el modelo los copiaba. Ahora están en español neutro, incluida la pregunta que ves al pedir una presentación.
- **«Probar un modelo gratuito» vale para todo.** Al elegirlo en Chat, Code u Overdrive se usa también en los otros modos que aún no tengan un modelo propio; ya no hay que repetirlo ni ves «Aún no conectaste ninguna IA» en otro modo.
- **Comparar modelos:** cada fila muestra el nombre completo al pasar el cursor y deja más sitio al nombre, para distinguir modelos con nombres parecidos.
- Ajustes › Idioma ya no dice que Code, Overdrive y Rutinas siguen en español: están traducidos (English sigue en beta).

## [1.7.3] - 2026-10-25

### Novedades

- **Ganchos de usuario con pantalla.** En Ajustes › Funciones experimentales hay una sección «Ganchos» para quien quiera que la app ejecute un comando suyo antes o después de una herramienta (por ejemplo, bloquear `rm -rf`). Está apagada por defecto, solo usa el archivo que guarda la app, no se aplica dentro del sandbox de Overdrive y avisa que ejecuta comandos con tus permisos.
- **La compactación conserva tu lista de tareas.** Al resumir una conversación larga, el plan que la IA llevaba ya no se pierde.
- **Si se acaba el uso gratuito del modelo, la app lo dice.** Antes se quedaba en «El modelo no responde; reintentando…» sin explicar; ahora te cuenta que el uso gratuito de ese modelo se agotó y que pruebes otro o conectes tu IA.

### Correcciones

- **Detener la respuesta con una tarjeta de permiso abierta** (Esc o «Detener») ahora rechaza esos permisos: antes la tarjeta seguía viva y, si la aprobabas después, la acción se ejecutaba aunque ya hubiera dicho «Detenido».
- Una acción que rechazaste se ve como «No se ejecutó» / «No se hizo», con «Rechazaste esta acción: no se hizo nada», en vez de «Ejecutó» o «Editó».
- El asistente de inicio se puede recorrer con el teclado hasta «Saltar» y «Continuar» (antes Tab daba vueltas entre dos controles).
- Los pasos de espera de comandos y programas se muestran con nombre en llano; los títulos de sesión sin nombre salen en español; el catálogo de conectores ya no deja añadir dos veces el mismo conector; y el texto de Funciones experimentales dice cuáles vienen encendidas.
- Motor `lazunox.8`.

## [1.7.2] - 2026-10-24

### Novedades

- **Tus «Permitir siempre» ahora se recuerdan.** Antes se olvidaban al cerrar la app; ahora se guardan por carpeta de proyecto, en tu equipo, y se vuelven a aplicar la próxima vez. Solo se recuerdan los permisos estrechos (por ejemplo «git log *»): nunca editar archivos, salir de la carpeta, red, ayudantes ni el control del equipo. Está en Ajustes › Funciones experimentales › «Permisos «siempre»», con un interruptor y un botón para olvidarlo todo.
- **Las rutas delicadas siempre te preguntan.** Si la IA quiere cambiar `.git` (por ejemplo los hooks de git), `.claude`, `.opencode`, `.vscode`, `.mcp.json` o archivos parecidos, la app te lo pregunta aunque estés en «Todo sin preguntar», y ahí no ofrece «Permitir siempre» ni la aprobación automática lo aprueba.
- **Tope de ayudantes en segundo plano.** La IA ya no puede lanzar decenas a la vez: el máximo es 8 y lo cambias en Ajustes › Límites.
- **Motor `lazunox.7`:** además de lo anterior, trae ganchos de usuario por comando (para configuradores avanzados; todavía sin pantalla) y un «Permitir siempre» que ya no puede saltarse una regla de rechazo.

### Seguridad

- Los «siempre» guardados no se pueden usar para levantar una regla de rechazo vigente. Los ganchos de usuario solo se leen del archivo que fija la app, nunca de un proyecto ajeno.

## [1.7.1] - 2026-10-24

### Correcciones

- **Los acentos y las eñes salen bien en los comandos de Windows.** Si el motor usaba Windows PowerShell (lo normal cuando no tienes PowerShell 7), la salida de un comando con «áéíóú ñ» llegaba como «�����» a la conversación. Ahora llega tal cual. Con Git Bash ya funcionaba. Queda un límite conocido: si el único shell disponible es `cmd`, los acentos de la salida pueden seguir saliendo mal.
- El motor propio pasa a la versión `lazunox.6` (misma base, solo esta corrección). Compilación repetible y verificada en macOS, Windows y Linux.

## [1.7.0] - 2026-10-24

### Novedades

- **Un solo panel de trabajos en segundo plano.** Además de los ayudantes, ahora ves en el mismo lugar los **comandos largos** y los **programas de Modo código** que siguen corriendo, con su estado (en curso, terminado, parado, tope de vida o «se perdió al reiniciar»), el tiempo que llevan y un botón **Parar**.
- **La conversación despierta sola cuando un trabajo termina.** Si lanzaste un comando largo o un programa de Modo código y no esperaste su resultado, al terminar llega un aviso breve con las últimas líneas de salida (marcado como salida de un comando, no como instrucciones). Si detienes la conversación después de lanzar el trabajo, no se reanuda sola. Hasta 5 avisos por hora y conversación.
- **Los comandos largos del motor funcionan también en Windows.** Probado en el PC de pruebas con `cmd`, PowerShell, `pwsh` y Git Bash; al parar un comando se detienen también los procesos que dejó abiertos.
- **Límites ajustables.** En Ajustes › Funciones experimentales hay una sección «Límites» para el tiempo máximo, las llamadas y el tamaño del resultado de un programa de Modo código, y para la vida y la salida de un comando en segundo plano.
- **Si el motor se reinicia con trabajos en marcha, no se pierden en silencio:** se detiene lo que haya quedado huérfano y la IA recibe un mensaje claro de qué se perdió.
- **Modo código:** si rechazas un permiso que pide un programa, el programa se detiene por completo (antes podía seguir llamando a otras herramientas), y al pausarse la IA recibe un resumen de lo avanzado.

### Seguridad

- Una revisión independiente de todo lo nuevo no encontró problemas críticos ni altos. Se corrigieron dos medios: el limpiador de procesos huérfanos solo actúa sobre procesos que son líder de su grupo y nunca sobre el proceso 1, el propio motor, su padre ni una aplicación de escritorio; y un aviso automático no reanuda una conversación detenida.
- Se rompió un ciclo de módulos que dejaba sin su dependencia al servicio de permisos en ciertas pruebas.

## [1.6.3] - 2026-10-23

### Novedades

- **Comandos largos en segundo plano.** La IA ahora puede lanzar un comando que tarda (un servidor de pruebas, una compilación larga, un vigilante de archivos) sin bloquear la conversación: si no termina en unos segundos, sigue trabajando por detrás y la IA puede esperarlo, leer solo lo nuevo que fue escribiendo o pararlo. Al pararlo se detienen también los procesos que haya dejado abiertos. Hasta 3 a la vez por conversación, con tope de vida (30 minutos) y de salida. Funciona en macOS y en las Tareas con WSL; en Windows nativo se sigue usando el conector de siempre.
- **Los límites de Modo código son más amplios** (10 minutos, 1000 llamadas, 5 MB por script) y se pueden cambiar. Una ejecución en segundo plano solo la puede esperar o parar la conversación que la lanzó, y si esa conversación se borra, se cancela.

### Mejoras

- El motor propio ya dispara los ganchos de permisos de los complementos internos (antes estaban definidos pero no se usaban); los usa el control del plan.
- Una revisión de seguridad independiente de todo lo cambiado en la 1.6.x no encontró problemas críticos ni altos; los medios que sí eran reales se corrigieron.

## [1.6.2] - 2026-10-23

### Motor propio

- **Lazunox ya no depende de los servidores de OpenCode.** El motor que hace funcionar la IA es ahora una copia propia de OpenCode 1.19.0 (licencia MIT, con su aviso de copyright), compilada por nosotros y verificada antes de usarse (tamaño y huella SHA-256). En esa copia se quitaron las conexiones a sus servicios: ya no consulta si hay una versión nueva por su cuenta, no sube conversaciones a ningún servidor para compartirlas, no reenvía la interfaz web a sus servidores y no descarga servidores de lenguaje por sí solo. El motor se actualiza junto con la app.
- **Se ve en la app:** en Ajustes y en el asistente el motor aparece como «Lazunox Motor». Y en Code la IA se presenta como Lazunox (antes decía «OpenCode») y ya no consulta la documentación de OpenCode en internet cuando le preguntan por su propio funcionamiento. Los modelos gratuitos y la suscripción OpenCode Go siguen funcionando igual (son servicios de OpenCode y se nombran como tales).
- **Compilación repetible:** compilar dos veces el mismo código da el mismo archivo, byte a byte, en macOS, Windows y Linux (WSL). Así se puede comprobar que lo que usas es lo que está en el código.

### Novedades

- **Ayudantes en segundo plano, encendidos por defecto.** La IA puede lanzar un ayudante para una tarea larga, seguir conversando contigo y recibir el resultado cuando termine; aparecen en «Trabajos en segundo plano», con botón para cancelar. Puedes apagarlos en Ajustes. Si ya usabas Lazunox, se encienden una sola vez al actualizar (antes venían apagados); si los apagas, no vuelven a encenderse solos.
- **Modo código con límites y con pausa.** Si activas el Modo código, un script de la IA ahora se detiene si pasa de 5 minutos, de 200 llamadas o de 1 MB de salida, y **no se pierde lo ya hecho**: lo ejecutado se conserva y la IA recibe un resumen de lo obtenido. Además, si un script tarda más de 30 segundos ya no bloquea la conversación: sigue trabajando y la IA puede esperarlo, leer su resultado o pararlo (hasta 3 a la vez).

### Mejoras

- El instalador comprueba que el motor incluido sea exactamente el archivo fijado, no solo que tenga el mismo número de versión.
- Las Tareas en Windows (WSL) aceptan el motor propio.
- En «Acerca de», el motor incluido aparece como «Lazunox Motor».

## [1.5.3] - 2026-10-23

### Seguridad

- **Tus reglas de bloqueo con comodín ya no las anula un conector de confianza.** Si en tu configuración de OpenCode tienes reglas como «bloquear todo lo que termine en `_send`» o «preguntar siempre antes de borrar», y marcaste un conector como «Sin preguntar en Code», esa confianza podía saltarse esas reglas. Ahora siguen valiendo siempre.

## [1.5.2] - 2026-10-23

### Seguridad

Una revisión independiente de los cambios de seguridad de la 1.5.0 confirmó que cumplen lo que prometen y encontró estos huecos, que se verificaron uno por uno antes de corregirlos:

- **Editar la configuración de git ya no puede ejecutar comandos sin preguntar.** En los modos «Automático» y «Editar sin preguntar», la IA podía cambiar `.git/config` (por ejemplo `core.fsmonitor`) y después un `git status`, que la app aprueba sola por ser de lectura, ejecutaba ese comando. Ahora editar `.git/`, `.gitattributes` y `.gitmodules` siempre pregunta. `.gitignore` y `.github/` no cambian.
- **Los subagentes no pueden usar «reanudar» para saltarse sus límites.** Solo se puede reanudar un subagente que lanzó esa misma sesión, con los permisos con los que nació.
- **Los datos de un conector ya no se leen sin preguntar.** Las herramientas de «recursos» de un conector (listar y leer sus archivos o fichas) saltaban la pregunta; ahora preguntan en Code, en Overdrive y en Control total, y el ayudante de solo lectura no puede usarlas.
- **Un sitio permitido en Overdrive ya no puede apuntar a servicios de tu propio Mac.** El proxy de salida ahora comprueba a qué dirección resuelve cada sitio y rechaza las locales (incluido el puerto del propio motor). Las redes privadas de empresa (10.x, 192.168.x) siguen funcionando.
- **Los conectores locales ya no ven el canal interno del guardián de subagentes**, igual que ya pasaba con el terminal.

### Mejoras

- **Las pruebas y el desarrollo ya no pisan la copia del motor de tu Mac.** Cuando se abre Lazunox con un perfil temporal (pruebas, desarrollo), su copia del motor vive junto a ese perfil y no en tu carpeta real.
- **La integración continua de GitHub vuelve a pasar** (formato, pruebas en Windows y en macOS con la regional «C»).

## [1.5.1] - 2026-10-22

### Novedades

- **Si sin querer pulsas «No permitir» en macOS, ya no queda bloqueado.** Al volver a elegir esa carpeta (o cualquier otra de Documentos, Escritorio, Descargas, iCloud o un disco), Lazunox pide a macOS que vuelva a preguntar y te sale otra vez el aviso con «Permitir», sin pasar por Ajustes del Sistema. Lo hace una sola vez por intento, solo cuando eliges tú la carpeta, y nunca al abrir la app.
- **El aviso de macOS ahora dice «Lazunox Motor».** Antes mencionaba «opencode», un nombre que nadie reconoce. El motor de la IA ahora viaja como una pequeña app propia, así que el permiso aparece con ese nombre en Ajustes del Sistema › Privacidad y seguridad › Archivos y carpetas, y el botón «Volver a preguntar a macOS» también sirve para el motor.

### Mejoras

- **El motor se comprueba en cada arranque.** Lazunox deja una copia firmada del motor en tu Mac y, si esa copia se altera o no valida su firma, la rehace desde la que viene dentro de la app.
- **«Volver a preguntar» borra solo lo necesario:** si lo único denegado era el motor, no toca el permiso que ya habías dado a Lazunox, y no hace nada si la carpeta no se puede leer por permisos de archivo normales.

### Para tener en cuenta

- Solo macOS. **Quien ya había dado permiso al motor con el nombre «opencode» verá una vez el aviso nuevo de «Lazunox Motor»**.

## [1.5.0] - 2026-10-22

### Novedades

- **Traducir un Word sin cambiar el formato.** Igual que con los PDF: en el Chat adjunta un Word (.docx) y pide traducirlo (o usa el ícono de traducir). Se escribe sobre el mismo documento: estilos, fuentes, tablas, listas, encabezados, pies y enlaces quedan como estaban; solo cambia el texto. Lo que no se puede reescribir sin dañarlo (párrafos con imágenes, números de página, índices, cuadros de texto, cambios controlados) se deja igual y se avisa.
- **Funciones experimentales (apagadas por defecto), en Ajustes › Funciones experimentales.** Las enciendes por separado en Chat, Code y Overdrive:
  - **Modo código:** la IA escribe un pequeño programa que usa varias herramientas conectadas de una vez. En una tarea de prueba con muchas llamadas usó la mitad de los tokens. Un límite de seguridad lo corta si pasa de 60 segundos o de 200 llamadas, y te lo dice.
  - **Subagentes en segundo plano:** la IA puede lanzar ayudantes que trabajan en paralelo mientras sigues conversando; los ves en una lista con botón para cancelar, y sus permisos te llegan con el nombre del ayudante. Sirven para trabajo grande e independiente: en tareas pequeñas gastan más que hacerlo directo.
  - **Comandos largos en segundo plano (Code):** la IA puede dejar un comando trabajando y seguir; no lo corta por tiempo mientras muestre actividad, te avisa si parece atascado y le avisa a ella cuando termina (varios avisos se juntan en uno).
- **Code avisa cuando macOS no deja leer una carpeta.** Si negaste el permiso a Documentos, Escritorio, Descargas, iCloud o un disco, Code ahora lo explica y ofrece «Volver a preguntar a macOS», abrir Ajustes del Sistema o elegir otra carpeta. En la pantalla de arranque hay un aviso opcional para el Acceso total al disco.

### Seguridad

- **Code pide permiso antes de usar un conector.** La IA ya no usa tus conectores (correo, CRM…) sin preguntar: te pide permiso en cada uso, salvo en los que marques «Sin preguntar en Code» en Ajustes › Conectores. Las acciones que un conector tiene bloqueadas siguen bloqueadas.
- **Un ayudante nunca tiene más libertad que quien lo lanza,** y el modo Automático no aprueba nada por un ayudante. En Overdrive, el control de los ayudantes se hace por un canal de solo lectura y el puerto del motor sigue cerrado.

### Mejoras

- **Code ya no deja «medio abierta» una carpeta a la que no diste confianza** al cancelar el aviso de confianza.
- **Las pruebas automáticas de la app están al día** (se corrigieron 8 fallos reales de pantallas que se quedaban pegadas al arrancar en desarrollo, textos y contraste del verde en la fila activa; la captura del navegador integrado ya mide bien en pantallas Retina).

### Para tener en cuenta

- Las funciones experimentales cambian el motor de la IA y lo reinician cuando no hay nada en curso. Si algo no te gusta, apágalas en Ajustes.
- **Windows:** el botón de traducir y los permisos de carpeta de macOS no aplican en Windows.

## [1.4.0] - 2026-10-21

### Novedades

- **Traduce un PDF sin cambiar su diseño (Mac).** Adjunta un PDF en el Chat y escribe «tradúcelo al inglés»: Lazunox te pregunta si quieres traducirlo sin cambiar el diseño y, con un clic, escribe la traducción sobre el mismo PDF. Quedan las mismas hojas, la misma letra y tamaño, los colores, las tablas, los resaltados y los enlaces. También puedes empezar desde el ícono de traducir junto al clip. Elige entre inglés, español, portugués, francés, alemán e italiano, y al terminar lo abres o lo guardas donde quieras. La calidad depende del modelo que tengas elegido: con uno de pago sale mucho mejor que con uno gratuito (la ventana te lo avisa). Lazunox no paga nada por esto: usa tu propio modelo.
- **También en Code y Overdrive.** Si le pides a la IA que traduzca un PDF, ahora usa esta misma herramienta en vez de armar su propio script.
- **Los PDF que adjuntas llegan mejor al modelo.** Si el modelo lee PDF, se le envía el PDF tal cual (así ve las tablas y el diseño); si solo ve imágenes, se envían las páginas como imágenes; si solo lee texto, se envía el texto. Antes todos recibían lo mismo.

### Mejoras

- **«Acerca de» muestra la licencia y el enlace al código.** La traducción de PDF usa PyMuPDF (licencia AGPL-3.0), así que el código fuente completo de cada versión es público.

### Para tener en cuenta

- **Windows:** por ahora el botón de traducir PDF no aparece en Windows; llegará cuando la app de Windows incluya lo necesario.
- **No traduce** PDF escaneados (sin texto), texto dentro de imágenes ni texto vertical. Word sigue enviándose al modelo como texto.
- **Al actualizar, macOS puede pedirte una vez la contraseña del Llavero** («Lazunox Safe Storage»), porque cambia la firma de la app.

## [1.3.2] - 2026-10-19

### Mejoras

- **Mensajes de fallo más claros al preparar tu equipo.** Si falla la descarga de un componente (Node.js y uv, ArtCraft), la app ya no dice siempre «revisa tu conexión»: distingue entre sin conexión, huella incorrecta, sin espacio en disco, sin permiso para escribir en la carpeta de Lazunox y cancelado, cada uno con su explicación.
- **El uso de Overdrive aparece en Ajustes › Uso.** Antes mostraba 0 aunque hubieras hecho tareas. Ahora suma sus conversaciones, tokens y costo leyendo el registro que Overdrive ya guarda en cada carpeta aprobada, sin leer ningún mensaje ni ruta. Si una carpeta no se puede leer, lo avisa; en Windows dice «Overdrive no se cuenta aquí todavía».
- **Accesibilidad.** La casilla de «Prepara tu equipo» en el asistente queda descrita para lectores de pantalla, igual que en las otras pantallas.
- **Windows:** en la próxima imagen del entorno aislado, los commits de Overdrive firmarán como «Lazunox» sin el nombre de tu equipo. Las instalaciones actuales no cambian hasta que se publique esa imagen.

## [1.3.1] - 2026-10-18

### Mejoras

- **Ya no se pierde el modelo gratuito al abrir la app.** Si el catálogo de modelos tardaba en bajar justo al arrancar, la app podía quedarse con una lista recortada, sin el modelo que habías elegido, y decir «Aún no conectaste ninguna IA» hasta que pulsabas de nuevo «Probar un modelo gratuito». Ahora espera unos segundos a que el catálogo esté listo antes de consultarlo, y si el modelo que elegiste no aparece en la lista, sigue usando el gratuito en vez de bloquearte.
- **Elige qué instalar en «Prepara tu equipo».** Cada componente opcional (ArtCraft, Node.js y uv, y el entorno de Windows) tiene su casilla, con su tamaño y de dónde se descarga, y «Instalar lo que falta» y «Preparar todo» instalan solo lo marcado. Si falla uno, se reintenta solo ese.
- **Los commits de Overdrive ya no llevan tu nombre.** Dentro de «Solo en tu carpeta», git firma como «Lazunox» y no con el nombre de tu usuario del sistema ni el de tu equipo.
- **Resultados de rutinas más cómodos.** La vista previa muestra unas cuatro o cinco líneas con «Ver todo» y «Ver menos», sin barra de desplazamiento dentro de la tarjeta.
- **Telegram:** el campo de la clave se vacía si la clave se rechaza.
- **La ficha de un conector local** dice «Node.js y uv» cuando falta instalarlos, en vez de solo «uv».

## [1.3.0] - 2026-10-18

### Novedades

- **Lazunox instala lo que necesitan tus conectores de correo y calendario.** Antes, para conectar Gmail, Google Calendar, Drive u Outlook había que tener instalados `uv` o Node en tu equipo, y la ficha te decía «instálalo a mano». Ahora «Prepara tu equipo» incluye, marcado por defecto, **Node.js y uv** (unos 67 MB). Se bajan solo de sus sitios oficiales (nodejs.org y GitHub), con una versión exacta y una huella que se comprueba antes de usarlos; si no coincide, se borran sin ejecutarse. Quedan en una carpeta propia de Lazunox: no hacen falta permisos de administrador y no se toca nada de tu sistema. Se usan solo para los conectores que tú apruebas.
- **«Instalar lo necesario» en la ficha del conector.** Si falta algo, el botón lo descarga y sigue con la instalación del conector, sin que tengas que ir a otra parte.
- **Ajustes › Overdrive › Node.js y uv.** Ves su estado y versión, y puedes quitarlos (los conectores ya instalados dejan de arrancar hasta que los reinstales).

### Mejoras

- Si la descarga falla o la omites con «Más tarde», la app sigue funcionando igual: solo los conectores locales de correo y calendario necesitan estos programas, y puedes reintentar cuando quieras.

## [1.2.1] - 2026-10-18

### Mejoras

- **Overdrive lee menos de tu equipo.** Las tareas de Overdrive en Mac siguen escribiendo solo en tu carpeta, pero antes podían leer varios archivos personales que suelen guardar claves (como `.zshrc`, `.gitconfig`, la configuración de otras herramientas de IA y los datos de varias apps). Ahora esos archivos y carpetas quedan fuera de su alcance. Si la tarea usa `git`, usa una configuración propia y aislada, así que los commits que haga no llevan tu nombre de `.gitconfig`.
- **Los textos de Overdrive dicen exactamente lo que pasa.** «Solo en tu carpeta» ya no afirma que solo lee tus carpetas: en Mac escribe solo en tu carpeta y puede leer el resto de tu cuenta menos tus claves, tu configuración y los datos de las apps; en Windows solo ve la carpeta que elegiste. Sigue sin internet salvo sitios permitidos.
- **Resultados de las rutinas con formato.** En «Resultados por revisar» el texto se ve con títulos, negritas y listas, y hay un botón «Copiar el resumen».
- **Mensajes más claros.** Si un modelo gratuito no responde porque su servicio está caído, la app lo dice y ofrece «Reintentar», en vez de «Algo salió mal». Si «Guardar todo» no deja nada que guardar porque solo había archivos de secretos, lo explica en tu idioma. Las conversaciones nuevas del Chat dicen «Nueva conversación» hasta que tienen título. Tampoco aparece más la tarjeta «el agente intentó borrar» cuando lo que se negó fue otra cosa.
- **Aviso de versión nueva.** Si tu copia de Lazunox no se puede actualizar sola (por ejemplo, una copia portable), el botón ahora dice «Ver descarga» y abre la página, en vez de no hacer nada.

## [1.2.0] - 2026-10-18

### Novedades

- **Rama y pull request desde Code.** En el panel de Cambios, el botón «Rama y pull request» te guía para crear una rama, guardar los cambios con un mensaje que propone la IA, subirlos y abrir el pull request con título y descripción propuestos. También puedes pedirle a la IA que revise un pull request, propio o ajeno: lee los cambios y propone comentarios, y no publica nada hasta que tú lo apruebes. Cada acción que sale de tu equipo pide confirmación mostrando exactamente qué se envía y adónde; nunca fuerza el envío, las ramas protegidas piden escribir su nombre, y antes de subir se revisa que no vayan claves ni archivos de secretos. Lazunox no ve ni guarda tus claves de GitHub: usa la sesión de `gh` de cada persona.
- **Recetas para tus Rutinas.** Al abrir Rutinas ahora ves 12 recetas listas, con su horario sugerido: resumen informativo diario, qué llegó hoy a Descargas, ordenar Descargas (solo propone), gastos semanales, menú y lista de compras, repaso de estudio, estado de un repositorio y más. Elegir una abre «Nueva rutina» ya rellena; no se crea nada hasta que confirmas.
- **Pantalla de Uso.** En Ajustes › Uso ves cuánto has usado de la IA hoy, en 7 y en 30 días, por modelo y por modo (Chat, Code, Overdrive), con una frase clara de estado. Todo se calcula en tu equipo; si tu servicio no informa el costo, dice «sin dato».
- **Telegram: control desde el celular con un bot propio.** En Ajustes › Telegram creas tu propio bot (gratis, con @BotFather), lo vinculas con un código y queda como único dueño. Recibes avisos cuando una tarea termina o se atasca, y los permisos llegan con los botones «Permitir una vez» y «Rechazar», con el comando completo a la vista y las claves tapadas. Puedes elegir una conversación de Chat o de Code y seguir cómo avanza en un mensaje que se va editando, recibir los archivos que la IA crea y mandarle fotos o documentos. Escribirle a la conversación desde Telegram viene apagado hasta que lo actives. No puedes crear tareas, cambiar permisos ni iniciar Overdrive desde Telegram. Telegram no cifra de extremo a extremo los mensajes de bots y el computador debe estar encendido con Lazunox abierto. Las notas de voz todavía no se pueden usar.

### Mejoras

- **Overdrive funciona con los modelos gratuitos.** Con «Solo en tu carpeta», las tareas y las rutinas que usan un modelo gratuito (como DeepSeek V4.1 Flash o MiMo) fallaban con «Cannot connect to API». Ahora responden. En Windows, además, el servidor de tareas no conocía los modelos más nuevos y decía que no existían; ahora los conoce.
- **«Guardar todo» ya no incluye archivos de secretos** (como `.env` o llaves) en el commit.

## [1.1.0] - 2026-10-18

### Novedades

- **Buscar dentro de los mensajes.** La paleta (⌘K o Ctrl+K) ahora también busca en el texto de tus conversaciones de Chat y de Code. Muestra el fragmento con la palabra resaltada, quién habló y la fecha, y al elegir un resultado se abre la conversación en ese mensaje. Todo se queda en tu equipo: el índice vive solo en la memoria mientras la app está abierta, tiene un botón «Borrar lo leído», y las claves y llaves privadas se tapan antes de indexar.
- **Proyectos con archivos de conocimiento en el Chat.** Creas un proyecto con instrucciones propias y archivos (PDF, Word, Excel, PowerPoint, texto, Markdown…). En sus conversaciones, la IA recibe esos datos y cita el archivo de donde salen; si no encuentra nada, lo dice. Funciona sin servicios externos, no admite archivos de claves ni ejecutables, y un archivo no puede darle órdenes a la IA.
- **Trabajo de la IA más legible.** Cada respuesta pliega lo que hizo en una línea («Trabajó durante 23 s · 4 pasos ›») que se abre para ver un paso por línea, y cada paso al detalle. Hay tres vistas, Resumida, Con pasos y Detallada, en las cabeceras y en Ajustes. Un permiso pendiente o un error siempre quedan a la vista.
- **Conectores de correo, calendario y archivos (solo en Mac, solo consulta).** Gmail, Google Calendar y Drive (Google Workspace) y Outlook, Calendario y OneDrive de cuentas personales (Microsoft 365). Son programas de código abierto de terceros: la ficha dice con claridad qué se instala, su autor, su licencia y qué herramientas se pueden usar y cuáles quedan desactivadas. Tú autorizas en tu navegador; la app nunca ve tu contraseña. Aún no se han probado con una cuenta real, y la ficha lo dice. Necesitan tener `uv` o Node instalados.

### Mejoras

- **Documentos de Word en el visor.** Si el diseñador de documentos no estaba instalado, abrir un .docx con «Ver aquí» mostraba «No se pudo mostrar el documento». Ya se ve.
- **Conectores solo para Mac.** En Windows, las fichas de correo y calendario dicen «Solo en Mac por ahora» desde el inicio, en vez de dejarte avanzar hasta el último paso.
- Las fichas de conectores sin probar con una cuenta real lo muestran con una etiqueta.
- «Elige tu IA» en «Primeros pasos» se marca también al usar el modelo gratuito.
- Texto de la vista previa de habilidades sin plural roto.

## [1.0.0] - 2026-10-18

### Novedades

- **«Lo que has creado».** Una pantalla nueva en la barra lateral reúne todo lo que la IA ha creado en tus conversaciones: imágenes, documentos, planillas, presentaciones y PDF, con miniaturas, buscador y filtros por tipo, fecha y origen. Desde cada tarjeta puedes verlo aquí mismo, abrirlo con tu programa o mostrarlo en su carpeta. Si un archivo ya no existe, lo quitas de la lista.
- **Personalización.** Otra pantalla nueva, con pestañas Habilidades, Conectores y Tuyos. Cada ficha explica qué hace, qué no hace y qué permisos usa, y se quita cuando quieras. Las habilidades incluidas se activan o apagan con un interruptor; una habilidad tuya se instala solo desde una carpeta que elijas, con vista previa y confirmación. Conectar un servicio muestra un paso a paso con el aviso de qué datos se comparten, y no avanza hasta que marques «Entiendo».
- **Inicio del Chat con ideas para empezar.** Al abrir una conversación nueva hay tarjetas de inicio y una lista corta de «Primeros pasos» para quien usa la app por primera vez. Cada conversación puede tener sus propias instrucciones.

### Mejoras

- **Accesibilidad y estados.** Mejor contraste en los textos atenuados, avisos para lectores de pantalla cuando algo cambia, y pantallas de cargando, vacío y error más claras en las secciones nuevas.
- **Al quitar un conector** la confirmación ya no queda tapada por el detalle.

## [0.5.37] - 2026-10-17

### Mejoras

- **Textos más claros, sin jerga.** «API key» pasa a «Clave de acceso», «Proveedor» a «Servicio de IA», «Entregables» a «Archivos creados», «MCP» a «Conectores», «Modo auto» a «Aprobación automática». Los estados vacíos de Chat, Code y Overdrive dicen ahora lo que corresponde a cada uno.
- **«Conecta tu IA» más simple.** Un solo botón principal («Usar el modelo gratuito», con un aviso honesto de que es más lento y menos preciso) y todo lo demás recogido en «Otras formas de conectar».
- **Aviso de Overdrive de una línea.** Solo aparece cuando el modelo elegido no sirve con «Solo en tu carpeta», y nunca en tareas terminadas.
- **Caja de escribir con lo importante a la vista.** Los permisos y Build/Plan (en Code) y el acceso (en Overdrive) son botones con menú, cada opción con una frase que explica qué pasará. En el selector de modelo, ⌘1 a ⌘9 (Ctrl en Windows) eligen los primeros modelos y el predeterminado queda marcado.
- **Ajustes con buscador y más espacio.** Buscas por lo que recuerdas y te lleva a la opción. Al abrir Ajustes, la lista de conversaciones se pliega.
- **Importar desde otras herramientas.** En Ajustes puedes traer las instrucciones de un proyecto y los conectores de un archivo `.mcp.json` que elijas. Nada se importa sin tu confirmación, las claves no se copian y los conectores quedan desactivados hasta que los actives.
- **Code más cómodo en ventana pequeña.** La cabecera ya no se corta: lo secundario pasa a un menú «…». Al abrir «Cambios» se selecciona el primer archivo y puedes moverte con las flechas. Las sesiones con error se marcan con un rombo rojo.
- **Los modos de permisos hacen lo que dicen.** Antes, al pasar de «Preguntar siempre» a «Automático» en una sesión que ya existía, la app seguía preguntando de más; ahora cada modo reemplaza al anterior y se comporta igual en una sesión nueva que en una que cambió de modo. «Automático» deja pasar sin preguntar solo comandos simples de lectura (como `ls`, `git status`, `npm test`) y siempre pregunta por carpetas fuera del proyecto, archivos `.env` y todo comando con redirecciones o encadenados. Los textos de cada modo dicen ahora con exactitud qué pasa, y la app avisa que el cambio de modo vale desde el próximo mensaje.
- **Rutinas por archivo en Windows.** Ya se pueden crear y vigilar carpetas sin tener que aprobarlas antes en Overdrive, y el estado dice con claridad cuando falta aceptar el aviso de Rutinas.
- **Rutinas.** En la bandeja de resultados quedan a la vista «Aprobar» y «Descartar»; lo demás va en un menú «…». «Nueva rutina» aparece siempre en la cabecera.

## [0.5.36] - 2026-10-17

### Novedades

- **Pestañas en la terminal de Code.** Puedes abrir varias terminales a la vez con el botón «+» (hasta 8 por proyecto), renombrarlas con doble clic y cerrarlas con la «x». Si pulsas ▶ y la terminal está ocupada, la app te ofrece usar una pestaña nueva.
- **Archivos del Chat.** Cuando la IA crea o nombra un archivo, aparece una tarjeta con «Ver aquí» (imágenes, texto, Markdown, código, PDF y Office), «Abrir con tu programa» y «Mostrar en la carpeta». Los programas y scripts solo ofrecen «Mostrar en la carpeta».

- **Adjuntar Word, Excel y PowerPoint en el Chat.** Ya puedes adjuntar documentos de oficina (.docx, .xlsx, .pptx y sus equivalentes) con el botón, arrastrando o pegando. La app los convierte a texto antes de pasárselos a la IA, así que funciona con cualquier proveedor. Si el documento es muy grande, se avisa qué parte se recortó.
- **Memoria e instrucciones en Chat y Code.** En Ajustes puedes escribir cómo quieres que te responda la IA, ver y editar el archivo AGENTS.md de cada proyecto, y revisar lo que la IA recuerda. La IA solo propone recordar algo: nada se guarda sin tu aprobación, y puedes olvidarlo todo cuando quieras.
- **Exportar y copiar conversaciones.** En el menú «…» de cada conversación (y en la cabecera) puedes copiar la conversación, guardarla como Markdown o como PDF. Las claves y tokens que aparezcan se tachan antes de exportar.
- **Rutinas que reaccionan.** Una rutina ahora puede dispararse cuando aparece un archivo nuevo en una carpeta, con filtro por nombre, espera a que termine de copiarse y un tope por hora. Los resultados de cada ejecución llegan a una bandeja de «Resultados por revisar» donde los apruebas o descartas, con un contador en la barra lateral. Si la app estuvo cerrada cuando tocaba una rutina, ahora te pregunta si quieres ejecutarla (antes la ejecutaba sola al abrir).

### Mejoras

- **El Chat funciona con el modelo gratuito.** Antes, con el modelo gratuito de OpenCode el Chat fallaba siempre con un aviso de «clave inválida». Ya responde.
- **Primer uso sin bloqueos.** La pantalla «Preparando Lazunox» solo detiene la app si falta el motor; lo opcional (como el diseñador de documentos) se puede dejar para «Más tarde», y la bienvenida ya no descarga nada sola: el diseñador de documentos solo se instala si pulsas «Preparar todo».
- **El asistente empieza por lo gratuito.** «Empezar gratis» con un modelo gratuito va primero; el servicio con suscripción ya no aparece como recomendado.

## [0.5.35] - 2026-10-16

### Novedades

- **Botón ▶ «Ejecutar» en los bloques de comandos.** En las respuestas del chat de Code, los comandos de terminal tienen un botón ▶ que los corre en la terminal interna de la app. Debajo aparece una tarjeta con la salida en vivo y un botón `>_` para abrir la terminal. Cuando el comando termina, la IA recibe la salida sola (se puede apagar en Ajustes › General) y la sesión no se queda «trabajando». Los comandos delicados (como borrar archivos) piden confirmación, y si la terminal está ocupada la app te avisa y te ofrece abrirla.
- **Primer uso más simple.** El asistente saluda directo, tiene 4 pasos con barra de progreso, usa el motor incluido y pide los permisos de macOS solo cuando los necesitas. Todo sin jerga, y «Probar con un ejemplo» queda a la vista.

## [0.5.34] - 2026-10-16

### Mejoras

- **Inicio útil en Chat y Code.** En el Chat, «Respondiendo ahora» y «Retomar» con tus conversaciones recientes; en Code, «Esperando tu aprobación» y «Retomar» con tus sesiones y su estado. Las ideas de ejemplo quedan plegadas cuando ya tienes trabajo. En la barra de Code, el texto «Sin sesiones todavía» pasó a un botón «Nueva sesión aquí».
- **Chat: fijar y archivar conversaciones.** El menú de tres puntos ahora tiene Fijar, Renombrar, Archivar y Eliminar; las fijadas van arriba en su propio grupo y las archivadas tienen su vista con «Restaurar».
- **Aprobaciones más compactas.** Los permisos y el plan de Overdrive muestran un resumen de una línea con los botones siempre a la vista y los detalles plegados («Ver detalles»). En acciones delicadas, como borrar o ejecutar comandos largos, el detalle sale abierto.
- **Code: el «+» de cada proyecto ya no se activa por accidente.** Está más separado de los otros botones, ignora el doble clic, y si ya tienes una sesión vacía sin título la abre en lugar de crear otra.
- **Textos más grandes y legibles en escritorio.** Los textos secundarios que se veían a 9–11 px (insignias, horas, atajos, contadores, paneles) ahora tienen al menos 12 px. El celular no cambia.

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
