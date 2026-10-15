# Cambios de Lazunox

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen [SemVer](https://semver.org/lang/es/).
Cada sección se usa tal cual como notas de la release en GitHub (`scripts/release-notes.mjs`), así que se escribe en lenguaje llano para
quien usa la app. El detalle técnico de cada cambio está en `CHANGELOG-FASE6.md`, `CHANGELOG-FASE7.md` y `CHANGELOG-FASE8.md`.

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
