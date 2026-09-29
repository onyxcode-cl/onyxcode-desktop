# Lote B de Cowork: qué se entregó, decisiones y guía de pruebas

> Documento histórico. "Cowork" es el nombre interno del modo que la app muestra como "Tareas"; las menciones a productos de terceros eran referencias de diseño.

Plan de origen: `docs/archive/COWORK-LOTE-B-PLAN.md` (arquitectura, contratos y reparto en oleadas). Antecedente:
`docs/COWORK-LOTE-A.md` (Cowork autónomo: plan por sesión, niveles por app, escalada, búsqueda web).
Hallazgos de seguridad y su estado: `AUDIT.md` §9. Modelo de seguridad vigente: `docs/SEGURIDAD.md` («3 bis»).
Comparación de funciones con otras herramientas: notas privadas, fuera del repositorio.

> Nota de nombres: el producto se llama «OnyxCode» pero el código sigue diciendo «OnyxCode» (`APP_NAME`,
> `.onyxcode/memoria.md`, `onyxcode-plan-gate`, `temp/onyxcode-computer`…). No se renombró nada.

## 1. Qué se entregó, por área

Oleadas 1 y 2 (contratos, main y estado del renderer): verificadas por el orquestador (typecheck y build).
Oleada 3 (interfaz) se cerraba a la vez que se escribió este documento: cada punto marcado «(UI)» depende de
un componente de esa oleada.

### 1.1 Contratos y cableado
- `src/shared/ipc-cowork.ts`, `src/main/ipc/schemas.ts`: canales nuevos `cowork:folders:*`, `cowork:trusted:*`,
  `cowork:policy`, `cowork:activity` (invoke y evento), `cowork:viewing`, `cowork:tasks:*`, `cowork:prefs:*`,
  `cowork:storage:*`, `cowork:agentsMd:*`, `cowork:mcp:*`, `cowork:rules:*`, `cowork:zip`, `cowork:quickLook`,
  `cowork:exportMarkdown`, `cowork:htmlToPdf`. `CHANNEL_ROLES` no se tocó.
- `src/shared/cowork-prompt.ts` (`buildCoworkSystemPrompt`: instrucciones globales, del proyecto, enlaces,
  memoria, carpetas adicionales y texto de ejecución desatendida) y `src/shared/cowork-glossary.ts`.
- `src/main/ipc/cowork-handle.ts` (`makeCoworkHandle`, `CoworkIpcContext`) y los submódulos
  `cowork-folders-handlers.ts`, `cowork-lifecycle-handlers.ts`, `cowork-project-handlers.ts`,
  `cowork-files-handlers.ts`; `cowork-handlers.ts` los registra y espera sus `dispose` al salir.
- `src/main/cowork/config-merge.ts` (`deepMerge` de la config inline: base + MCP + reglas recordadas + skills).

### 1.2 Seguridad y corrección
- **Puerta del plan en toda sesión** del servidor de Control total (sesiones hijas y otros agentes incluidos),
  con `computer.md` en `task: deny` (`opencode-config.ts`).
- **Mover y renombrar en el sandbox** (`sandbox-profile.ts`): prueba real con `sandbox-exec`; ver §3.
- **Rutinas que ya no fallan en silencio** (`scheduler/service.ts`, `scheduler/approvals.ts`).
- **Colisión de skills** con `~/.claude/skills`: `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` en el sandbox (`manager.ts`).
- **`textutil -convert pdf`** eliminado de los agentes.
- **Servidor de Control total con el XDG real del usuario**: documentado, no cambiado.

### 1.3 Carpetas y política
- Carpetas adicionales por espacio (`rw` / `ro`) y **carpetas de confianza** globales: `manager.ts`
  (`folderSet`, `linkFolder`, `unlinkFolder`, `trusted*`, `restartSandbox`), perfil Seatbelt con `extraFolders`
  y `scratchDirs`, reglas `external_directory` en la config inline (solo sandbox).
