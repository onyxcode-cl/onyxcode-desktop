> Archivado: documento histórico; ver README.md y docs/FASE6-PLAN.md.

# Lote C de Cowork: qué se entregó, decisiones y guía de pruebas

Plan de origen: `docs/archive/COWORK-LOTE-C-PLAN.md` (arquitectura, contratos y reparto en paquetes C1–C5).
Antecedentes: `docs/COWORK-LOTE-A.md` (Cowork autónomo) y `docs/COWORK-LOTE-B.md` (carpetas, política,
ciclo de vida). Hallazgos de seguridad y su estado: `AUDIT.md` §10. Modelo de seguridad vigente:
`docs/SEGURIDAD.md` («3 ter»). Comparación con Claude Desktop, fila por fila:
`docs/analisis-claude/02-cowork.md` (filas 19, 35, 37, 42–45).

> Nota de nombres: el producto se llama «OnyxCode» pero el código sigue diciendo «OnyxCode» (`APP_NAME`,
> `.onyxcode/memoria.md`, `onyxcode-plan-gate`, `temp/onyxcode-computer`…). No se renombró nada.

Orden de los paquetes: **C1 solo y primero** (helper nativo, secuencial, aislado); **C2, C3 y C4 en
paralelo** (contratos, modo auto, navegador propio, sobre archivos disjuntos); **C5 solo y al final**
(interfaz, agentes, documentación, y el único que ejecutó `npx electron-vite build`).

## 1. Qué se entregó, por área

### 1.1 Helper nativo (C1)
- `resources/computer-use/helper.swift`: comandos nuevos `ax-tree`, `ax-find`, `ax-frame`, `ax-press`,
  `ax-set-value`, `ax-action`, `window-shot` (ScreenCaptureKit, no `CGWindowListCreateImage`: no
  disponible en el SDK usado aquí), `hide-apps`/`unhide-apps` (`NSRunningApplication`, sin TCC),
  `open-app-bg`, `record` (eventos + capturas por paso + micro opcional), `transcribe`
  (`SFSpeechRecognizer` en el dispositivo), `mic-permission`/`mic-request`.
- Códigos de salida nuevos (6 voz no autorizada, 7 app no en ejecución, 8 elemento cambió, 9 campo
  seguro, 10 valor no editable, 11 acción no permitida, 12 recurso no disponible) y `ref` = ruta de
  índices AX (`w<ventana>.<hijo>…` o `m.<i>…`).
- **Una sola recompilación** en todo el lote (`build.sh`), con el binario más nuevo que la fuente
  para que `npm run dev` no vuelva a compilar. Helper firmado aparte: **omitido** (sin identidad de
  Apple Developer disponible; `security find-identity` da 0).

### 1.2 Contratos y núcleo de main (C2)
- `src/shared/ipc-cowork.ts`: `ComputerPrefs`/`DEFAULT_COMPUTER_PREFS`, `AccessRequest.kind`
  (`'access' | 'takeover'`), `TeachStep`, `SkillRecordingState`/`RecordedStep`/`SkillRecording`,
  `AssistMessage`, `AutoModeSettings`/`AutoApprovalRecord`/`AutoModeState`/`AutoRuleId`,
  `BrowserState`/`BrowserSite`, `ManagedPolicy.disableAutoMode`/`disableBrowser`, canales
  `computer:prefs:*`, `computer:teachRespond`, `computer:record:*`, `cowork:auto:*`,
  `cowork:browser:*` y sus eventos (`computer:assist`, `computer:recordState`, `computer:recordDone`,
  `cowork:auto:approved`, `cowork:browser:changed`).
- `src/main/ipc/schemas.ts`: `WindowRole` añade `'assist'`; `CHANNEL_ROLES.assist =
  {'computer:teachRespond','computer:record:stop'}`; **`pill` no se tocó**. Validadores para todos
  los canales nuevos.
- `src/main/computer/service.ts`: endpoints laterales nuevos (`/tier`, `/control-mode`,
  `/request-access` con `kind`, `/teach-step`, `/teach-end`), `autoAccess` (≤1,5 s antes de emitir la
  tarjeta), `foregroundSessions` (una tarjeta `takeover` aprobada la puebla), `prefs`
  (`ComputerPrefsStore`), `teachStep`/`resolveTeach`.
