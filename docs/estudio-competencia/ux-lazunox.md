# Auditoría UX/UI de Lazunox 0.5.36

**Alcance.** Interfaz de escritorio vista con `scripts/shot-desktop.mjs` (motor falso, modelos «Fake Model», datos inventados), tema oscuro y claro a 1280x800, y varias pantallas a 1000x700. Más lectura de código de `src/renderer` y `src/shared/i18n/es` para lo que no se ve en una captura (foco, ARIA, tamaños). Se audita solo Lazunox con criterios generales; no se compara con otras apps.

**Carpeta de capturas (`CAP`)**: `/private/tmp/claude-501/-Users-ben-Documents-App-OpenCode/f3368236-18e8-4ceb-9d65-bab74229ae58/scratchpad/ux-lazunox/`. Todas las rutas de abajo son relativas a ella; el nombre sigue `<escenario>-<tema>-<tamaño>.png`.

**Límites honestos.**

- `tareas-plan-sin-apps` falló dos veces por timeout del arnés (`locator.click`, 30 s); no hay captura de la tarjeta del plan. No es un hallazgo de UX.
- No se vieron: estados de error reales, carga prolongada, lector de pantalla ni navegación por teclado en vivo (solo código). El motor es falso: textos como «Respuesta simulada» y «Fake Model» son artefactos del arnés, no defectos.
- Las capturas del paso 1 del onboarding («Conecta tu IA») y del final se hacen con motor incluido; los de «sin motor» (`onboarding`, `onboarding-motor`) no se generaron.

---

## 1. Lo que está bien hecho

1. **Chat vacío limpio** (`chat-vacio-dark-1280x800.png`): saludo, un compositor central y cuatro tarjetas de inicio con título y subtítulo. Un solo foco claro; sin avisos ni jerga. Buen estado vacío.
2. **Desktop con piso de 12 px garantizado.** `src/renderer/src/app/desktop/min-font-size.test.ts` hace fallar el build si una clase fija baja de 12 px sin variante `desk:` (hay 221 `text-[11px]` en el código, pero todos llevan `desk:text-meta` = 12 px). Cumple el criterio ≥12 px en escritorio.
3. **Accesibilidad base seria.** Anillo de foco global (`globals.css` L314-319, `desktop/base.css` L22 y L87), ~486 `aria-label`, `Dialog` con `role="dialog" aria-modal`, foco atrapado y devuelto (`components/DialogFrame.tsx`), `role="status"`/`aria-live` en HUD de progreso, tarjetas de espera y ajustes, `aria-keyshortcuts` en la barra lateral, test de contraste (`app/contrast.test.ts`) y de `forced-colors`.
4. **Diálogo de confirmar** (`dialogo-confirmar-dark-1280x800.png`): título-pregunta, consecuencia concreta («el uso se multiplica x2»), botón primario con foco visible y secundario neutro, «No volver a mostrar». Patrón correcto.
5. **Petición de permiso en Overdrive** (`tareas-permiso-dark-1280x800.png`, `...-light-...`): dice qué quiere hacer («El agente quiere borrar archivos»), muestra el comando exacto, ofrece «Rechazar (Esc)» y «Permitir una vez (⌘↵)», y una tercera vía «Rechazar con indicaciones». El rojo marca el riesgo. Muy buen feedback y control; en la barra lateral y el riel además hay punto ámbar (señal repetida en tres sitios).
6. **Pasos de herramientas plegados con resumen** (`chat-herramientas-dark-1280x800.png`: «4 pasos · Leyó 1 archivo · Buscó una vez…»). Reduce ruido y deja ver el detalle bajo demanda; el chip de archivo editado con `+1 −1` es excelente.
7. **Paleta de comandos** (`paleta-dark-1280x800.png`): agrupada (Acciones / Ir a / Apariencia), atajos visibles, «Actual» marcado, pie con ↑↓ ↵ Esc.
8. **Editor de rutinas** (`rutinas-editor-dark-1280x800.png`): atajos de horario («Cada mañana 8:00»), vista previa de las próximas ejecuciones («Próxima en 8 h 36 min · luego dom, 18 oct…»), aviso de que corre sin supervisión y `⌘↵ para guardar`. Muy buen ejemplo de feedback previo.
9. **Ajustes > Memoria** (`ajustes-memoria-dark-1280x800.png`): explica qué pasa al apagar, dónde se guarda y qué sale hacia el modelo; edición/borrado por nota. Transparente.
10. **Tema claro/oscuro coherentes** (comparar `chat-conversacion-light-1280x800.png` y `...dark...`): jerarquía y contraste se conservan; el bloque de código y la tabla se leen bien en ambos.

