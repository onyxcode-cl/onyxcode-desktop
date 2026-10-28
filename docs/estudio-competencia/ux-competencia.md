# UX/UI de las apps de escritorio de Claude y ChatGPT (estado a 2026-10-17)

Propósito: comparar luego con Lazunox. Método: solo texto (WebSearch/WebFetch); no se vieron capturas. Niveles de confianza: **[O]** oficial, **[T]** terceros (blogs, foros, prensa), **[NC]** no confirmado.
Límites honestos: Reddit y X no se pudieron abrir (solo se vio un resumen de búsqueda de un hilo de X). Los changelogs largos se leyeron solo en parte (primeros 100k caracteres de Claude/Cowork, hasta 200k del de OpenAI). No hallé fuentes fiables sobre accesibilidad, temas, densidad ni tamaño de texto en ninguno de los dos; se marca como «sin datos». Varias páginas de OpenAI (help.openai.com) devolvieron 403.

---

## A. Claude de escritorio (Chat, Cowork, Code)

### A1. Estructura y navegación

- Tres modos en una sola app: Chat, Cowork y Code, como pestañas arriba de la ventana. Cowork y Code comparten motor. [O/T] https://academy.claude.com/tutorials/navigating-the-claude-desktop-app · https://www.datacamp.com/tutorial/claude-cowork-tutorial (la ubicación de las pestañas es de DataCamp [T]).
- No existe atajo oficial para cambiar entre Chat, Cowork y Code (solicitud abierta desde enero 2026). [T] https://github.com/anthropics/claude-code/issues/18818. Ctrl/Cmd+B alterna la barra lateral; Cmd+. se eliminó (2026-09-24). [O] https://claude.com/docs/cowork/changelog
- **Rediseño de Code (14 abr 2026)**: barra lateral con todas las sesiones activas y recientes; filtro por estado/proyecto/entorno o agrupación por proyecto; sesiones se archivan solas cuando se fusiona o cierra su PR; paneles (terminal, vista previa, diff, chat) arrastrables en cualquier cuadrícula; editor de archivos integrado; visor de diff reescrito para cambios grandes; vista previa de HTML, PDF y servidores locales. [O] https://claude.com/resources/articles/claude-code-desktop-redesign
- **Octubre 2026 (changelog)**: la barra lateral agrupa por entorno (o carpeta/repositorio); los grupos personalizados se llaman «secciones»; el botón Filtrar pasó a «Agrupar y ordenar» (aparece al pasar el ratón sobre el encabezado del grupo); «Ver todo» abre archivadas; se quitó la lista «Primeros pasos con Claude Code». Aparece un **riel de sesión** a la derecha con tarjetas (entorno, contexto, conectores, salidas, cambios, servidores, tareas en segundo plano), configurable con clic derecho en el encabezado de tarjeta. [O] changelog (15-oct-2026)
- Ventanas: «Abrir en ventana nueva» para chats (13-oct) y sesiones de Code, paneles laterales, chat lateral y artefactos vivos (22-sep; ⌘-clic). Chat lateral `/btw` en panel propio con pestaña por cada uno (15-oct); atajo ⌘/Ctrl+; para chat lateral que hereda contexto y no devuelve nada al hilo principal. [O] changelog + redesign article
- Lista de «Fijados» muestra 20 y «Mostrar más» (17-sep). [O] changelog
- Quick Entry en Mac: doble toque de Option abre una ventanita siempre encima; Caps Lock para dictado (desactivado por defecto porque secuestra la tecla); icono en barra de menú/bandeja. [O] https://academy.claude.com/tutorials/navigating-the-claude-desktop-app · https://support.claude.com/en/articles/12626668

### A2. Caja de escribir

- Rediseño del compositor en Code (29-sep) y de nuevo el 15-oct: la fila bajo la caja contiene **modo de permisos, un único menú de modelo+esfuerzo y un anillo de uso del plan**; el menú «+» y el micrófono pasaron _dentro_ de la caja. El contexto se movió a la tarjeta Contexto del riel. [O] changelog
- Cowork: interruptor de pensamiento extendido junto al control de esfuerzo (24-sep). Casilla/selector «Trabajar en una carpeta» bajo la caja. [O/T]
- Cola de mensajes: lo enviado durante una respuesta espera en la conversación; primer mensaje ofrece «Enviar ya»; **Cmd/Ctrl+Enter interrumpe y envía** (10-sep). Mensajes retenidos por el límite de 5 horas se envían solos al reiniciarse y se pueden editar o cancelar. [O] changelog
- Borradores muy grandes vuelven como adjunto «Borrador guardado» en vez de congelar la app (15-sep). Un mensaje que falla se queda con «Reintentar» tras recargar (13-oct). [O]
- Bug corregido: Enter elegía un elemento del menú «/» en vez de enviar cuando había una palabra con «/» a mitad de mensaje (15-oct). [O]
- Adjuntar: arrastrar sobre el icono de la app, enviar captura de ventana o recorte en Mac. Comentarios por línea en el panel Archivos («+» junto a la línea o seleccionar texto → Añadir comentario; viajan con el siguiente mensaje). [O]