- `src/main/computer/mcp-server.ts`: 9 herramientas nuevas (`app_tree`, `app_find`, `app_press`,
  `app_set_value`, `app_action`, `app_screenshot`, `request_full_control`, `teach_step`, `teach_end`),
  `requireTierFor` (nivel sobre la app NOMBRADA, no la de primer plano), rechazo de ratón/teclado real
  en modo `background` sin foreground.
- `src/main/computer/{assist-window.ts,recorder.ts,app-visibility.ts,prefs.ts}`,
  `src/preload/assist.ts`, `src/renderer/overlay/assist.{html,ts,css}`, `src/shared/skill-recording.ts`
  (`buildRecordedSkillPrompt`: pasos + narración + aviso de datos no confiables + propuesta con
  `question`).

### 1.3 Modo auto (C3)
- `src/main/cowork/auto-mode.ts` (clasificador PURO: solo texto, sin Electron/red/fs) y
  `auto-approver.ts` (motor: persistencia, opt-in doble, registro, HTTP contra OpenCode).
- **Solo motor de reglas, sin clasificador por modelo** (decisión del usuario). Nunca se aprueban en
  automático `external_directory`, `doom_loop`, `computer_*`, `browser_*`, `edit`, `write`, `task`,
  `webfetch`, `websearch`, nada con `DELETE_RE`, tarjetas con plan/`takeover`/nivel distinto de
  «Solo ver», ni texto que huela a inyección (`looksLikeInjection`, es/en).
- `bash`: lista cerrada de programas de solo lectura con sus opciones prohibidas (`find -delete`,
  `sort -o`, `rg --pre`…) y rutas sensibles bloqueadas (`.ssh`, `cu-helper`, `onyxcode-killswitch`…).
- MCP: solo servidores marcados «Disponible en Cowork» (nunca `computer`/`browser`), herramienta con
  prefijo de solo consulta y sin palabras de escritura.
- Acceso a apps: «Solo ver» efímero por sesión (`grantAutoView`, nunca persiste en
  `computer-grants.json`), de una lista cerrada de apps y con exclusiones fijas (gestores de
  contraseñas, Ajustes del sistema, terminales/IDE, banca…).
- `src/main/ipc/cowork-auto-handlers.ts`, `monitor.ts` (`onPermissions`), `policy.ts`
  (`disableAutoMode`).

### 1.4 Navegador propio (C4)
- `chrome-devtools-mcp@1.10.1` (dependencia exacta) detrás de una pasarela propia
  (`src/main/browser/gateway.ts`, solo builtins de Node, sin Electron): filtra `upload_file`,
  permiso previo por sitio (`navigate_page`/`new_page` y revisión de TODAS las páginas tras
  `click`/`fill`/`fill_form`/`press_key`/`evaluate_script`), fail-closed si no puede leer
  `list_pages`.
- `src/main/browser/service.ts`: perfil propio (`userData/cowork-browser/profile`, nunca el Chrome
  personal), diálogo nativo en cola (`dialog.showMessageBox`) con la URL literal y tres opciones,
  detección de Chrome/Brave y del runtime (`node ≥20.19` o el binario de OpenCode con
  `BUN_BE_BUN=1`), «Borrar datos del navegador» (rechaza si Chrome está abierto con ese perfil).
- `src/main/browser/sites.ts` (eTLD+1 heurístico, `checkUrl` solo http/https/about:blank), lanzamiento
  con el mismo envoltorio `env -u OPENCODE_SERVER_PASSWORD -u … -u ONYXCODE_PLAN_GATE_URL` que los MCP
  locales del usuario, `--no-usage-statistics` y `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`.
- `src/main/cowork/manager.ts`: `mcp.browser` inyectado solo en Control total (si está activado, sin
  política y con Chrome/runtime disponibles) + `browser_*: deny` para el agente `cowork`.
- **Solo en Control total, desactivado por defecto.** En Sandbox no aparece.