---

## 2. Hallazgos

Formato: **ID. Título** — Dónde · Qué se ve · Por qué importa · Severidad · Propuesta · Esfuerzo.

### A. Primer uso y primer mensaje

**H1. El asistente «Conecta tu IA» es un muro de texto con dos acciones primarias** — `onboarding-conecta-dark-1280x800.png`, `onboarding-conecta-light-1280x800.png`

- Se ve: dos párrafos introductorios, un glosario («clave», «API key», «Proveedor»), tarjeta «Empezar gratis» con 3 líneas, tarjeta «OpenCode Go» con 5 líneas y campo «API key». El pie tiene «Continuar» (azul lleno) mientras «Usar el modelo gratuito» está en otra tarjeta resaltada: ¿qué se pulsa? El contenido hace scroll dentro del diálogo y el campo de clave queda pegado al borde.
- Problema: la ruta feliz (modelo gratuito) compite con una suscripción de pago y con jerga («API key», «credencial», «proveedor», «almacén de credenciales»). Un usuario no técnico se detiene aquí; es el paso donde más gente abandona.
- Severidad: **alta**.
- Propuesta: dejar visible solo «Usar el modelo gratuito» (botón primario único; «Continuar» se activa/renombra tras elegirlo) y plegar «Tengo una clave u otro servicio» en un `<details>` cerrado. Quitar el glosario y sustituirlo por un título de una línea («Elige cómo quieres empezar»). Acortar la tarjeta de OpenCode Go a 2 líneas.
- Esfuerzo: **bajo** (copy + plegado).

**H2. Primer mensaje: demasiadas decisiones antes de escribir** — `chat-vacio-dark-1280x800.png`, `onboarding-final-dark-1280x800.png`

- Se ve: tras 4 pasos aparece «Prepara tu equipo» (que dice «no hay nada más que instalar») con un segundo botón primario («Probar con un ejemplo») junto a «Empezar»; luego el chat vacío ofrece compositor + «Comparar» + selector de modelo + 4 tarjetas + 4 iconos de la barra.
- Problema: el paso 4 no pide nada al usuario (solo informa) y obliga a un clic de relleno; dos botones con el mismo peso. «Comparar» y el selector de modelo, antes de haber enviado un mensaje, son carga cognitiva.
- Severidad: **media**.
- Propuesta: fusionar el paso 4 con el final (o eliminarlo cuando «no hay nada que hacer»), dejar «Empezar» como único primario y «Probar con un ejemplo» como secundario (outline). En el chat vacío, ocultar «Comparar» hasta que exista al menos un mensaje enviado o moverlo al menú del selector.
- Esfuerzo: **bajo-medio**.

**H3. Bienvenida con poco contenido útil y un rótulo de marca en mayúsculas espaciadas** — `onboarding-inicio-dark-1280x800.png`

- Se ve: logo, título, frase y «Hecho por» + el nombre de la empresa en versalitas con tracking amplio y bajo contraste; «Lo dejamos listo en unos minutos» en gris; botón «Empezar» pequeño.
- Problema: la línea de autoría compite con el mensaje y es difícil de leer; «unos minutos» sin cifra de pasos (el siguiente paso dice «Paso 1 de 4» pero aquí no se anticipa). El botón es chico para ser la única acción de la pantalla.
- Severidad: **baja**.
- Propuesta: mover la autoría al pie (más pequeña) o a «Acerca de»; cambiar la frase por «4 pasos cortos · puedes empezar gratis»; subir el botón a tamaño `lg`.
- Esfuerzo: **bajo**.

