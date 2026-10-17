# Observación directa de la interfaz de Claude (escritorio, Windows) y ChatGPT/Codex (escritorio, Mac)

Fecha: 2026-10-17. Hecha con permiso del dueño, mirando solo la interfaz (estética y funciones), sin leer código fuente ni abrir conversaciones a propósito. Se omiten nombres de proyectos y contenido de conversaciones.

## Claude (escritorio, modo Code)

- **Barra lateral:** búsqueda, «Nuevo» (Ctrl+N), «Artefactos», «Personalización», «Más» (Proyectos Beta, Programados, «Editar barra lateral»: la barra es configurable). Debajo, las sesiones **agrupadas por proyecto o entorno** (cada grupo con «+» para crear sesión ahí; secciones «Este equipo», «Nube», «Remote Control»). Abajo, perfil con plan.
- **Selector de modo** (Chat / Code) como dos íconos arriba a la izquierda.
- **Sesión nueva:** fondo con arte de píxeles, tarjeta central con el proyecto y «Elegir entorno», y un botón **«Importar N sesiones de la CLI»** (traen lo que el usuario ya tenía en la línea de comandos).
- **Caja de escribir** («Describe una tarea o haz una pregunta»): «+», micrófono, y debajo **chips de contexto**: entorno («Este equipo»), proyecto, **modo de permisos («Auto»)** y **modelo + esfuerzo («Sonnet 5.5 Medio»)**.
- **Menú de permisos:** Auto («Claude gestiona las decisiones de permisos»), Manual («Preguntar siempre antes de realizar cambios»), Aceptar ediciones, Plan («Crear un plan antes de hacer cambios»), Omitir permisos (desactivado salvo en la configuración). Cada opción con una frase explicativa.
- **Menú de modelo:** lista corta con **atajo numérico** (1–4), «Predeterminado» marcado, submenú «Esfuerzo» y «Más modelos».
- **Panel de sesión:** conversación al centro y a la derecha paneles apilables (navegador y terminal, con título, acciones y atajo «Expandir Ctrl+Shift+\»). Tarjeta «Entorno» arriba a la derecha con el entorno y la rama.
- **Personalización:** un solo lugar con pestañas «Skills / Conectores / Plugins», «Tuyos / Descubrir», buscador, filtros, «Añadir», una portada destacada y tarjetas con ícono, descripción, publicador y **número de instalaciones**.
- **Artefactos:** galería con «Crea algo nuevo» (Documents, Diapositivas, Diseño, Panel) y **tarjetas con miniatura real** y fecha de edición; filtros «Todo / Tuyos / Compartido contigo».
- **Perfil:** Ajustes (Ctrl+,), Uso, Idioma, Ayuda, Mejorar plan, Apps y extensiones, Ver registro de cambios, Claves de API, Cerrar sesión.
- **Estados de carga y error:** pantallas de **esqueleto** (rectángulos grises) mientras llegan los datos; aviso claro «El entorno de esta sesión se eliminó. Inicia una nueva sesión para seguir trabajando».
- **Actualización:** aviso dentro de la terminal («Update installed · Restart to update»).

## ChatGPT con Codex (escritorio, Mac)

- **Riel de íconos** a la izquierda (Inicio, Imágenes, Programado, Biblioteca, Complementos, Explorar, Revisión de código) y, al lado, lista de «Proyectos» y «Recientes».
- **Inicio muy despejado:** logo, «¿Qué quieres que creemos?» y una caja de escribir con el permiso a la vista («Solicitar aprobación»), modelo y esfuerzo, micrófono.
- **Menú «+»:** «Agregar» (archivos y carpetas, proyecto, objetivo, modo plan, dibujar) y «Complementos» (Documents, PDF, Spreadsheets).
- **«Primeros pasos 0 de 4»**: lista de bienvenida siempre visible en un rincón.
- **Configuración** con **buscador** y dos niveles: Personal (General, Notificaciones, Importar, Perfil, Apariencia, Cuenta, Chats archivados, Controles parentales, Contacto de confianza, Voz, Almacenamiento, Configuración, Personalización, Mini y mascotas, Atajos de teclado, Uso y facturación, Controles de datos) e Integraciones (Complementos, Contraseñas).
- **Permisos explicados con franqueza**: «Permisos predeterminados» y «Acceso completo», con un texto que advierte el riesgo, en un interruptor cada uno.
- **«Importar»** ajustes desde otras apps.