- `src/main/cowork/folder-policy.ts`: carpetas prohibidas con motivo accionable (raíz/home, sistema, `/Volumes`,
  volúmenes de red, userData, `~/Library`, iCloud, Papelera, rutas de secretos, raíces de la política).
- `src/main/cowork/policy.ts`: `managed.json` (`/Library/Application Support/OnyxCode/managed.json`) con
  validación fail-closed; se aplica en `manager.ts`, `rules.ts`, `prefs.ts` y `scheduler/service.ts`.
- Tarjeta de petición de carpeta y modos Lectura y escritura / Solo lectura (UI: `FolderRequestCard.tsx`,
  `FolderMenu.tsx`, `answerFolderRequest` en `actions.ts`).

### 1.4 Ciclo de vida, lista de tareas y almacenamiento
- **Monitor en main** (`cowork/monitor.ts`, independiente de Electron): sondea cada ~3 s todos los servidores
  vivos y aporta `cowork:activity`, notificaciones por tipo (`prefs.notify`) para las carpetas que el renderer no
  mira, «mantener despierto» por OR con el renderer (`keep-awake.ts`), parada por inactividad, tope de servidores
  y auto-archivo.
- `prefs.ts`, `tasks-meta.ts` (fijar, grupos, título; `cowork-tasks.json`), `storage.ts` (`du -sk`, limpiar caché
  o borrar todo de una carpeta parada) y `ComputerService.cleanScreenshots()`.
- Estado del renderer (`store.ts`, `actions.ts`, `util.ts`, `search.ts`, `transcript.ts`): estados `using_computer`,
  `plan_ready` y `archived`; búsqueda en transcripciones; editar y reintentar (`session.revert`); continuar en
  una tarea nueva; exportar a Markdown; consulta lateral; restaurar archivadas; modelo y esfuerzo por tarea.
- UI: barra lateral con Fijadas / Activas / Programadas y agrupación, ajustes «Cowork» (confianza, permisos
  recordados, notificaciones, auto-archivo, servidores, almacenamiento), compositor con modelo/esfuerzo/uso,
  onboarding y plantillas (`SidebarSections.tsx`, `CoworkSection.tsx`, `EffortPicker.tsx`, `Onboarding.tsx`, `Home.tsx`).
- Corrección del bug del stream SSE por carpeta (`connectFolder` cerraba el de la carpeta anterior): el stream
  del renderer sigue siendo el de la carpeta visible, pero se purgan los estados `busy` congelados de otros
  servidores y el estado de fondo lo da el monitor.

### 1.5 Proyecto, MCP, skills y permisos recordados
- Proyecto: enlaces, interruptor «Usar memoria», editor del `AGENTS.md` de la carpeta, lista de skills, contador
  `n / 20.000` (`projects.ts`, `cowork-project-handlers.ts`, `ProjectPanel.tsx`).
- **MCP del usuario en Cowork** (`mcp-cowork.ts`, `McpSection.tsx`): «Disponible en Cowork» y «Preguntar en cada
  uso»; locales con `/usr/bin/env -u …`; hosts remotos añadidos a la red del sandbox.
- **Skills** `docx`, `xlsx`, `pdf`, `pptx` (`resources/opencode/skills/`, copiadas a `userData/opencode-config/skills`,
  `asarUnpack` en `electron-builder.js`) y «Crear skill de esta tarea».
- **Permisos recordados** (`rules.ts`): «Siempre» se persiste por carpeta; nunca `external_directory`, `doom_loop`,
  `computer_*` ni borrados.
- Agentes `cowork.md` y `computer.md`: skills, carpetas adicionales, mover/renombrar, memoria desactivada.