### A3. Cómo muestra el trabajo

- Code: tres modos de vista **Verbose / Normal / Summary** (de visibilidad total de llamadas a herramientas a solo resultados); en septiembre se añadió elegir el predeterminado en Ajustes (Normal, Thinking, Verbose). [O] redesign article + changelog 10-sep
- Cowork: Claude anuncia una lista de tareas, panel derecho con pasos en tiempo real, panel de Artefactos con vista previa de lo leído/creado; puede pausar para preguntar; el usuario puede corregir el plan o detener. [T] https://www.datacamp.com/tutorial/claude-cowork-tutorial
- Botón de uso muestra ventana de contexto y uso de sesión. Tarjeta de «tareas en segundo plano» con salida de comandos. [O]
- Terminal integrada: pestañas indican comando en ejecución, piden confirmar al cerrar uno activo, y una pestaña caída queda abierta con «Reiniciar». [O] changelog 8-sep

### A4. Aprobaciones y permisos

- Modos en Code/Cowork: Manual, **Auto** y «Saltar todas las aprobaciones» (Skip/Bypass) [T: setup guide; los nombres cambian entre versiones, [NC] etiquetas exactas]. Desde 24-sep las sesiones de Code **arrancan en modo Auto** donde el modelo lo soporta; las tareas programadas usan «aprobar automáticamente» por defecto si la organización lo permite. [O] changelog
- Auto: un clasificador (Sonnet 4.6 según el post) revisa cada acción; el usuario aprueba el 93% de los avisos manuales, de ahí la «fatiga de aprobación»; tras 3 denegaciones seguidas o 20 totales vuelve a pedir al humano; las denegaciones vuelven al agente con motivo para que busque otro camino. El propio post admite 17% de falsos negativos en acciones excesivas reales («the honest number»). [O] https://anthropic.com/engineering/claude-code-auto-mode
- Las peticiones y preguntas de permiso aparecen **dentro de la conversación** (15-oct, antes arriba de la caja); también en ventanas emergentes y paneles divididos. Avisos apilados ya no se deslizan bajo el puntero (17-sep). [O]
- Granularidad: acceso por carpeta con «una vez» o «Siempre permitir»; navegador integrado pregunta «una vez / siempre / denegar» por sitio y antes de cada acción en sitios marcados; computer use pregunta por app; herramientas de solo lectura de MCP ofrecen «Siempre permitir» (24-sep); políticas de organización con «ask» obligan a preguntar incluso en modo Skip. [O] changelog + academy
- Salir (Cmd+Q) muestra «Claude sigue trabajando» antes de parar sesiones. [O]
- Una petición restaurada sin detalles solo ofrece «Denegar» hasta tenerlos. [O]

### A5. Archivos y vistas previas

- Panel Archivos con editor, autoguardado (13-oct, desactivable), aviso antes de descartar ediciones; vista previa de Office con diagnóstico de fallo (sin permiso, archivo borrado…), vídeo en línea, artefactos con librerías de gráficos incluidas para funcionar sin red; enlaces entre artefactos abren en sitio. [O] changelog
- Diff, terminal y preview como paneles arrastrables. [O]

### A6. Primer uso y estados vacíos

- Cowork abre con tareas sugeridas («Organizar archivos», «Analizar datos») [T]. Code tenía una lista «Primeros pasos» que se quitó (15-oct) [O]. Sesiones nuevas: entorno y carpeta en la fila bajo la caja; tarjeta de entorno reciente. [O]

### A7. Ajustes, personalización, atajos

- Ajustes: General (quick entry, bandeja, mantener despierto el equipo), Claude Code (vista de transcripción por defecto), extensiones (restringibles por admins). [O] Sin datos sobre buscador de ajustes en la app de Claude.
- Atajos: ⌘/ lista completa en Code. [O] Cmd+F busca también en mensajes fuera de vista (8-sep). [O]
- Temas, densidad y tamaño de texto: **sin datos fiables**. Accesibilidad: solo se ve soporte de texto bidireccional árabe/hebreo (15-oct) [O]; nada sobre lectores de pantalla.

### A8. Rendimiento y fallos