**H4. Las tarjetas de inicio del Chat no explican qué hacen al pulsarlas** — `chat-vacio-dark-1280x800.png`

- Se ve: «Redactar / Lluvia de ideas / Explicar / Planificar» con un subtítulo.
- Problema: no queda claro si insertan un texto, abren un asistente o envían directamente; en la segunda sesión (`selector-modelo-dark-1280x800.png`) las ideas se pliegan tras «Ideas para empezar / Mostrar ideas», bien, pero el estado «plegado» no avisa que es una preferencia persistente.
- Severidad: **baja**.
- Propuesta: al pulsar, rellenar el compositor con un arranque editable y enfocar el campo (sin enviar); añadir `title` con el texto exacto que se insertará.
- Esfuerzo: **bajo**.

### B. Jerga y claridad de lenguaje

**H5. Jerga técnica y marcas internas expuestas en toda la interfaz** — `ajustes-general-dark-1280x800.png`, `ajustes-modelos-dark-1280x800.png`, `onboarding-conecta-dark-1280x800.png`, `tareas-permiso-dark-1280x800.png`

- Se ve: «servidor local de OpenCode», «MCP», «API key», «origen: credencial guardada», «OpenCode Go», «Modo auto», «Sitios permitidos», «Entregables», «Contexto», «Actividad», «Commit», «cron avanzado», «Fake (E2E)», y el aviso largo de Overdrive que lista «OpenAI, Google, OpenRouter, DeepSeek, Bedrock, Azure, Vertex».
- Problema: el público declarado es amplio («conversa contigo y hace tareas en tu computador»); estos términos exigen conocimiento previo. Algunos nombres de sección de Ajustes (Overdrive, Modo auto, MCP) no se entienden sin contexto.
- Severidad: **alta** (afecta a casi todas las pantallas).
- Propuesta: (a) renombrar en la UI «API key» → «Clave de acceso», «MCP» → «Conectores (MCP)», «Entregables» → «Archivos creados», «Contexto» → «Fuentes y conexiones», «Actividad» → «Historial de la tarea»; (b) en Ajustes, añadir una línea de descripción bajo cada elemento del menú lateral al pasar el ratón o en el título de la página; (c) esconder detalles de proveedores tras un «Más información». Mantener «Commit» solo en Code (público técnico).
- Esfuerzo: **medio** (copy en `src/shared/i18n/es/*` + guardias `visible-terms`).

**H6. Ajustes > General explica la limitación del inglés con una frase confusa** — `ajustes-general-dark-1280x800.png`

- Se ve: «El inglés está en beta: Code, Overdrive y Rutinas siguen en español por ahora».
- Problema: avisa de un límite sin decir qué ocurrirá al cambiar (¿se mezcla el idioma?). Mezcla producto y estado de desarrollo.
- Severidad: **baja**. Propuesta: «Con English, Chat y Ajustes cambian; Code, Overdrive y Rutinas se mantienen en español.» Esfuerzo: **bajo**.

**H7. Texto de relleno mal redactado en la tarjeta de primer uso de Overdrive** — `tareas-primer-uso-dark-1280x800.png`

- Se ve: botón «Rellenar una tarea de prueba» (centrado en 2 líneas), «Cómo usar las tareas de forma segura» y «Entendido, no mostrar más».
- Problema: «Rellenar» es ambiguo (¿ejecuta o solo escribe?) y los tres CTAs de la tarjeta tienen estilos distintos (ghost, banda azul, texto plano).
- Severidad: **baja**. Propuesta: «Escribir una tarea de ejemplo» y unificar a un primario + dos de texto. Esfuerzo: **bajo**.

### C. Jerarquía visual, consistencia entre modos