### 1.6 Rutinas
Lista «Permitir sin preguntar» (permiso + patrón), «Rechazar y seguir / Esperar mi aprobación», sitios permitidos
solo durante la ejecución, «Empezar de cero / Continuar la misma tarea», historial con lo aprobado, lo rechazado,
los hosts bloqueados y «esperando aprobación», y **Control total** con consentimiento explícito. El prompt de la
rutina usa el mismo constructor que las tareas (instrucciones globales, del proyecto, enlaces, memoria, carpetas).
Plantillas con el patrón «primero revisa y resume, luego propón, luego actúa». `disableRoutines` (política) las bloquea.

### 1.7 Entregables y panel (UI y handlers de archivos)
Descargar todo (zip), Vista rápida (QuickLook), vista previa de docx/doc/rtf/odt (`textutil`), Abrir como artifact
y Guardar como PDF para HTML, sección «En vivo» y «Paso X de Y», retención de capturas en el diálogo de Control total
(`Deliverables.tsx`, `ProgressPanel.tsx`, `ComputerAccess.tsx`, `cowork/files.ts`, `cowork-files-handlers.ts`,
`extras/artifact-window.ts`).

### 1.8 Integración menor y glosario (W3-F)
- La notificación nativa de `request_access` (`cowork-handlers.ts`) respeta el interruptor global de notificaciones
  y `prefs.notify.approval` (lee `userData/cowork-prefs.json` en cada petición y lo normaliza con `normalizeCoworkPrefs`,
  porque el `CoworkPrefsStore` vive dentro de `cowork-lifecycle-handlers.ts`).
- Las capturas temporales se borran a los 60 s sin tareas de Control total en curso: ya lo hace
  `cowork-lifecycle-handlers.ts` (`syncScreenshotCleanup`), además de `stop()` y `dispose()` del `ComputerService`;
  no se duplicó en `cowork-handlers.ts`.
- Barrido del glosario: no quedaba ninguna cadena visible con «Acceso total», «acceso completo» ni «Carpetas
  autorizadas» en los archivos de W3-F; solo comentarios, ya cambiados a «Control total» en `cowork-handlers.ts`,
  `actions.ts` y `store.ts`. El hint de Cowork en Rutinas (`routines/impl/meta.ts`) ya no dice solo «en sandbox».

## 2. Decisiones sobre las preguntas abiertas

| Pregunta | Decisión | Dónde |
|---|---|---|
| Auto-archivo | **Desactivado por defecto** (`autoArchiveDays: 0`); opciones Nunca / 7 / 14 / 30 / 90 días; tope con `maxAutoArchiveDays` de la política | `DEFAULT_COWORK_PREFS`, `monitor.ts` |
| Mover y renombrar | Requiere el mismo permiso que borrar (comprobado): la concesión se llama **«Permitir borrar, mover y renombrar»** (`COWORK_TERMS.deleteGrant`). El «punto de restauración» APFS se aplaza | `cowork-glossary.ts`, `sandbox-profile.ts` |
| Rutinas en Control total | **Permitidas** con consentimiento explícito al guardarlas y **aprobación humana del plan en cada ejecución** (siempre en una tarea nueva); no son 100 % desatendidas | `scheduler/service.ts` |
| Hosts de MCP remotos | Se **añaden automáticamente** a la lista blanca de red al marcar el MCP «Disponible en Cowork» (visibles en Ajustes → Red; con `disableCustomHosts` no se suman) | `mcp-cowork.ts`, `manager.ts` |
| Valores de servidores | **15 min** de inactividad y **máximo 4** servidores (configurables: 0–1440 min, 1–12) | `DEFAULT_COWORK_PREFS`, `prefs.ts` |

Otras decisiones: la búsqueda web del sandbox sigue **activada por defecto** (Lote A); el envoltorio `env -u` se aplica
siempre a los MCP locales; las reglas de la lista blanca de una rutina las responde main (no se pasan a
`session.create`, así se registran y valen también al continuar una sesión); el borrado en carpetas `rw` adicionales
está siempre denegado (la concesión solo vale para la principal).

## 3. Qué se verificó y qué NO