- Críticas: «lenta, con fallos e hinchada» (Drew Breunig, citado por Gruber), Electron no nativo «a lazy Electron clunker» https://daringfireball.net/2026/07/claudes_criminally_bad_mac_app_is_an_inside_job [T]; hilo HN con quejas de 1 s para cargar conversación y tareas nuevas colgadas varios segundos https://news.ycombinator.com/item?id=47104973 [T]. Defensa: Boris Cherny (Claude Code) dijo que se prefirió Electron por compartir código y «look and feel», «puede cambiar» [T vía Gruber]. En el hilo https://news.ycombinator.com/item?id=48781434 un comentarista dice que a veces sigue las convenciones de macOS y a veces no, y otro elogia las apps de Mac de ChatGPT/Codex por ello [T].
- Windows: VM Hyper-V de ~1,8 GB al usar Cowork una vez, persistente [T] https://www.neowin.net/reports/claude-on-windows-is-eating-up-massive-amounts-of-ram-with-no-way-to-stop-it/
- El changelog de sept-oct 2026 está lleno de arreglos: congelación de segundos al abrir (Windows), CPU al 100% tras limpiar worktrees, memoria creciente en macOS, congelación de hasta 30 s con node_modules enormes, sesiones que no aceptaban mensajes tras suspender, «No se pudo cargar esto». [O] Es evidencia de problemas reales y de respuesta rápida.

### A9. Mensajes de error / recuperación

- Patrón consistente: error local no tumba la ventana, con «Reintentar» (panel que no descarga, mensaje que no se envía, tarea SSH interrumpida, guardado fallido). Sin red, falla en segundos y dice que estás sin conexión. Un hook que bloquea muestra el motivo (10-sep). [O] changelog

### A10. Consistencia entre modos

- Mismo motor Cowork/Code, pero la barra lateral, el compositor y las aprobaciones se rediseñan por separado y cambian cada pocas semanas (p. ej. «Pendientes» de controles de PR movidos, filtro renombrado). Cowork gana funciones de Code (riel, aprobaciones en la conversación) con retraso. [O, inferencia]. «Mark as unread» se quitó en chats (4-sep). [O]

---

## B. ChatGPT de escritorio (Chat, Work, Codex)

### B1. Estructura y navegación

- **Rediseño 16-jul-2026** (macOS y Windows, todos los planes): selector global arriba a la izquierda entre ChatGPT y Codex; dentro de ChatGPT, interruptor Chat/Work; Codex es vista separada con historial propio; Chat y Work comparten lista «Recientes» ordenable, filtrable y fijable; proyectos aparecen y se puede iniciar Chat o Work con contexto del proyecto; Quick Chats siguen. [T] https://reconn-ai.com/news/chatgpt-desktop-app-ai-visibility/ ; la fusión de la app ChatGPT, Codex y Atlas en una «superapp» [T] https://en.wikipedia.org/wiki/Codex_(AI_agent)
- **Reacción negativa inicial** [T]: historial de chats movido a una ventana emergente lenta que carga al desplazar, «No projects», sin búsqueda, ventana que no puede ir a pantalla completa, y en la 26.707 (bug) Chat ausente en macOS; la app antigua renombrada «ChatGPT Classic» sin descarga clara; instalador «ChatGPT» que instalaba Codex. https://community.openai.com/t/desktop-app-redesign-removed-chat-history-from-the-sidebar-please-bring-it-back/1386361 · https://community.openai.com/t/chat-mode-missing-in-the-new-chatgpt-macos-app-26-707-31428-web-has-chat-work-desktop-only-shows-work-codex/1386324 · https://news.ycombinator.com/item?id=48849059
- OpenAI Support (20-ago) admitió que la interfaz «puede confundir» y prometió mejoras. [T/foro oficial] Luego un responsable de Codex (Tibo) anunció en X: historial y proyectos de nuevo visibles en la barra lateral, historial Chat/Work sincronizado entre web, móvil y escritorio (las tareas locales se quedan en el equipo), cambio Chat/Work consistente con web/móvil, «Codex no cambia». [T: resumen de búsqueda de X, no abierto] https://x.com/thsottiaux/status/2077928427936710901 · https://www.digitaltrends.com/computing/openai-patches-chatgpt-desktop-after-user-backlash-over-its-recent-redesign/ (la página no devolvió contenido)
- Maqueta oficial de la barra lateral: búsqueda de app y «Nuevo chat»; secciones Fijados, Proyectos, Recientes; menú «Añadir» con Archivos y carpetas, Adjuntar Google Chrome, fijar una meta, modo plan. [O] https://learn.chatgpt.com/docs/features
- Cmd+K abre una línea de tiempo plana (según un usuario del foro). [T]