**H8. El aviso de «Overdrive limitado a tu carpeta» es permanente, larguísimo y de alarma** — `tareas-permiso-dark-1280x800.png`, `tareas-lista-dark-1280x800.png`, `tareas-lista-dark-1000x700.png`

- Se ve: un recuadro ámbar de 4 líneas pegado bajo el compositor, también en tareas terminadas y en un modo («Solo en tu carpeta») que es el seguro.
- Problema: ruido crónico: el usuario aprende a ignorarlo, y entonces también ignorará avisos reales. Ocupa ~15 % de la altura a 1000x700. Lista de proveedores sin valor para la decisión del usuario.
- Severidad: **alta**.
- Propuesta: mostrarlo solo cuando el modelo elegido no es compatible con el modo actual, en una línea («Este modelo necesita Control total. Cambiar modelo / Cambiar modo») y con estilo informativo, no de advertencia. El detalle de proveedores va a un enlace «Ver cuáles».
- Esfuerzo: **bajo-medio**.

**H9. Rutinas rompe el esquema de navegación de los otros modos** — `rutinas-vacio-dark-1280x800.png`, `rutinas-dark-1280x800.png` frente a `chat-vacio-...`, `code-proyecto-...`

- Se ve: Chat, Code y Overdrive tienen barra lateral con «Nueva …», buscador y lista; Rutinas no (solo el riel de iconos y un panel central). El título «Rutinas» queda desplazado respecto al contenido, y el botón de acción principal «Nueva rutina» solo aparece en la cabecera cuando ya hay rutinas; en el estado vacío es «Empezar desde cero» (secundario, abajo).
- Problema: el atajo ⌘N y la ubicación del botón principal cambian de modo en modo; el usuario pierde el hábito de «lo nuevo está arriba a la izquierda».
- Severidad: **media**.
- Propuesta: usar el mismo esqueleto con una lista lateral de rutinas (o al menos colocar siempre «Nueva rutina» como primario en la cabecera, también vacío) y que «Empezar desde cero» sea el primario del estado vacío, con las 4 plantillas debajo.
- Esfuerzo: **medio** (reutilizar `SidebarTree`) / **bajo** si solo se mueve el botón.

**H10. Etiquetas de «Nueva …» cambian de verbo y de lugar** — `chat-vacio`, `code-proyecto`, `tareas-nueva`, `rutinas`

- Se ve: «Nueva conversación», «Nueva sesión», «Nueva tarea», «Nueva rutina»; en Code la lista usa «Agregar proyecto» y un «+» junto al proyecto, en Overdrive «+» carpeta y selector de carpeta, en Chat nada de lo anterior.
- Problema: «sesión» (Code) y «conversación» (Chat) designan lo mismo para el usuario no técnico; el vocabulario de la lista (por fecha / Todas-Activas-Cambios / En curso-Hoy) también difiere.
- Severidad: **baja**. Propuesta: unificar a «Nueva conversación» en Chat y Code (Code puede decir «Nueva sesión de código» solo en la ayuda) y mantener un único patrón de agrupación (En curso / Hoy / Ayer). Esfuerzo: **bajo**.

**H11. Dos botones de acción en la tarjeta de resultados de Rutinas compiten** — `rutinas-bandeja-dark-1280x800.png`

- Se ve: por resultado, «Abrir la sesión» (enlace), «Ver detalle», «Volver a ejecutar», «Descartar», «Aprobar»: cinco acciones en una fila; solo «Aprobar» tiene relleno.
- Problema: aprobar/descartar son decisiones, «Volver a ejecutar» y «Ver detalle» son consultas; mezcladas se confunden. Tampoco dice qué implica «Aprobar» (¿marca como leído? ¿aplica cambios?). Las tarjetas dicen «Respuesta simulada» (arnés), pero la estructura es la misma con texto real.
- Severidad: **media**. Propuesta: «Ver detalle» como click en toda la tarjeta; dejar «Aprobar» y «Descartar» a la derecha y «Volver a ejecutar» + «Abrir la sesión» dentro de «…»; añadir tooltip/descripción de Aprobar («Marcar como revisado»). Esfuerzo: **bajo**.