### 1.5 Interfaz, agentes y documentación (C5, este paquete)
- **Tarjeta «¿Tomar el control de la pantalla?»** (`kind === 'takeover'`) en `ComputerAccess.tsx`
  (ventana principal) y en la píldora (`overlay/pill.ts`, con `#demo-takeover`): «Seguir en segundo
  plano» → `{cancel:true}`; «Permitir» → `{approvePlan:true, decisions:[]}`. **Corrige una
  inconsistencia real**: sin este cambio, ninguna interfaz existente marcaba `approvePlan:true` para
  una tarjeta de takeover (solo lo hacía cuando había `plan`, que un takeover nunca tiene), así que
  `foregroundSessions` nunca se poblaba aunque el usuario pulsara «Permitir» — la siguiente acción de
  ratón/teclado real habría vuelto a fallar con el mensaje de modo segundo plano.
- **Ajustes → Control del Mac** (`ComputerSection.tsx`): «Cómo usa el agente las apps» (En segundo
  plano / Control de la pantalla) y «Ocultar las demás apps» / «Mostrarlas de nuevo al terminar»,
  sobre `computer:prefs:*` (los valores por defecto — `background` + ocultar — ya los fijó C2; aquí
  solo se leen y editan).
- **`AutoModeSection.tsx`** (Ajustes → Modo auto, nueva): interruptor maestro, lista explícita de lo
  que nunca aprueba, carpetas/tareas activas, editor de «Apps que puede ver sin preguntar», registro
  con «Revocar»/«Vaciar registro», banner si `policyDisabled`.
- **`AutoModeChip.tsx`** (nueva) en el compositor: visible solo si el interruptor maestro está
  activo; deja activar/desactivar el Modo auto para la carpeta o la tarea actuales sin ir a Ajustes,
  y muestra brevemente «Aprobado por el modo auto: …» cuando llega el evento.
- **Vía rápida en `store.ts`**: ante `permission.asked` con el Modo auto activo para esa
  carpeta/tarea, se llama a `cowork:auto:consider` y la tarjeta se marca `autoPending` mientras se
  decide; `PermissionPrompt.tsx` (`PermissionCard`/`ApprovalBar`) la oculta mientras tanto.
- **`BrowserSection.tsx`** (Ajustes → Navegador, nueva): activar, Chrome detectado, runtime, sitios
  «Permitir siempre» (quitar), denegados (permitir de nuevo), «Borrar datos del navegador», nota de
  que es solo en Control total con perfil propio.
- **`RecordSkill.tsx`** (nueva): «Grabar una skill» junto a «Skills disponibles» en `ProjectPanel.tsx`
  (diálogo con el interruptor del micrófono); tarjeta de revisión siempre montada (no depende de que
  el panel esté abierto) que escucha `computer:recordDone`: pasos, transcripción, «Incluir el texto
  que tecleé» (desactivado por defecto), «Enviar al agente» (`record:prepare` + `sendToTask`) y
  «Descartar».
- **`computer.md`**: modos «En segundo plano»/«Control de la pantalla», herramientas `app_*` (cuándo
  preferirlas), `request_full_control`, Teach mode (pedir solo `view`, `teach_step` paso a paso, sin
  clic), `browser_*` con permiso por sitio. **`cowork.md`**: nota de que el navegador solo existe en
  Control total.
- Documentación: este documento, filas 19/35/37/42–45 de `02-cowork.md`, «3 ter» de `SEGURIDAD.md`,
  §8 de `DISTRIBUCION.md`, §10 de `AUDIT.md`.

## 2. Las 5 decisiones del usuario (2026-09-28)

| Decisión | Valor | Dónde |
|---|---|---|
| Modo por defecto de computer use | **«En segundo plano»** (`DEFAULT_COMPUTER_PREFS.mode = 'background'`) | `ipc-cowork.ts` |
| «Ocultar las demás apps» | **Activado por defecto**, como Claude (`hideOtherApps: true`, `unhideOnFinish: true`) | `ipc-cowork.ts` |
| Navegador propio | **Desactivado por defecto y solo en Control total** (`BrowserState.enabled` arranca en `false`) | `browser/service.ts` |
| Modo auto | **Solo motor de reglas, sin clasificador por modelo** (menos riesgo de inyección y coste) | `auto-mode.ts` |
| Apps iniciales del Modo auto | Finder, Vista previa, TextEdit, Calculadora, Mapas, Tiempo, Reloj, Pages, Numbers, Keynote (editable en Ajustes) | `DEFAULT_AUTO_VIEW_APPS` |