### Verificado
- **Seatbelt real (`sandbox-exec`, prueba B del plan):** sin la concesión de borrado, `mv` (renombrar), mover a una
  subcarpeta, sobrescribir con `mv` y `rm` dan EPERM; **truncar (`: > archivo`) no está protegido**; el scratch `.cowork/`
  permite borrar. Por eso la concesión se renombró y la mitigación es `session.revert`.
- **Descubrimiento de skills** con un servidor sandbox real de OpenCode 1.18.32: `GET /skill` lista las de
  `OPENCODE_CONFIG_DIR/skills` (no hace falta `skills.paths`); los comandos de cada skill se probaron dentro del perfil
  Seatbelt (ver `resources/opencode/README.md`).
- **Harness sin Electron** (en el scratchpad de la sesión, no en el repo): contratos y esquemas (`w1a-*`), `config-merge`,
  `folder-policy` (`fp*`), política gestionada (`pol*`), manager (`mgr*`), monitor / prefs / storage / tasks-meta (`w2b/`),
  rutinas y `approvals` (`w2c/`), MCP local con el envoltorio `env -u` (`w2d/`: las cinco variables sensibles no aparecen),
  transcript / search / util (`w2e-*`), glosario.
- `npm run typecheck` y `electron-vite build` por el orquestador tras las oleadas 1 y 2.
- Este documento y los de seguridad se contrastaron contra el código (§5).

### NO verificado en vivo (hacerlo con la app real; ver §4)
- Que `agent.cowork.permission.external_directory` con `<ruta>` y `<ruta>/*` cubra las subcarpetas en OpenCode
  (revisar `/config` del servidor) y los patrones y metadata de `external_directory` (solo leídos del binario 1.18.32).
- Que la inyección de `onyxcode_session` y la puerta del plan sobre sesiones hijas funcionen en ejecución (la inyección
  se verificó solo leyendo el bundle en el Lote A): prueba 20.
- Que OpenCode lance los MCP locales heredando el `process.env` del servidor (el envoltorio se probó aparte).
- `session.update({time:{archived:0}})` para desarchivar (hay respaldo con `metadata.unarchivedAt`).
- `session.revert` en un sandbox con el git de Command Line Tools, y si «Editar y reintentar» deshace los archivos.
- Si `reply 'always'` de OpenCode sobrevive a un reinicio (`/api/permission/saved`); las reglas propias sí se persisten.
- Que `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` deje fuera una skill homónima de `~/.claude/skills`.
- Que `OPENCODE_WEBSEARCH_PROVIDER=exa` fije un único host en la búsqueda web (Lote A: prueba 11).
- La interfaz de la Oleada 3 de extremo a extremo (cada paquete la revisó con typecheck y banco de pruebas): tarjeta
  de carpeta y reanudación automática, agrupación, consulta lateral, ajustes, entregables (zip, QuickLook, PDF), onboarding.
- Rendimiento del monitor con muchas carpetas (sondeo cada 3 s por servidor vivo) y la parada por inactividad con
  trabajo real.
- Notificaciones nativas por tipo y su clic (`app:openTarget` con `fullAccess`).

## 4. Guía de prueba manual (`npm run dev -- --watch`)

Requisitos: modelo con visión para las pruebas de Control total; una carpeta A y otra B con archivos de prueba.

1. **Primer uso de Cowork:** aparece la tarjeta de onboarding (elige carpeta, qué puede y qué no en Sandbox y Control
   total, prueba una tarea). Descártala y comprueba que no vuelve.
2. **Carpetas prohibidas:** intenta autorizar `~`, `~/Library/Application Support`, un volumen SMB y la Papelera: cada una
   da su mensaje concreto (y iCloud Drive el suyo).
3. **Otra carpeta en Sandbox:** «Lee los PDF de ~/Descargas/informes y crea un resumen aquí».
   - Aparece la tarjeta «El agente quiere trabajar en otra carpeta» con la ruta y el motivo «según el agente, no verificado».
   - Permitir en Solo lectura reinicia el servidor sandbox (confirma antes si hay otras tareas en curso), y la tarea se
     reanuda sola y lee.
   - Si le pides escribir allí, falla y lo explica.