## Lo que no se pudo ver
- La **configuración (Ajustes) de Claude**, por la dificultad de manejar la sesión remota.
- Recorridos más profundos de ChatGPT/Codex (la app no respondió a mis clics).
- Aprobaciones en acción y cómo muestran el trabajo del agente paso a paso en una sesión real.

## Segunda pasada (2026-10-17, con mouse real)

Solo interfaz; se omiten datos personales que aparecieron en pantalla (fotos de la Biblioteca de ChatGPT, temas de la memoria de Claude, nombres de proyectos).

### ChatGPT con Codex (Mac)
- **Imágenes:** galería de plantillas de ejemplo («Tendencias» / «Templates») con caja «Describe una imagen nueva».
- **Se programó:** «Programar una tarea» con 8 recetas listas (resumen de noticias, seguir a la competencia, planificar la semana…) y lista «Próximas».
- **Biblioteca:** todo lo creado o subido, pestañas Sugeridos / Favoritos / Carpetas / Imágenes / Todo, buscador, vista cuadrícula/lista y botón «Nuevo».
- **Complementos / Skills:** «Populares», «Nuevos y destacados», «Instaladas» y «Sistema», buscador y «Agregar».
- **Revisión de código:** pantalla propia para conectar GitHub/GitLab.
- **Configuración:** buscador y ~20 secciones en tres grupos (Personal, Integraciones, Programación), incluidas Atajos de teclado, Uso y facturación, Controles de datos, Hooks, Worktrees, Entornos.
- **Permisos en la caja:** «Solicitar aprobación», «Aprobar por mí», «Acceso completo» (naranja, con advertencia).
- **Conversación:** el trabajo se pliega en «Procesado durante 6s ›»; al abrirlo, una línea por paso («Editó un archivo y ejecutó un comando»); copiar y pulgares por respuesta.

### Claude (Windows)
- **Ajustes:** buscador; grupos Configuración (General, Cuenta, Privacidad, Facturación, Uso, Capacidades, Memoria, Sistemas de diseño, Reflexión, Tiempo y concentración, Claude Code, Claude in Chrome), Este ordenador (Sistema, Extensiones, Desarrollador), Personalización (Skills, Conectores, Plugins), Plataforma.
- **Uso:** frase llana arriba («Todo en orden. Deberías llegar al reinicio…») y barras de sesión, semana y por modelo con su hora de reinicio.
- **General:** tema, fuente y tamaño del chat, ancho de la transcripción, movimiento reducido, carpetas de confianza («Gestionar»), navegador preferido, voz.
- **Claude Code:** clasificar estados de sesión, tema del código con vista previa de un diff, fuente de código, fuente de la interfaz (incluye OpenDyslexic), vista de la transcripción (Normal / Razonamiento / Detallado).
- **Capacidades:** interruptores con una frase cada uno (búsqueda de conectores, artefactos, visualizaciones, ejecución de código, red saliente con aviso de riesgo).
- **Memoria:** interruptores, «Importar memoria de otros proveedores», lista por temas editable y caja «Dile a Claude qué debe cambiar».
- **Reflexión:** resumen del último mes basado en tus chats.
- **Tiempo y concentración:** recordatorios de descanso y horas de silencio por día.
- **Sistema:** versión, ejecutar al iniciar, atajo de Entrada rápida, atajo de dictado, bandeja, mantener equipo activo, almacenamiento.
- **Extensiones:** arrastrar archivos .MCPB/.DXT para instalar.
- **Artefactos:** «Crea algo nuevo» (Documentos, Diapositivas, Diseño, Panel) y tarjetas con miniatura real; filtros Todo / Tuyos / Compartido contigo.
- **Programadas:** vacío con «Nueva tarea» y 8 plantillas con horario sugerido (resumen diario, clasificar correos, revisar PR, notas de versión…).
- **Caja:** «+» (archivos o fotos Ctrl+U, carpeta, incidencia de GitHub, comandos de barra, conectores, plugins); permisos Auto / Manual / Aceptar ediciones / Plan / Omitir permisos; modelo con atajos 1–4, «Predeterminado», Esfuerzo y «Más modelos».