### B2. Caja de escribir

- Work: placeholder «Do anything.», `@` invoca plugins, selector de modelo (GPT-6 Astra, 6.1 Sol, Luna), micro y enviar; elegir ejecución local o en la nube; ejemplos con botón «Copy prompt». [O] https://learn.chatgpt.com/docs/get-started-with-work
- Codex app: **predicciones del compositor** (beta, 9-oct): tras responder propone el siguiente prompt; Tab lo acepta como borrador editable sin enviar. «Steer» (enviar durante una respuesta para redirigir); mensajes en cola que se quedaban en «Sending» arreglados (8-oct). [O] https://learn.chatgpt.com/docs/changelog
- CLI (referencia): `/config` con panel buscable, `/keymap` con tecla líder (Ctrl+X). [O] — no es la app.

### B3. Cómo muestra el trabajo

- Work: marcador «Worked for 2m 30s» y mensaje corto del paso actual; archivos terminados como tarjetas adjuntas con icono (.pptx/.xlsx) que abren un panel de vista previa con navegación de página/hoja, zoom y botón «Open». [O] get-started-with-work
- Codex: panel «Changes» con scroll y navegación mejorados (8-oct); revisión de diff con comentarios en línea, preparar/revertir por trozos, commit/push/PR desde la app; hilos locales o en worktree visibles en la UI; navegador integrado con «Annotate» (seleccionar elemento y escribir «mueve esto arriba»). [T] https://www.tarekalaaddin.com/blog/codex-desktop-super-app-claude-code-desktop-comparison ; worktrees/diff [O: resumen de búsqueda sobre developers.openai.com]
- Crítica: sin equivalente de la barra de estado del CLI; para ver varios hilos hay que entrar en cada uno; reactivar hilos inactivos falla a veces. [T]

### B4. Aprobaciones y permisos

- Work: aprobar acciones importantes; la tarea puede parar antes de enviar algo; aviso cuando pausa por revisión de seguridad. [O]
- Capas: permisos del espacio de trabajo, cuenta, SO (Grabación de pantalla y Accesibilidad en macOS para Computer Use), aprobaciones por app, política de dispositivo; archivo, Computer Use, navegador y apps conectadas tienen permisos distintos; admin puede impedir guardar aprobaciones de apps. [O] https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security
- Codex: sandbox + política de aprobación; combinación por defecto = sandbox de espacio de trabajo con aviso al salirse; «Full access» = sin sandbox y sin avisos (advertido en los docs); **Auto-review** («Approve for me» en el control de permisos) delega en un agente revisor, solo si las aprobaciones son interactivas. [O] https://learn.chatgpt.com/codex/sandboxing/auto-review
- 8-oct: guía de recuperación cuando una herramienta necesita aprobación pero los permisos del chat bloquean las peticiones (con enlace a esos permisos). [O] changelog
- Aprobación por voz no admitida en web/móvil. [O]

### B5. Archivos y vistas previas

- Tarjetas de archivo + panel de vista previa en Work; plugins de Documentos, PDF, Hojas, Presentaciones, Template Creator. [O] features / get-started
- Chats y Work locales no se sincronizan automáticamente con la nube: «Work Cloud» solo con acceso local si el equipo está en línea. [O]

### B6. Primer uso y estados vacíos

- «Buenas primeras tareas: resultado claro, pocas fuentes, salida revisable», prompts de ejemplo. [O] Desde el foro, Work en escritorio «empieza en blanco, sin memoria de tus chats ni proyectos» (luego parcheado por proyectos). [T]
- Vista «Scheduled» para tareas recurrentes con campo de prompt. [O]

### B7. Ajustes, personalización

- Hay páginas de Ajustes, Comandos y Slash commands, y «Pets», «Notifications», «Personalities» listadas por nombre, **sin contenido legible** (403/solo enlaces). Temas/densidad/texto/accesibilidad: **sin datos**. [NC]

### B8. Rendimiento

- Codex desktop «más pesado y a veces lento» según foros citados por un reseñador [T]; la app antigua era lenta con hilos largos [T HN]. Usuarios Mac elogian que ChatGPT/Codex sigan las convenciones de macOS y gasten ~171 MB (cifras de un comentario HN) [T]. Cadencia de versión de la app Codex: 26.928 (29-sep), 26.1007 (8-oct): arreglos de scroll, arranque en terminal con worktrees, respuestas previas que se mantenían visibles. [O]

### B9. Consistencia

