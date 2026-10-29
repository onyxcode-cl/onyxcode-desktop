# Estudio: trycua/cua (cua-driver) y Hermes Agent frente a nuestro control de apps

Solo lectura. Clones superficiales en `scratchpad/estudio/{cua,hermes}` (no se ejecutó nada). Rutas de cua bajo `libs/cua-driver/`. Ambos MIT; no se copia código, solo ideas. Se evitó la extensión OmniParser/perception.
Dato clave: **Hermes no implementa el control; envuelve cua-driver** (`tools/computer_use/cua_backend*.py`, `tool.py`). Lo propio de Hermes es la capa de agente (veredicto, dedup, bloqueos). Lo de bajo nivel es todo de cua.

## Qué hacen mejor que nosotros

1. **Entrega por proceso/ventana, sin tocar ratón ni foco real.** cua: `rust/crates/platform-macos/src/input/mouse.rs` (clic con coordenada local + CGWindowID, `SLEventPostToPid`) y `input/keyboard.rs` (`post_to_pid`). Nosotros: `resources/computer-use/helper.swift` publica en `.cghidEventTap` (l.107) y `keys.swift:34`; el ratón/teclado real solo con «Control total», en primer plano. Es la mayor diferencia, y también la de más riesgo (SPI privada de SkyLight).
2. **Ruta única decidida por una función pura, con rechazo estructurado.** cua: `cua-driver-core/src/background_input.rs` + plan `docs/macos-background-input-v1-plan.md`: el objetivo es siempre (pid, windowId) desde la resolución hasta la verificación; si no hay ruta segura, rechaza ANTES de enviar. Nosotros: `requireTier`/`recheckFront`/`recheckWindow` (mcp-server.ts 398, 1094, 1563) comprueban «¿misma app al frente?» pero no un id de ventana exacto.
3. **Ancestría del elemento hasta la ventana pedida** (`ax/window_scope.rs`, `_AXUIElementGetWindow`): un token de elemento solo vale si sube a esa ventana. Nosotros: `axPress(bundleId, ref…)` (mcp-server.ts 1772) valida por app + rol/título esperados, no por ventana.
4. **Verificación con evidencia ligada al objetivo.** cua `type_text.rs`: `typed_progress`/`await_typed_delivery` (sondeo acotado hasta que el texto completo aparece; `Complete/Partial(n)/Unchanged/Unverifiable`; Return/Tab nunca cuentan como parcial). `AXValue` bajo `AXWebArea` se declara NO fiable (puede devolver eco). Nosotros: `finishVerdictInner` (mcp-server.ts 2739) lee de vuelta solo en `app_set_value`/`app_insert_text`; `type_text` físico no tiene lectura de vuelta, solo `focus-stolen` por trozos.
5. **Escalera de clic con lectura de vuelta** (`click.rs` `perform_ax_click` 1567): comprueba que la acción esté habilitada ANTES (`ensure_ax_action_enabled`), detecta pulsaciones huecas (acción no anunciada) y prefiere `AXSelected` verificado en filas/colecciones; y si la lectura no cambia, informa. Nosotros: `app_press` verifica cambio de elemento/ventana, pero no distingue «acción no anunciada» de antemano.
6. **Pistas de recuperación accionables** (`cua-driver-core/src/recovery_hint.rs`, tabla `RULES`): `hint` ≤240 car. + `next_call` ejecutable y siempre inocuo (nunca un paso que pida consentimiento). Nosotros tenemos `siguiente:` y códigos `[rechazo: …]`, pero el texto sale de lugares sueltos del servidor, no de una tabla única probada.
7. **Guardia de foco reactiva y de «robo de tecla de ventana»** (`focus_guard.rs`, `key_focus_guard.rs`, `window_change_detector.rs`): al operar una app de fondo restaura el foco que ella misma se roba (menús, popups) y reporta ventanas nuevas (menú/diálogo) creadas por la acción. Nosotros solo detectamos y avisamos (`frontChangedTo`, `focus-stolen`) tras el hecho.
8. **Presupuestos y árboles parciales** (`walk_budget.rs`: tope de tiempo y de nodos, devuelve árbol parcial y lo dice). Nosotros: `withAxTimeout` + `maxNodes` en `axTree`; falta decir explícitamente «árbol parcial».
9. **Enablement de accesibilidad web/Electron** con ciclo de vida por proceso (`AXManualAccessibility`, espera acotada, cache por huella de proceso, no por PID). Nosotros lo escribimos en cada nodo visitado (helper.swift 578/602/809), sin cache ni espera.
10. **Hermes: dedup de capturas idénticas** (`tool.py` `_screenshot_dedup_check`: hash de la imagen; si es idéntica y del mismo objetivo se omite la imagen con nota «pantalla sin cambios», tope de 2 seguidas). Ahorra tokens y bucles. Nosotros reenviamos siempre.
11. **Hermes: `input_target_mismatch`** (`_input_target_mismatch`): rechaza escribir si la app pedida no es el objetivo fijado por la última captura. Equivale a nuestro `expect_app`, pero ellos lo imponen sin que el modelo lo pida.
12. **cua: saneado de `type_text`** (`text_sanitize.rs`): quita etiquetas de protocolo de herramienta que el modelo deja colarse al final del texto. Barato y general.
13. **cua: lote que sugiere agrupar** (`batch_nudge.rs`) y espera posterior opcional (`post_action_wait.rs`, `none`/`default`).