4. **Carpeta de confianza:** repite con «No volver a preguntar»: la carpeta queda en Ajustes → Cowork → Carpetas de
   confianza. Quítala desde ahí.
5. **Mover y renombrar:** «Ordena esta carpeta por tipo». Al mover aparece «Permitir borrar, mover y renombrar». Sin
   permiso, el agente ofrece una copia ordenada (`cp -c`) sin tocar los originales.
6. **Documentos:** crea un xlsx, un docx y un pdf: salen los archivos (el PDF, en texto plano si no se puede maquetar) o
   una explicación honesta con el botón «Guardar como PDF» para HTML.
7. **Entregables:** prueba Vista rápida, Descargar todo (zip) y Abrir como artifact en un HTML; y Guardar como PDF.
8. **Trabajo en segundo plano:** lanza una tarea larga en la carpeta A y cambia a la B.
   - En «Activas» aparece A trabajando.
   - Al terminar llega la notificación (y su clic abre la tarea).
   - «Mantener despierto» se apaga al acabar.
9. **Inactividad:** espera el tiempo configurado (Ajustes → Cowork → Servidores; por defecto 15 min, puedes bajarlo a 1):
   el servidor de A se detiene.
10. **Búsqueda:** busca una palabra que solo aparezca dentro de una respuesta: la encuentra y salta al punto de la
    conversación.
11. **Lista:** fija una tarea, agrúpala, archívala (desde «Archivadas») y restáurala.
12. **Modelo y esfuerzo:** cambia el modelo y el esfuerzo en una tarea: el modelo de Chat no cambia; al reabrir la tarea
    conserva su modelo. El medidor de uso se ve.
13. **Editar y reintentar:** edita y reintenta un mensaje (se deshacen los mensajes y cambios posteriores, con aviso).
    «Continuar en una tarea nueva». «Exportar a Markdown».
14. **Consulta lateral:** abre una, pregunta algo y comprueba que la tarea principal no cambia.
15. **Proyecto:**
    - El contador de instrucciones funciona (`n / 20.000`).
    - Añade un enlace y comprueba que el agente lo usa.
    - Con «Usar memoria» desactivado, el agente no escribe `.onyxcode/memoria.md`.
    - Edita `AGENTS.md` de la carpeta.
    - Ves la lista de skills.
16. **MCP en Cowork:** marca un MCP como «Disponible en Cowork» con «Preguntar en cada uso»: sale una tarjeta por
    herramienta. En Ajustes → Red aparece su host (si es remoto). Reabre la carpeta para que se aplique.
17. **Crear skill:** «Crear skill de esta tarea»: aparece en `.opencode/skills/…` y luego en la lista de skills.
18. **Rutina en Sandbox:** con «Esperar mi aprobación», al pedir `rm` llega la notificación y puedes aprobar desde la
    tarea. Con «Rechazar y seguir», el historial muestra lo rechazado. Prueba «Permitir sin preguntar» con `git status`
    (queda en «aprobado»).
19. **Rutina en Control total:** pide el consentimiento explícito al guardarla y, en cada ejecución, que apruebes el
    plan en persona (notificación «necesita que apruebes su plan»).
20. **Subagentes en Control total:** tras aprobar un plan, pide «usa un subagente para listar ~/Desktop»: el subagente
    queda bloqueado (fail-closed; `task` está en `deny` y la puerta se aplica a toda sesión).
21. **Limpieza:** cierra la app y comprueba que `temp/onyxcode-computer` ya no existe. En Ajustes → Cowork → Almacenamiento,
    limpia la caché de una carpeta parada.