**H12. Diferencias de densidad y de peso en las barras superiores** — `code-proyecto-dark-1280x800.png`, `chat-herramientas-dark-1280x800.png`, `tareas-lista-dark-1280x800.png`

- Se ve: Chat muestra título + 3 iconos + píldora «Normal»; Code muestra proyecto, rama, título, «Entorno», 2 iconos, selector triple «Resumen / Normal / Detallado» y 6 iconos más; Overdrive, estado, «Normal», alcance, «Entorno», «…», carpeta, panel.
- Problema: «Normal» (Chat) y «Resumen / Normal / Detallado» (Code) no se explican (¿qué detalle?); iconos sin etiqueta (ramificación, destellos, panel) obligan a pasar el cursor. En Code hay 11 controles en una barra.
- Severidad: **media**. Propuesta: renombrar a «Vista: Resumida / Normal / Completa» con tooltip explícito; agrupar los iconos de panel (Cambios, Terminal, Archivos, Navegador) en un único grupo con etiqueta cuando hay ancho (ya existe en `code-terminal-pestanas-dark-...`) y los de acciones de sesión (compartir, memoria) en un menú «…». Esfuerzo: **medio**.

### D. Ventana pequeña (1000x700)

**H13. En Code, con el panel lateral abierto, la cabecera se recorta** — `code-diff-dark-1000x700.png`

- Se ve: el nombre del proyecto queda «tienda-…», el título de la sesión desaparece («/ Entorno»), y el botón de vista «Normal» queda cortado en el borde derecho (solo se ve medio icono de ojo).
- Problema: controles inaccesibles y pérdida de contexto (¿qué sesión estoy viendo?). A 1000x700 el riel + barra lateral + panel dejan ~700 px de columna central.
- Severidad: **alta** (defecto visible y reproducible).
- Propuesta: colapsar automáticamente la barra lateral al abrir un panel derecho con ventana <1100 px, o mover «Vista» y los iconos secundarios a un menú «…» por debajo de un punto de quiebre; garantizar `min-width` para el título.
- Esfuerzo: **medio**.

**H14. Ajustes a 1000x700 tiene tres columnas apiladas** — `ajustes-modelos-dark-1000x700.png`