## Qué ya tenemos igual o mejor

- Veredicto `efecto: confirmed/unverifiable/suspected_noop` con historial anti-repetición (`actionLogFor`, `computeVerdict` en window-probe.ts): cua lo devuelve, pero la política de «no repetir» la deja al agente; la nuestra la aplica.
- Detección de ventana TAPADA por geometría y por monitores (`computeCoverage`, `checkWindowPoint`) y rechazos estables (`covered`, `stale`, `window-moved`, `capture-expired`): cua no tiene equivalente de «otra ventana tapa el punto» fuera de sus reglas de ventana exacta.
- Elementos numerados ligados a una captura con caducidad (`capture: N`, `element: N`) con `[rechazo: stale]`; el `capture_registry.rs` de cua está declarado «no cableado» a las acciones todavía.
- Consentimiento por app y nivel con tarjeta, bloqueos duros de teclas y escritura en origen aislado (`checkIsolatedKeys`); la lista de Hermes (`_BLOCKED_KEY_COMBOS`) es más corta y por patrón de shell.
- Espera por condición (`computer_wait until_text/until_change`): cua usa `verify_state` (más general, ver mejora 6) pero no tiene un `wait` equivalente en el modelo de Hermes.
- Multimonitor: `screenOfApp`/`screenForCapture` por superficie cubierta (F8-B150/B155).

## Qué NO pude verificar

- No ejecuté nada: no sé si la entrega por PID funciona en nuestro macOS (Darwin 27) ni con Electron real; las SPI de SkyLight cambian entre versiones y cua lo gestiona deshabilitando la ruta tras un fallo.
- Los detalles de Spaces: el propio plan de cua admite que `on_current_space` no se rellena de forma fiable; su política es «solo observar y rechazar», igual que la nuestra con `covered`.
- No leí el backend de Windows/Linux de cua con detalle (10 k y 15 k líneas); nuestra comparación es solo con macOS.
- Hermes aporta poco de bajo nivel: no verifiqué su manejo de errores del daemon (`cua_backend_daemon.py`) más allá de lo citado.

## Mejoras generales adaptables (por prioridad)

| # | Mejora | Esfuerzo | Riesgo |
|---|--------|----------|--------|
| 1 | **Lectura de vuelta en `type_text` físico y `key` con campo enfocado**: sondeo acotado del AXValue del elemento enfocado y su ventana (no AX global de la app), clasificar Completo/Parcial/Sin cambio/No verificable como `typed_progress`; desconfiar del eco bajo `AXWebArea`. Entra en `finishVerdictInner`. | M (1–2 d) | Bajo |
| 2 | **Pre-chequeo de acción habilitada y «pulsación hueca»** en `app_press`: leer `AXEnabled`/acciones anunciadas antes de actuar; si la acción no se anuncia, intentar `AXSelected` verificado o devolver `unverifiable` con `siguiente:` claro. | M | Bajo |
| 3 | **Tabla única de pistas de recuperación** (código de rechazo -> frase corta + siguiente llamada segura) con pruebas por código, usada por todas las herramientas. | S–M | Bajo |
| 4 | **Dedup de capturas idénticas** por hash por (sesión, app, ventana), con tope de omisiones y reinicio al compactar contexto. | S | Bajo |
| 5 | **Saneado del final de `type_text`** (etiquetas de protocolo sueltas) y rechazo de texto con restos evidentes. | S | Bajo |
| 6 | **Árbol parcial explícito** (tiempo/nodos agotados -> decirlo y sugerir `app_find` más acotado). | S | Bajo |
| 7 | **Enablement de accesibilidad Electron/web con cache por proceso y espera acotada**, en vez de reescribir en cada nodo; volver a leer el árbol tras activarlo. | M | Medio (apps lentas) |
| 8 | **Identidad de ventana exacta (windowId) de extremo a extremo**: token de elemento ligado a su ventana, y comprobar propiedad de ventana justo antes de actuar (hoy solo app al frente). Cierra el caso de dos ventanas de la misma app. | M–L | Medio |
| 9 | **Guardia reactiva de foco** mientras se opera una app de fondo (restaurar la app del usuario si la acción la roba), complementando el `focus-stolen` actual. | L | Alto (SPI privada, depende de la versión de macOS) |
| 10 | **Entrega de clic/tecla por PID sin mover el ratón real** para «segundo plano de verdad» (fuera de accesibilidad). | L (semanas) | Alto: SPI privada, permisos TCC, difícil de probar en frío; hacerlo solo como ruta opcional apagada por defecto, con el rechazo estructurado de la mejora 8 y verificación obligatoria. |

Orden recomendado: 1, 2, 3, 4, 5, 6 (baratas y seguras), luego 7 y 8; 9 y 10 solo con plan aparte y prueba por CDP en Mac y Windows real. Todas son por señal observada (rechazo, lectura de vuelta), nunca por tipo de app o proceso.