- Quejas dominantes: nombres confusos (Classic, Work, Codex), cambiar Work↔Codex «no cambia nada», funciones perdidas en el salto (voz, Deep Research, conmutador de búsqueda, Canvas, GPTs personalizados, chats temporales, editar mensajes antiguos). [T] HN 48849059. Codex crea una carpeta en Documentos por hilo e inyecta instrucciones globales. [T]

### B10. Errores

- Poco documentado. Ejemplo: mensajes «Sending» atascados (arreglado), guía de recuperación para aprobaciones bloqueadas. [O]

---

## C. Entregables finales

### (1) 10 patrones de UX mejor valorados

1. **Barra lateral de sesiones paralelas con estado y agrupación** (Claude Code): permite orquestar varios agentes; archivado automático al cerrar el PR. [O+T]
2. **Paneles arrastrables (terminal, preview, diff, chat)**: el usuario compone su espacio de trabajo. [O; elogio en X de Alex Finn, no abierto]
3. **Tres niveles de verbosidad (Verbose/Normal/Summary)**: el mismo flujo sirve a novatos y a quien depura. [O]
4. **Modo Auto con clasificador** (Claude): reduce la fatiga de aprobación (93% de avisos aceptados) sin saltarse todo. [O]
5. **Diff con comentarios en línea y preparar/revertir por trozos** (Codex). [T]
6. **Annotate sobre el navegador integrado** (Codex): feedback visual sin describir con texto. [T]
7. **Worktrees visibles por hilo** (ambos): aislamiento comprensible. [T/O]
8. **Chat lateral que hereda contexto sin contaminar el hilo** (Claude). [O]
9. **Tarjetas de archivo con vista previa y «Open»** para entregables de oficina (Work). [O]
10. **Cola de mensajes + «Enviar ya»/steer y predicciones con Tab sin enviar** (ambos). [O]
    Mención: errores locales con «Reintentar» sin tumbar la ventana (Claude). [O]

### (2) 10 quejas más repetidas

1. Electron: lenta, hinchada, no sigue convenciones de macOS (Claude). [T]
2. Memoria alta, VM de 1,8 GB en Windows (Claude Cowork). [T]
3. Historial de chats escondido tras rediseño (ChatGPT). [T]
4. Confusión de nombres y modos (Chat/Work/Codex/Classic), cambiar de modo «no cambia nada». [T]
5. Funciones perdidas al fusionar (voz, Deep Research, Canvas, GPTs…). [T]
6. Proyectos que no aparecen / Work sin contexto de chats. [T]
7. Fatiga de aprobaciones y fricción del sandbox (reseñas XDA; Anthropic cita 93% de aprobaciones). [T/O]
8. Rediseños constantes en pocas semanas (Claude renombra filtros y mueve controles cada release; ChatGPT revirtió parte tras 1 mes). [O inferencia]
9. Sin vista agregada de estado de hilos (Codex) / desktop de Code añade sobrecarga frente a la terminal. [T]
10. Fallos de fiabilidad: sesiones sin aceptar mensajes, congelaciones, hilos inactivos que no reviven, remoto (Dispatch) que se detiene al dormir el Mac. [O changelog + T]
    Falta evidencia directa de Reddit/X (no accesibles).

### (3) Principios declarados por los equipos

- Anthropic (Claude Code): el desarrollador pasa a **orquestador** de muchas tareas en paralelo (redesign article) [O]. Auto mode: «juzga el impacto real», la autorización es conservadora, defensa en profundidad, **«deny and continue»** (un bloqueo cuesta un reintento, no la sesión), no sustituye la revisión humana en tareas de alto riesgo [O]. Cherny: Electron por código compartido y «look and feel» consistente; «engineering is all about tradeoffs» [T].
- OpenAI: Work está pensado para «seguir el progreso, responder preguntas, cambiar de rumbo y aprobar acciones importantes»; buenas primeras tareas = salida revisable; acceso local opt-in por carpeta y app; consolidar en «superapp» para simplificar el catálogo [O/T]. Tras la reacción: «no lo hicimos del todo bien a la primera… seguimos arreglando papercuts, rendimiento, fiabilidad y eficiencia» (Tibo, vía resumen de búsqueda de X) [T/NC].
- No encontré documento de principios de diseño formal en ninguno de los dos.

### Implicaciones para comparar con Lazunox (inferencias mías, no hechos)

- Lo que ambos acabaron necesitando: lista de sesiones con estado y agrupación, historial siempre visible, panel de cambios/diff, tarjetas de entregables, cola de mensajes y aprobaciones dentro de la conversación.
- Errores a evitar: ocultar el historial, renombrar modos sin que cambie nada visible, y soltar rediseños sin paridad de funciones.