- Se ve: riel (60 px) + barra lateral de conversaciones (~480 px) + menú de ajustes (~420 px) + contenido (~800 px).
- Problema: la barra lateral de conversaciones no aporta en Ajustes y le roba el 25 % del ancho; los selectores acaban con texto truncado («Usar el predeterminado (Fake Model · Fake (E…»).
- Severidad: **media**. Propuesta: ocultar la barra de conversaciones mientras Ajustes está abierto (o hacerla colapsable por defecto) y acortar el texto de la opción por defecto a «Predeterminado». Esfuerzo: **bajo**.

**H15. El panel de Ajustes > Modelos pasa a una columna (etiqueta arriba, selector debajo)** — `ajustes-modelos-dark-1000x700.png`

- Es correcto como adaptación, pero genera mucho scroll: cada fila ocupa ~270 px. Propuesta: mantener 2 columnas hasta 900 px y reducir padding vertical. Severidad **baja**; esfuerzo **bajo**.

### E. Descubribilidad y estados vacíos

**H16. Interacciones clave solo visibles al pasar el ratón o en la ayuda** — `chat-conversacion-dark-1280x800.png`, `code-proyecto-dark-1280x800.png`

- Se ve: acciones de mensaje (copiar, reintentar) como dos iconos sin texto bajo la respuesta; en Code, el pie con atajos («/ comandos, @ archivos, ⇧Tab Plan/Build, ⇧↵ nueva línea») solo aparece con el compositor enfocado; el selector de «Build/Plan» y el modo de permisos son iconos sin texto cuando la columna se estrecha (`code-terminal-pestanas-dark-1280x800.png`: martillo, micrófono, escudo, «…»).
- Problema: el icono de escudo («Preguntar siempre») y el martillo («Build») son decisiones de seguridad/flujo que el usuario debería entender, y quedan ocultas.
- Severidad: **media**. Propuesta: mantener el texto de «Build» y «Preguntar siempre» siempre que haya ≥ 340 px, y mostrar el modo activo como chip con color cuando no es el predeterminado. Esfuerzo: **medio**.

**H17. Estado vacío del panel de cambios no ayuda** — `code-diff-dark-1280x800.png`, `code-diff-dark-1000x700.png`

- Se ve: «2 por revisar» con dos archivos listados y debajo, un panel vacío con «Selecciona un archivo para ver sus cambios.» que ocupa el 70 % del panel.
- Problema: el usuario ya llegó con la intención «Revisar»; exigir otro clic es fricción.
- Severidad: **media**. Propuesta: seleccionar automáticamente el primer archivo modificado y mostrar su diff. Esfuerzo: **bajo**.

**H18. Estados vacíos de lista: «Abre una carpeta con + o empieza con ⌘N» en Chat** — `chat-vacio-dark-1280x800.png`, `tareas-primer-uso-dark-1280x800.png`

- Se ve: en Chat vacío dice «Aún no hay conversaciones. Abre una carpeta con + o empieza con ⌘N.» Pero Chat no tiene «+»/carpetas (eso es de Code/Overdrive); en Overdrive repite «Abre una carpeta con + o empieza con ⌘N» aunque la carpeta ya está elegida (Informes).
- Problema: instrucción incorrecta o confusa; mensaje reutilizado sin adaptar.
- Severidad: **media**. Propuesta: Chat: «Tus conversaciones aparecerán aquí. Empieza escribiendo abajo.» Overdrive: «Aún no hay tareas en Informes. Describe una abajo.» Esfuerzo: **bajo**.

**H19. El indicador de estado «Conectado» de la barra lateral no es accionable ni informativo** — varias, p. ej. `chat-vacio-dark-1280x800.png`

- Se ve: punto verde + «Conectado», sin más. ¿Conectado a qué (motor local, modelo, internet)?
- Problema: si falla, el usuario no sabe dónde hacer clic. No se capturó la variante de error.
- Severidad: **baja**. Propuesta: texto «Motor listo» / «Reconectando…» con clic que abre Diagnóstico. Esfuerzo: **bajo**.

### F. Accesibilidad (código)

**H20. La lista de mensajes no es una región viva** — `src/renderer/src/features/chat/ChatMessageList.tsx`

- Se ve en código: no hay `role="log"` ni `aria-live`; sí lo hay en el HUD de progreso (`ChatProgressHud.tsx`) y tarjetas de espera.
- Problema: un lector de pantalla no anuncia que llegó la respuesta del asistente; tampoco la petición de permiso en Overdrive, salvo el estado de «Esperando tu aprobación».
- Severidad: **media**. Propuesta: contenedor con `role="log" aria-live="polite" aria-relevant="additions"` y anunciar «Respuesta completa» al terminar el streaming (no cada token). Esfuerzo: **medio** (evitar locuacidad en streaming).

**H21. Controles solo de icono con etiqueta pero sin texto visible y objetivos pequeños** — `code-proyecto-dark-1280x800.png` (barra superior), `chat-conversacion-dark-1280x800.png`

- Se ve: iconos de ~16 px sin borde en la barra; los de acción de mensaje (copiar/reintentar) ~18 px. Tienen `aria-label`, pero el área de clic parece <32 px.
- Problema: precisión del puntero y objetivo táctil (Windows con pantalla táctil).
- Severidad: **baja**. Propuesta: garantizar `min-h/min-w` de 28-32 px con padding invisible. Esfuerzo: **bajo**.

**H22. Contraste de texto secundario sobre superficies elevadas** — `chat-vacio-dark-1280x800.png` (subtítulos de tarjetas), `rutinas-vacio-dark-1280x800.png` (descripción de plantillas), `ajustes-modelos-dark-1000x700.png`

- Se ve: gris medio (`--fg-subtle` #858b9c en oscuro, #61697c en claro) sobre tarjetas ligeramente más claras. Hay un test de contraste, pero valida pares de tokens, no cada combinación sobre cada superficie; a ojo pasa en oscuro y queda justo en el texto de plantillas y «Terminado · ahora».
- Severidad: **baja**. Propuesta: extender `contrast.test.ts` para cubrir `--fg-subtle` sobre `--bg-elevated`/tarjetas y subir un paso el tono si no llega a 4.5:1. Esfuerzo: **bajo**.

### G. Feedback, errores y carga

**H23. Selector de modelo: el panel se abre hacia arriba y toca el borde de la ventana** — `selector-modelo-dark-1280x800.png`

- Se ve: la lista se despliega sobre el compositor (centrado en pantalla) y su campo «Buscar modelo…» queda pegado al borde superior de la ventana, parcialmente bajo la cabecera.
- Problema: con listas largas puede recortarse (no se probó con muchos modelos). Además la etiqueta «recomendado» se escribe en minúscula, mientras en Ajustes es «Recomendado».
- Severidad: **media**. Propuesta: limitar altura (`max-h: calc(100vh - 160px)`) con scroll interno y fijar la búsqueda arriba; unificar la capitalización. Esfuerzo: **bajo**.

**H24. «Cargando» y errores no se evidencian en las capturas del arnés; faltan escenarios** — N/A

- Hallazgo de proceso: `docs/CAPTURAS-ESCRITORIO.md` no tiene escenarios de error de motor caído, límite de uso agotado, red caída, modelo sin respuesta o cuota gratuita. El estado «aviso-motor» sí existe pero solo para otra ruta.
- Severidad: **media**. Propuesta: añadir 4 escenarios (`chat-error-modelo`, `chat-limite`, `motor-caido`, `sin-red`) para poder auditarlos. Esfuerzo: **medio**.

**H25. Doble acción de agradecimiento en copiado y reintento sin confirmación visible** — `chat-conversacion-dark-1280x800.png`

- Se ve: iconos de copiar y reintentar; no se ve (en la captura estática) qué feedback dan. El botón «Copiar» del bloque de código sí es etiquetado.
- Severidad: **baja**. Propuesta: cambiar el icono a ✓ durante 1,5 s y anunciar «Copiado» en una región viva. Esfuerzo: **bajo**. (Verificar en la app real; no observable en captura.)

---

## 3. Evaluación por criterio

| Criterio                           | Nota                                                             | Comentario                                                                       |
| ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Jerarquía visual y foco            | Buena en Chat/Ajustes; irregular en Onboarding, Overdrive y Code | H1, H2, H8, H12                                                                  |
| Claridad del lenguaje              | Débil                                                            | H5, H6, H7, H18                                                                  |
| Consistencia entre modos           | Media                                                            | H9, H10, H12; los componentes (compositor, tarjetas, píldoras) sí son coherentes |
| Densidad y espacios                | Buena a 1280x800; justa a 1000x700                               | H13, H14                                                                         |
| Tipografía (≥12 px)                | Muy buena                                                        | Guardia de CI (§1.2)                                                             |
| Contraste y accesibilidad          | Buena base; huecos en vivo/lector                                | H20, H21, H22                                                                    |
| Descubribilidad                    | Media                                                            | H16, H17, paleta ⌘K bien                                                         |
| Estados vacíos                     | Mixtos                                                           | Rutinas excelente; Chat/Overdrive con texto equivocado (H18)                     |
| Carga/error                        | No evaluable por el arnés                                        | H24                                                                              |
| Feedback de acciones               | Bueno en permisos y rutinas                                      | H11, H25                                                                         |
| Iconografía y botones              | Coherente (línea fina, 1 primario azul)                          | Fallan los pares de primarios (H1, H2)                                           |
| Ventana pequeña                    | Defectos concretos                                               | H13, H14                                                                         |
| Carga cognitiva del primer mensaje | Alta (4 pasos + ~10 controles)                                   | H1-H4                                                                            |

---

## 4. Top 15 priorizado (impacto / esfuerzo)

| #   | Hallazgo                                                                 | Severidad | Esfuerzo   | Por qué primero                                         |
| --- | ------------------------------------------------------------------------ | --------- | ---------- | ------------------------------------------------------- |
| 1   | **H13** Cabecera de Code recortada a 1000x700                            | Alta      | Medio      | Defecto visible; ventana pequeña es común en portátiles |
| 2   | **H8** Aviso ámbar permanente de Overdrive                               | Alta      | Bajo-medio | Presente en cada tarea; entrena a ignorar avisos        |
| 3   | **H1** Paso «Conecta tu IA» con jerga y dos primarios                    | Alta      | Bajo       | Mayor punto de abandono                                 |
| 4   | **H18** Textos de estado vacío incorrectos                               | Media     | Bajo       | Cambio de copy, impacto inmediato                       |
| 5   | **H17** Auto-seleccionar el primer archivo en Cambios                    | Media     | Bajo       | Quita un clic en el flujo principal de Code             |
| 6   | **H2** Simplificar el final del asistente y ocultar «Comparar» al inicio | Media     | Bajo-medio | Reduce carga del primer mensaje                         |
| 7   | **H5** Reescribir jerga (API key, MCP, Entregables, Contexto…)           | Alta      | Medio      | Mejora comprensión en toda la app                       |
| 8   | **H11** Simplificar acciones de la bandeja de Rutinas                    | Media     | Bajo       | Decisión clara aprobar/descartar                        |
| 9   | **H14** Ocultar la barra de conversaciones en Ajustes                    | Media     | Bajo       | Gana 25 % de ancho a 1000x700                           |
| 10  | **H23** Altura máxima y capitalización en el selector de modelo          | Media     | Bajo       | Previene recorte con muchos modelos                     |
| 11  | **H20** Región viva para respuestas y permisos                           | Media     | Medio      | Accesibilidad para lector de pantalla                   |
| 12  | **H9** Llevar «Nueva rutina» a la cabecera y estructura común            | Media     | Bajo-medio | Consistencia entre modos                                |
| 13  | **H12** Renombrar y agrupar controles de la barra de Code                | Media     | Medio      | Menos iconos sin etiqueta                               |
| 14  | **H16** Mostrar siempre «Build» y «Preguntar siempre» si hay espacio     | Media     | Medio      | Hace visibles las decisiones de seguridad               |
| 15  | **H24** Añadir escenarios de error/carga a las capturas                  | Media     | Medio      | Habilita una auditoría que hoy no se puede hacer        |

_Quedan fuera del top por bajo impacto: H3, H4, H6, H7, H10, H15, H19, H21, H22, H25 (todos de esfuerzo bajo; conviene agruparlos en una tanda de pulido de copy y tamaños)._

---

## 5. Lista de capturas generadas (muestra)

Oscuro 1280x800: `chat-vacio`, `chat-conversacion`, `chat-herramientas`, `paleta`, `selector-modelo`, `dialogo-confirmar`, `ajustes-general`, `ajustes-modelos`, `ajustes-memoria`, `ajustes-instrucciones`, `code-proyecto`, `code-diff`, `code-terminal`, `code-terminal-pestanas`, `code-ejecutar`, `onboarding-inicio`, `onboarding-conecta`, `onboarding-final`, `tareas-primer-uso`, `tareas-nueva`, `tareas-lista`, `tareas-permiso`, `rutinas-vacio`, `rutinas`, `rutinas-editor`, `rutinas-bandeja`.
Claro 1280x800: las mismas salvo `tareas-plan-sin-apps` y `code-terminal-pestanas`.
Oscuro 1000x700: `chat-vacio`, `chat-conversacion`, `ajustes-general`, `ajustes-modelos`, `code-proyecto`, `code-diff`, `tareas-lista`, `rutinas` (verificar nombres con `ls CAP`).