22. **Política gestionada (opcional):** con la app sin empaquetar, `ONYXCODE_MANAGED_POLICY=/ruta/managed.json` con
    `{"disableRoutines": true, "allowedFolderRoots": ["~/Documents"]}`: aparece el banner «Gestionado por tu
    organización», no se pueden guardar rutinas y solo se aceptan carpetas dentro de Documentos. Con un JSON inválido en
    ese archivo se activan todas las restricciones.

## 5. Aplazado y fuera de alcance

**Aplazado** (posible, pero costoso o arriesgado):
- **Background por AX, helper firmado aparte, Teach mode, Record-a-skill y «ocultar otras apps»**: todos exigen cambiar
  `resources/computer-use/helper.swift`; recompilar cambia la firma y macOS olvida los permisos TCC (Accesibilidad,
  Grabación de pantalla). No hay una vía solo-TS segura; conviene hacerlos juntos con un plan de migración de permisos.
- **Navegador propio**: Playwright descarga ~150 MB de Chromium y Chrome dentro de Seatbelt choca con su propio sandbox,
  perfiles y proxy. Alternativa ya disponible: activar `chrome-devtools-mcp` como MCP «Disponible en Cowork» en Control total. *(Histórico, nota del 2026-09-29: además hoy existe el navegador integrado del Lote D; «Chrome aparte» se eliminó en el refactor fase 3.)*
- **Modo auto** (clasificador de permisos): necesita otro modelo por cada permiso, con riesgo de inyección.
- **Marketplace de plugins**: fase posterior (solo se listan las skills instaladas).
- **Snapshots APFS («punto de restauración») antes de conceder borrado**: la red de seguridad actual es `session.revert`.
- Sin abordar: panel Context, badge y rebote del Dock, formato unificado de errores.

**Fuera de alcance:** Dispatch (móvil → escritorio), Cowork en la nube, Hardware Buddy (BLE) y simuladores/emuladores.

## 6. Riesgos y avisos

- **Ampliar carpetas reinicia el servidor sandbox** e interrumpe las tareas en curso de esa carpeta (se pide confirmación;
  las sesiones persisten en el XDG privado).
- **Borrado:** la protección es contra `unlink`/`rename`; truncar no está protegido.
- **Rutinas en Control total:** siguen exigiendo aprobar el plan en persona.
- **Canales de salida nuevos:** búsqueda web (activada por defecto) y hosts de MCP remotos; visibles y revocables en Ajustes.
- **Servidor de Control total:** carga el `~/.config/opencode` global del usuario (MCP y plugins sin sandbox) y comparte
  `~/.local/share/opencode` con el sidecar principal. Documentado, no cambiado.
- **Parada por inactividad:** el monitor solo detiene servidores sin sesiones ocupadas, permisos ni preguntas pendientes,
  tras dos sondeos seguidos y sin estar mirados.
- **Reverificar al subir de versión de OpenCode:** rutas de skills, patrones de `external_directory`, `session.revert`,
  `/skill`, `/api/permission/saved`, la mutación de `onyxcode_session` y `OPENCODE_WEBSEARCH_PROVIDER`.

## 7. Archivos comprobados al escribir este documento

`src/main/ipc/cowork-handlers.ts`, `cowork-handle.ts`, `cowork-lifecycle-handlers.ts`, `cowork-folders-handlers.ts`,
`cowork-project-handlers.ts`, `cowork-files-handlers.ts`; `src/main/cowork/{manager,sandbox-profile,opencode-config,
policy,folder-policy,prefs,monitor,rules,mcp-cowork,proxy-policy,storage}.ts`; `src/main/scheduler/{service,approvals}.ts`;
`src/main/computer/service.ts`; `src/shared/{ipc-cowork,cowork-glossary,cowork-prompt}.ts`;
`src/renderer/src/features/cowork/impl/{actions,store,util,search,transcript,PermissionPrompt}.ts(x)`;
`resources/opencode/{README.md,agents/cowork.md,agents/computer.md,skills/*/SKILL.md}`; `electron-builder.js`.