## 3. Qué se verificó y qué NO

### Verificado (lectura de código + harnesses de cada paquete en su scratchpad, no en el repo)
- `npm run typecheck` (node + web) limpio tras todos los paquetes.
- `npx electron-vite build` verde; `out/main/browser-mcp.js`, `out/preload/assist.js` y
  `out/renderer/overlay/assist.html` presentes.
- Greps del orquestador: `git diff --stat src/preload/pill.ts` vacío; `CHANNEL_ROLES.pill` sin
  cambios; `grep -c assist src/main/ipc/schemas.ts` ≥ 2; sin «Acceso total»/«acceso completo»/
  «Carpetas autorizadas» en el renderer; `--no-usage-statistics` y `upload_file` (en `BLOCKED`) en
  `gateway.ts`; sin `chrome-devtools-mcp@latest` ni `npx` en `src/main/browser`.
- Sumas SHA-1 de `helper.swift`/`cu-helper` iguales antes y después de C2–C5 (nadie más los tocó).
- Comprobado leyendo `service.ts`: aprobar una tarjeta `takeover` con `approvePlan:true` y
  `decisions:[]` sí puebla `foregroundSessions` (el bloque no exige decisiones no vacías); antes de
  este paquete, ninguna interfaz llegaba a enviar esa combinación para un takeover.
- Reglas del clasificador de Modo auto contra la tabla de casos del plan (bash de solo lectura vs.
  peligroso, MCP de solo consulta vs. de escritura, inyección, acceso a apps).

### NO verificado en vivo (solo se puede probar dentro de la app real; ver §4)
- Permisos TCC reales: si recompilar el helper de verdad no obligó a volver a conceder Accesibilidad
  ni Grabación de pantalla (muy probable por cómo macOS atribuye el permiso, pero no comprobado con
  la app empaquetada).
- Cualquier resultado positivo de AX (`ax-tree`, `ax-press`…), captura de ventana con
  ScreenCaptureKit, y grabación con micro real: el harness de los agentes corre bajo Claude.app, así
  que solo se probaron las rutas de error y lo que no necesita TCC.
- Que `AXManualAccessibility=true` haga que una app Electron/Chromium expuesta su árbol AX.
- Que `AXPress` no active ninguna app en la práctica (documentado, no probado con apps reales).
- La transcripción en el dispositivo en español (`SFSpeechRecognizer`) con audio real.
- El flujo completo de la tarjeta de takeover en la interfaz real (¿el agente llega a ver
  `left_click` funcionando justo después de «Permitir»?).
- Que Puppeteer (dentro de `chrome-devtools-mcp`) funcione bajo el runtime `bun` del binario de
  OpenCode cuando no hay Node ≥20.19 en el PATH.
- Las opciones de CLI de `chrome-devtools-mcp` más allá de lo documentado (no se ejecutó el paquete
  real contra un `tools/list` en vivo desde este paquete C5).
- El diálogo nativo de aprobación de sitios con la ventana principal minimizada (Control total).
- `external_directory` con `<ruta>/*` y que «Siempre» sobreviva a reiniciar la carpeta (pendiente
  también del Lote B, sin reverificar en este lote).

## 4. Guía de prueba manual (`npm run dev -- --watch`, desde tu terminal habitual)

0. **Permisos tras la única recompilación de C1.** Ajustes → Control del Mac: debería seguir
   «concedido» (macOS atribuye el permiso a tu terminal, no al helper). Si falta, vuelve a
   activarlo en Ajustes del Sistema y reinicia la app. En la primera grabación con micro, macOS
   pedirá Micrófono y luego Reconocimiento de voz; si fallan desde Terminal.app (no declara su uso),
   prueba desde iTerm o VS Code.
1. **Segundo plano:** activa «En segundo plano». Pide algo sobre una app abierta sin tomar la
   pantalla: el cursor no se mueve. Pide algo que necesite el ratón/teclado real: aparece «¿Tomar el
   control de la pantalla?»; «Seguir en segundo plano» detiene esa vía, «Permitir» deja seguir con
   clic y tecleo reales.
2. **Ocultar apps:** activa el interruptor; al aprobar un plan las demás apps se ocultan y vuelven al
   terminar, al Detener, o si matas la app y la reabres.
3. **Teach:** «enséñame a…»: aparece el globo junto al elemento con «Siguiente»/«Salir de la guía»;
   el agente no hace clic.
4. **Grabar una skill:** con micro, unos pasos narrados, «Terminar»: la tarjeta de revisión muestra
   pasos y transcripción (el texto tecleado no aparece por defecto); «Enviar al agente» hace que
   proponga la skill con `question`, y solo «Guardar» escribe el `SKILL.md`. Prueba también
   «Descartar» durante la grabación.
5. **Modo auto:** actívalo en Ajustes y para la carpeta/tarea. Una herramienta MCP `*_search` se
   aprueba sola (aparece en el registro y en el chip del compositor); `*_send`/`rm`/una carpeta
   externa siguen preguntando. Pide ver Finder a mitad de tarea: «Solo ver» automático, revocable.
   Apaga el maestro: todo vuelve a preguntar.
6. **Navegador:** actívalo en Ajustes (en Control total). Al navegar aparece el diálogo nativo;
   «Permitir siempre» queda en Ajustes y se puede quitar; Denegar hace que el agente lo explique. Tu
   Chrome personal no cambia.
7. En Sandbox el navegador no aparece.
8. ⌘⇧Esc durante cualquiera de estos flujos: Teach sale, el takeover se cancela y la grabación se
   cierra.
9. Reverificar pendientes del Lote B (`external_directory` con `<ruta>/*`, «Siempre» tras reiniciar).

## 5. Aplazado y fuera de alcance

- **Helper firmado aparte**: sin certificado Developer ID disponible en esta máquina
  (`security find-identity` → 0 identidades). Queda para cuando exista (ver `DISTRIBUCION.md`).
- **Modo auto con clasificador por modelo**: descartado a propósito (riesgo de inyección y coste sin
  necesidad real: la allowlist estricta ya cubre lo útil y seguro).
- **Navegador en Sandbox**: Chrome correría fuera de Seatbelt y del proxy de egress; queda solo para
  Control total en esta versión.
- Sin abordar en este lote: panel Context, marketplace de plugins, snapshots APFS.

## 6. Riesgos y avisos

- El nombre de una herramienta MCP lo elige el autor del servidor: una `get_x` con prefijo de
  solo-consulta podría tener efectos secundarios reales; el Modo auto es opt-in, con registro y kill
  switch como mitigación, no una garantía.
- «Solo ver» automático de una app expone su contenido (en las capturas) al proveedor del modelo,
  igual que cualquier «Solo ver» concedido a mano.
- El control por sitio del navegador es sobre la navegación de primer nivel: subrecursos y JavaScript
  de un sitio permitido pueden contactar otros hosts. Chrome corre sin Seatbelt y fuera del proxy.
- Toda build empaquetada ad-hoc sigue perdiendo los permisos TCC entre sí (no cambia con este lote).
- Reverificar al subir de versión de `chrome-devtools-mcp` o de OpenCode: nombres reales de
  herramientas del navegador, formato de `list_pages`, y los canales laterales de `/tier` y
  `/control-mode`.

## 7. Archivos comprobados al escribir este documento

`resources/computer-use/helper.swift`; `src/main/computer/{service,mcp-server,overlay,assist-window,
recorder,app-visibility,prefs}.ts`; `src/main/cowork/{auto-mode,auto-approver,manager}.ts`;
`src/main/browser/{gateway,service,sites}.ts`; `src/main/ipc/{schemas,cowork-auto-handlers,
cowork-browser-handlers}.ts`; `src/shared/{ipc-cowork,cowork-glossary,skill-recording}.ts`;
`src/renderer/overlay/{pill,assist}.{ts,css,html}`; `src/renderer/src/features/cowork/impl/
{ComputerAccess,PermissionPrompt,store,actions,CoworkComposer,ProjectPanel,AutoModeChip,
RecordSkill}.tsx`; `src/renderer/src/features/settings/impl/{ComputerSection,AutoModeSection,
BrowserSection,SettingsView}.tsx`; `resources/opencode/agents/{computer.md,cowork.md}`.
