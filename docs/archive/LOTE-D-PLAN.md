> Archivado: documento histórico; ver README.md y docs/FASE6-PLAN.md.

# Lote D: navegador integrado en la ventana de la app (Code + Cowork). Plan de arquitectura

Leí todo lo obligatorio: los dos documentos del Lote C, gateway/service/sites, cowork-browser-handlers, SEGURIDAD, AUDIT, Lotes A y B y DESIGN. También CodeWorkspace, ProgressPanel, CoworkWorkspace, app-protocol, web-security, manager y los agentes. Además revisé la config del sidecar de Code (`opencode/config.ts` y `server.ts`), el plugin plan-gate (`opencode-config.ts`), el perfil Seatbelt, el guard y los schemas del IPC, los preloads, `artifact-window.ts`, `electron.d.ts` de Electron 44.4.5 y los internos de `chrome-devtools-mcp` 1.10.1 junto con su puppeteer empaquetado.

No escribí nada en disco. He incorporado el addendum (referencia visual tipo Cursor): pestaña en el mismo `RightPanel`, barra completa, «Añadir al chat», «Seleccionar elemento» y detección del dev server.

---

## A. Hallazgos verificados y correcciones al encargo

**Límite honesto de esta fase.** Por ser una tarea de solo lectura no pude ejecutar Electron: su CLI necesita un script y no podía crear ninguno. Todo lo de abajo sale del código fuente y de `electron.d.ts`. Las comprobaciones en vivo son el paquete **D0**, que va primero y decide los fallbacks (puertas G1–G9).

**A.1 Versión de Electron y API.**
- Electron es `44.4.5` (`package.json:38`, `node_modules/electron/package.json`).
- `BrowserView` está obsoleto: todos sus métodos llevan `@deprecated` (`electron.d.ts:4134-4197`).
- Hay que usar **`WebContentsView`** (`electron.d.ts:18963`) y `View.addChildView` (`:16066`); existen `setVisible`, `setBorderRadius` y `setBackgroundColor`.
- `webContents.debugger` ofrece `attach`, `detach`, `isAttached`, `sendCommand(method, params, sessionId)` y los eventos `message`/`detach` (`electron.d.ts:~7538-7660`).
  - Es una sesión CDP **a nivel de página**, no de navegador.
  - Se desengancha si se abren las DevTools de ese webContents (texto del evento `detach`, `:7538`). Por eso hace falta `devTools:false` en la vista.
- Otras piezas que existen y el diseño usa:
  - `capturePage(rect, {stayHidden})` (`:5487-5492`, `:23308`): capturar sin mostrar.
  - Evento `input-event` (`:17300`): detectar entrada humana.
  - `before-input-event`, `will-frame-navigate`, `setBackgroundThrottling`, `setWebRTCIPHandlingPolicy` y `focusOnNavigation` (`:19520`).
- Permisos que se pueden denegar (`:13500`): `local-network-access`, `loopback-network`, `openExternal`, `display-capture`, `clipboard-read`, `fileSystem`, `window-management`…
- **Trampa encontrada:** `select-client-certificate` usa por defecto el PRIMER certificado del usuario salvo `preventDefault` (`:807`). Hay que interceptarlo.

**A.2 (a) ¿`chrome-devtools-mcp`/puppeteer puede conectarse a un webContents embebido? No de forma limpia.**
- `chrome-devtools-mcp` solo conecta por `wsEndpoint`, `browserUrl`, `DevToolsActivePort` o `channel` (`build/src/BrowserManager.js:268-330`). No existe una opción de transporte propio desde la CLI.
- Trae puppeteer-core 25.11.0 empaquetado (`third_party/bundled-packages.json`). `connect({transport})` sí existe programáticamente (`third_party/index.js:86181-86200`), pero `_connectToCdpBrowser` envía enseguida métodos **de navegador**:
  - `Target.getBrowserContexts` (`:84148`);
  - `Target.setDiscoverTargets`/`Target.setAutoAttach` (`:83384-83396`);
  - `Browser.getVersion` (`:84102`).
- Ninguno existe en una sesión de página de `webContents.debugger`. La única vía sería escribir en main un **falso endpoint de navegador**: un servidor WebSocket que emule los dominios Target y Browser y multiplexe sesiones.
- Eso resulta frágil entre versiones de puppeteer y rompería `new_page` (Target.createTarget), las trazas (Tracing es de navegador), `emulate` y las extensiones. Además seguiría dependiendo de un runtime externo (Node ≥20.19 o Bun, **no verificado** en el Lote C) y abriría un puerto CDP en localhost. **Descartado.**
- Tampoco sirve `--remote-debugging-port` de Electron: expondría TODOS los webContents, incluida la ventana principal con `window.api` (`pty:create`, `mcp:save`), a cualquier proceso local. **Descartado de forma categórica**; se añade un grep de aceptación.

**A.3 (b) Se elige `webContents.debugger` + CDP propio.**
- Métodos de página suficientes: `Accessibility.getFullAXTree` (snapshot con uids), `DOM.getContentQuads`/`scrollIntoViewIfNeeded`/`getNodeForLocation`/`resolveNode`, `Input.dispatchMouseEvent`/`dispatchKeyEvent`/`insertText`, `Page.captureScreenshot`/`handleJavaScriptDialog`/`createIsolatedWorld`, `Runtime.callFunctionOn`, `Overlay.setInspectMode`/`highlightNode`, y `Log`/`Network` para Code.
- Es **más honesto**: unas 17–21 herramientas en vez de 23, sin runtime externo, sin puerto CDP y en el mismo proceso que controla los píxeles.
- Los nombres y esquemas son **compatibles con el subconjunto de `chrome-devtools-mcp`** (`navigate_page`, `take_snapshot`, `click{uid}`, `fill`…, ver `build/src/tools/{input,pages,snapshot}.js`). Así los prompts sirven para los dos motores.

**A.4 (d) `<webview>`.**
- Está bloqueado dos veces: `webviewTag:false` en todas las ventanas (`index.ts:68`, `artifact-window.ts:112`, `quick-entry.ts:42`, `overlay.ts:406`, `assist-window.ts:143`) y `will-attach-webview` → `preventDefault` (`web-security.ts:54-57`).
- Reactivarlo exigiría `webviewTag:true` en la ventana **privilegiada**: su renderer podría crear invitados con atributos, y la propia Electron lo desaconseja.
- `WebContentsView` logra lo mismo en línea con el invitado creado **solo por main**. **`webviewTag:false` no se toca en ningún sitio.**

**A.5 Corrección al encargo: «dentro de la ventana» sí es literalmente posible.**
- Un `WebContentsView` es una vista nativa hija de la ventana principal, colocada por `setBounds` sobre un hueco del layout de React.
- Restricciones reales:
  1. Siempre se pinta **encima** del DOM: un menú, popover o diálogo de React que la solape queda tapado. Hay que ocultar la vista y mostrar una captura congelada mientras exista un overlay.
  2. Los bounds se sincronizan desde el renderer (ResizeObserver) y main los escala por `getZoomFactor()`.
  3. Si la ventana está minimizada, que es justo lo que hace Control total (`cowork-handlers.ts:154-169`), no se ve. Para ese caso existe una **ventana «Navegador» propia de la app** (la misma vista movida a otra ventana; lo verifica G8).
- La pregunta 1 de §E lo confirma con el usuario.

**A.6 Otros hallazgos que condicionan el diseño.**
- **Choque con el endurecimiento global:** `harden()` se aplica a TODO webContents (`web-security.ts:109`). Bloquearía la navegación de la vista y abriría cada URL en el navegador del sistema (`:42-53`). Hace falta una exención explícita **por identidad de sesión** (B.3).
- `will-navigate` no se dispara con `loadURL` programático. El agente navegará con `loadURL` precedido de la puerta propia; los clics en enlaces se cubren con `will-frame-navigate`/`will-redirect`, y `did-start-navigation` actúa de respaldo.
- **Sandbox:** Seatbelt solo deja conectar a puertos localhost listados (`sandbox-profile.ts:281-297`; `sandbox.ts:97-99`), así que el puerto del MCP debe añadirse al lanzar. Debe ser **fijo durante toda la vida de la app**.
- Todos los `opencode serve` cargan plugins de `userData/opencode-config` (`opencode-config.ts:271-277`). Un plugin nuevo que inyecte `onyxcode_session` en `browser_*` llega también al sidecar de Code. Hoy la inyección solo existe en plan-gate y solo con `ONYXCODE_PLAN_GATE_URL` (`:142-148`).
- **Code** es un sidecar compartido con Chat. La config inline es `buildInlineConfig()` al arrancar (`server.ts:143`); `chat` ya tiene `'*': deny` (`config.ts:22-26`). `build`/`plan` son agentes internos de OpenCode sin `.md` propio en `resources`.
- **Colisión de nombres:** el Lote C inyecta `mcp.browser` (`manager.ts:631-645`). Se resuelve en B.11: un solo `mcp.browser` por servidor, el motor que toque.

---

## B. Decisiones de diseño y contratos

### B.1 Arquitectura
```
Renderer (onyxcode://app, rol main)                     Main (privilegiado)
 BrowserPanel (barra, pestañas, tarjetas) ──IPC browser:*──► embedded-browser/service
   └─ <div> hueco medido (ResizeObserver) ──browser:attach──► WebContentsView por pestaña
                                                              · sesión persist:onyxcode-web-{code|cowork}
                                                              · sin preload, sandbox, contextIsolation
                                                              · cdp.ts = webContents.debugger (lista blanca)
 OpenCode (sidecar Code / servidores Cowork) ──MCP remote HTTP 127.0.0.1 + Bearer por servidor──► embedded-browser/mcp-server
   plugin onyxcode-session.js inyecta onyxcode_session en browser_*       └─ tools.ts → service (puertas, aprobaciones)
```
- El MCP corre **en el proceso principal**, porque `webContents.debugger` solo existe allí. No hay utilityProcess ni dependencias npm nuevas (ni `package.json` ni `electron-builder.js` cambian).
- Transporte y esqueleto JSON-RPC copiados de `computer/mcp-server.ts:1600-1779`: Bearer con `timingSafeEqual` y rechazo de cualquier cabecera `Origin`.

### B.2 Frontera de aislamiento (primer contenido web arbitrario de la app)

| Capa | Decisión |
|---|---|
| Proceso | Cada pestaña es un `WebContentsView` con `sandbox:true, contextIsolation:true, nodeIntegration:false, nodeIntegrationInSubFrames:false, webviewTag:false, devTools:false, spellcheck:false, safeDialogs:true, navigateOnDragDrop:false, backgroundThrottling:false, focusOnNavigation:false, autoplayPolicy:'document-user-activation-required'`. Renderer propio, aislado del de la app (otra partición, otro origen). |
| Preload | **Ninguno.** Todo control viene de main (API de webContents, sesión, debugger). Un preload correría dentro del proceso de la página y solo añadiría superficie; además `guardInvoke` rechaza cualquier IPC de un emisor sin rol ni origen propio (`guard.ts:49-54`). |
| Sesión | `session.fromPartition('persist:onyxcode-web-code')` y `'persist:onyxcode-web-cowork'`: perfiles separados entre sí y NUNCA la `defaultSession` de `onyxcode://app`. Cookies cifradas (fuse `EnableCookieEncryption`). El esquema `onyxcode:` y `*-artifact:` no existen en esa sesión (`protocol.handle` es de la sesión por defecto y de la del artifact). |
| Identidad | `setUserAgent` sin `Electron/…` ni `${APP_NAME}/…`; `wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`. |
| Permisos | Request/check handlers: **todo denegado** salvo `clipboard-sanitized-write` y solo en el frame principal. Denegados de forma explícita: `openExternal` (mailto:, zoommtg:… escaparían al SO), `display-capture` (y `setDisplayMediaRequestHandler → callback({})`), `media`, `geolocation`, `notifications`, `fullscreen`, `pointerLock`, `keyboardLock`, `local-network-access`, `loopback-network`, `fileSystem`, `window-management`, `payment-handler`, `storage-access`. `setDevicePermissionHandler→false`; `select-{hid,serial,usb,bluetooth}-*` cancelados; `select-client-certificate` → `preventDefault` + `callback()` sin certificado; `login` (auth HTTP) cancelado en v1; `certificate-error` sin handler que conceda. |
| Red | `webRequest.onBeforeRequest`: solo `http(s):`, `ws(s):`, `data:`, `blob:`, `about:`. Cancela `file:`, `chrome:`, `devtools:`, `onyxcode:`, `*-artifact:` y el resto. Destino loopback o privado (127/8, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, `.local`) cancelado salvo que la página de primer nivel sea un origen local **aprobado por el usuario** (`localhost:PUERTO`). La CSP es la del sitio: la app no puede imponer una sin romperlos; lo «estricto» se garantiza por proceso, partición, permisos y red. |
| Navegación | `setWindowOpenHandler → deny` (el enlace se abre en una pestaña nueva de la misma superficie si hubo gesto del usuario). Puerta por sitio para lo atribuido al agente (B.8). `will-prevent-unload → preventDefault`. |
| Descargas | `will-download` en la partición (B.9). |
| Crash | `render-process-gone` → estado `crashed` y «Recargar». |
| CDP | `cdp.ts` solo envía métodos de `ALLOWED_CDP` (B.6). Nunca `Network.getCookies/getAllCookies/setCookie`, `Storage.*`, `Target.*`, `Browser.*`, `Fetch.*`, `DOM.setFileInputFiles`, `Page.addScriptToEvaluateOnNewDocument`, `Emulation.*`, `Security.*` ni `Page.setDownloadBehavior`. |

### B.3 Cambio exacto en `web-security.ts` (el único que toca la seguridad de las ventanas de la app)
```ts
import { isEmbeddedBrowserSession } from '../embedded-browser/session'
function harden(wc: WebContents): void {
  // Superficie de navegación (Lote D): sus reglas viven en embedded-browser/surface.ts.
  if (isEmbeddedBrowserSession(wc.session)) return
  …resto sin cambios…
}
```
- `isEmbeddedBrowserSession(s)` = pertenencia a un `Set<Session>` que llena **solo** `session.ts` al crear las dos particiones. Compara la identidad del objeto, nunca cadenas.
- Surface instala sus guardas justo después de `new WebContentsView()`, antes de cualquier `loadURL`, así que no queda ventana sin protección.
- `installPermissionHandlers()` sigue actuando solo sobre `defaultSession`; las ventanas de la app no pierden nada. Lo verifica D1 (harness).

### B.4 Contrato IPC: nuevo `src/shared/ipc-browser.ts` (familia propia, como `ipc-extras`) → `window.api.browser`
```ts
import type { BrowserSite } from './ipc-cowork'
export type BrowserProduct = 'code' | 'cowork'
export type BrowserOwner = { kind: 'code'; directory: string } | { kind: 'cowork'; folder: string }
export interface BrowserRect { x: number; y: number; width: number; height: number }
export interface BrowserTab { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean;
  secure: boolean | null; openedBy: 'user' | 'agent'; agentSelected: boolean; crashed?: boolean }
export interface BrowserOwnerState { owner: BrowserOwner; tabs: BrowserTab[]; activeTabId: string | null;
  control: 'idle' | 'agent' | 'paused'; agentSessionId: string | null; agentLabel: string | null;
  userActive: boolean; picking: boolean; hostedIn: 'panel' | 'popout' | 'none'; disabledReason?: string }
export interface BrowserApprovalRequest { id: string; owner: BrowserOwner; sessionId: string;
  kind: 'site' | 'local-origin' | 'sensitive' | 'download'; url: string; host: string; site: string;
  summary?: string; fileName?: string; savePath?: string; createdAt: number }
export type BrowserDecision = 'task' | 'always' | 'deny' | 'allow'
export interface PickedElement { tag: string; role?: string; name?: string; text?: string; selector: string; html: string; rect: BrowserRect; url: string }
export interface DevServerCandidate { url: string; label: string; source: 'port' | 'script'; running: boolean; script?: string }
export interface BrowserPrefs { agentEnabled: { code: boolean; cowork: boolean } }
export interface BrowserSitesState { prefs: BrowserPrefs; sites: Record<BrowserProduct, BrowserSite[]>;
  denied: Record<BrowserProduct, string[]>; localOrigins: string[]; policyDisabled: boolean }
export interface BrowserCapture { url: string; title: string; dataUrl: string /* image/jpeg */; width: number; height: number }
export interface BrowserToChat { owner: BrowserOwner; text: string; image?: { name: string; mime: 'image/jpeg'; dataUrl: string } }
```

**Canales invoke** (`BROWSER_INVOKE_CHANNELS`):

| Canal | req → res |
|---|---|
| `browser:state` | `{owner}` → `BrowserOwnerState` |
| `browser:attach` | `{owner, rect, visible}` → `void` |
| `browser:detach` | `{owner}` → `void` |
| `browser:newTab` | `{owner, input?}` → `BrowserOwnerState` |
| `browser:closeTab` | `{owner, tabId}` → `BrowserOwnerState` |
| `browser:selectTab` | `{owner, tabId}` → `BrowserOwnerState` |
| `browser:navigate` | `{owner, tabId, input}` → `BrowserOwnerState` |
| `browser:history` | `{owner, tabId, action:'back'\|'forward'\|'reload'\|'stop'}` → `void` |
| `browser:agent` | `{owner, action:'pause'\|'resume'\|'stop'}` → `BrowserOwnerState` |
| `browser:pick` | `{owner, tabId, on}` → `void` |
| `browser:capture` | `{owner, tabId}` → `BrowserCapture` |
| `browser:toChat` | `BrowserToChat` → `void` |
| `browser:respond` | `{id, decision}` → `void` |
| `browser:popOut` | `{owner, on}` → `BrowserOwnerState` |
| `browser:openExternal` | `{owner, tabId}` → `void` |
| `browser:devServers` | `{directory}` → `DevServerCandidate[]` |
| `browser:sites:get` | `void` → `BrowserSitesState` |
| `browser:sites:setPrefs` | `{agentEnabled?:{code?, cowork?}}` → `BrowserSitesState` |
| `browser:sites:remove` | `{product, site}` → `BrowserSitesState` |
| `browser:sites:undeny` | `{product, site}` → `BrowserSitesState` |
| `browser:sites:removeLocal` | `{origin}` → `BrowserSitesState` |
| `browser:clearData` | `{product}` → `BrowserSitesState` |

**Eventos** (`BROWSER_EVENT_CHANNELS`): `browser:state` (`BrowserOwnerState`), `browser:approval` (`BrowserApprovalRequest`), `browser:approvalDone` (`{id}`), `browser:picked` (`{owner, tabId, element}`), `browser:reveal` (`{owner, tabId, reason:'agent'|'approval'}`), `browser:shortcut` (`{owner, key:'focusUrl'|'newTab'|'closeTab'|'reload'|'back'|'forward'|'panel1'|'panel2'|'panel3'|'panel4'}`), `browser:toChat` (`BrowserToChat`), `browser:sites` (`BrowserSitesState`).

**Esquemas en `schemas.ts`:**
- `owner = tagged('kind', {code: obj({kind: literal('code'), directory: absPath}), cowork: obj({kind: literal('cowork'), folder: absPath})})`.
- `rect`: cuatro `num({min:-20000, max:20000})`.
- `tabId = str({pattern:/^t[a-f0-9]{8,32}$/})`; `input = str({max:2048})`; `id = hexId`; `decision = literal('task','always','deny','allow')`; `product = literal('code','cowork')`; `site` (el existente).
- `origin = str({pattern:/^(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/})`.
- `toChat.text` ≤ 20 000; `image.dataUrl` ≤ 8 MB con `pattern:/^data:image\/jpeg;base64,/`.

**Roles:**
- `WindowRole` añade `'browserHost'` (ventana «Navegador» aparte).
- `CHANNEL_ROLES.browserHost` = todos los `browser:*` **salvo** `browser:sites:*`, `browser:clearData` y `browser:devServers`.
- **`pill` y `assist` no se tocan.**

### B.5 API interna de main: `src/main/embedded-browser/api.ts` (D1 la publica primero y D2 programa contra ella)
```ts
export interface AgentActor { sessionId: string; product: BrowserProduct; owner: BrowserOwner; sandboxed: boolean; label?: string }
export interface AgentLease { tabId: string; release(): void }
export class BrowserBusyError extends Error { reason: 'paused' | 'userActive' | 'otherTask' | 'disabled' | 'stopped' }
export interface CdpSession { send<T = unknown>(method: AllowedCdpMethod, params?: object, timeoutMs?: number): Promise<T>;
  on(event: string, fn: (params: any) => void): () => void; isolatedContext(): Promise<number> }
export interface EmbeddedBrowserApi {
  init(deps: { getMainWindow(): BrowserWindow | null; getMainConnection(): Promise<OpencodeConnection> }): void
  mainConnection(): Promise<OpencodeConnection>
  listTabs(owner: BrowserOwner): BrowserTab[]
  agentTabId(owner: BrowserOwner): string | null
  selectAgentTab(actor: AgentActor, tabId: string): void
  closeTabAsAgent(actor: AgentActor, tabId: string): void              // solo pestañas openedBy:'agent'
  openTabAsAgent(actor: AgentActor, url: string, timeoutMs: number): Promise<string /* tabId */>
  navigateAsAgent(actor: AgentActor, tabId: string, url: string, timeoutMs: number): Promise<{ url: string; title: string }>
  historyAsAgent(actor: AgentActor, tabId: string, a: 'back' | 'forward' | 'reload', timeoutMs: number): Promise<{ url: string; title: string }>
  beginAgentAction(actor: AgentActor, tabId: string, kind: 'read' | 'input'): AgentLease   // lanza BrowserBusyError
  verifyAfterAction(actor: AgentActor, tabId: string): Promise<string | null>                 // respaldo: host no permitido → about:blank/atrás + texto de error
  confirmSensitive(actor: AgentActor, tabId: string, summary: string): Promise<boolean>
  cdp(tabId: string): Promise<CdpSession>
  webContentsOf(tabId: string): WebContents | null
  capture(tabId: string, maxLongSide: number): Promise<{ jpeg: Buffer; width: number; height: number }>
  agentEnabled(product: BrowserProduct): boolean                                              // prefs && !policy.disableBrowser
}
export declare const embeddedBrowser: EmbeddedBrowserApi   // implementado en service.ts
export const ALLOWED_CDP: readonly string[]                 // ver B.6
```

### B.6 El agente: MCP `browser` (herramientas `browser_*`)

**Comunes a Code y Cowork (17):**

| Herramienta | Argumentos | Notas |
|---|---|---|
| `list_pages` | `{}` | Lista `pageId: título (url)` y marca la seleccionada |
| `select_page` | `{pageId:int}` | |
| `new_page` | `{url ≤2048}` | Pasa por la puerta de sitio |
| `close_page` | `{pageId}` | Solo pestañas que abrió el agente |
| `navigate_page` | `{type?:'url'\|'back'\|'forward'\|'reload', url?, timeout? ≤30000}` | Sin `initScript` |
| `take_snapshot` | `{verbose?:bool}` | Sin `filePath`; `AXTree` con uids `s<seq>_<n>` y tope de 1500 nodos/60 KB |
| `take_screenshot` | `{fullPage?:bool, uid?}` | JPEG, lado largo ≤1366 y alto ≤4000 |
| `click` | `{uid, dblClick?}` | |
| `hover` | `{uid}` | |
| `fill` | `{uid, value ≤5000}` | |
| `fill_form` | `{elements:[{uid,value}] ≤20}` | |
| `type_text` | `{text ≤5000, submitKey?}` | |
| `press_key` | `{key ≤60}` | |
| `scroll` | `{direction:'up'\|'down'\|'left'\|'right', amount? ≤5000, uid?}` | |
| `wait_for` | `{text:string[1..10], timeout? ≤30000}` | |
| `handle_dialog` | `{action:'accept'\|'dismiss', promptText?}` | |
| `get_page_text` | `{maxChars? ≤50000}` | `innerText` en un mundo aislado |

**Solo Code (+4):**
- `list_console_messages {types?, pageSize?, pageIdx?}`.
- `list_network_requests {resourceTypes?, pageSize?, pageIdx?}`.
- `get_network_request {reqid:int}`: cabeceras y cuerpo de texto ≤100 KB.
- `evaluate_script {function ≤10000, args?:[{uid}]}`: **solo si la pestaña está en un origen loopback** (depurar tu app en desarrollo). En cualquier otro sitio da error.

**Nunca:** subir archivos, emular, performance/lighthouse, extensiones, `filePath`, `initScript` ni scripts en Cowork.

**Guardas del servidor, en este orden:**
1. **Actor.** `onyxcode_session` es obligatorio: sin él, fallo cerrado («No se pudo identificar la tarea»).
   - El token del cliente determina producto, carpeta y sandbox.
   - En Code, la carpeta se obtiene con `GET /session/:id` al sidecar vía `mainConnection()`, con caché.
2. **Activación.** `agentEnabled(product)` y política `disableBrowser`. El error explica que se activa en Ajustes; la lista de herramientas no cambia, así que activar o desactivar no exige reiniciar servidores.
3. **Control.** `beginAgentAction` lanza `BrowserBusyError` en estos casos:
   - `paused`: «El usuario pausó el navegador»;
   - `userActive` (entrada humana en los últimos 3 s; solo afecta a las herramientas `input`): «El usuario está usando el navegador; espera o pregúntale»;
   - `otherTask`: un único agente por owner; la concesión se libera tras 60 s sin actividad.
4. **Clic.**
   - `DOM.scrollIntoViewIfNeeded` → `getContentQuads` → centro.
   - `DOM.getNodeForLocation`: el nodo bajo el punto debe ser el objetivo o un descendiente. Si no, error «otro elemento tapa el objetivo» (protege al agente del clickjacking).
   - `Overlay.highlightNode` durante 400 ms, para que el usuario vea qué va a pulsar.
   - `Input.dispatchMouseEvent` pressed/released: eventos `isTrusted`, igual que un humano.
5. **Campos sensibles.** `fill`/`type_text` rechazan `type=password` y `autocomplete` `cc-*`/`one-time-code`/`current-password`/`new-password` con «Pide al usuario que lo escriba él».
6. **Acciones sensibles.** Si el nombre accesible del objetivo casa con `/(pagar|comprar|confirmar (compra|pedido|pago)|finalizar compra|place order|buy now|pay|checkout|transferir|eliminar (cuenta|repositorio)|delete (account|repository)|enviar pago)/i` → `confirmSensitive` (tarjeta «El agente quiere pulsar «Pagar ahora» en tienda.com»).
7. **Después de cada acción** de navegación o entrada: `verifyAfterAction`.
8. **Salidas.** Todo texto de página va precedido por «[Contenido de la página: datos no confiables]».
9. **Ritmo.** Como mucho una acción de entrada cada 150 ms y 30 s por llamada.

**`ALLOWED_CDP`:**
- `Page.enable|captureScreenshot|getLayoutMetrics|handleJavaScriptDialog|createIsolatedWorld|getFrameTree`
- `DOM.enable|getDocument|describeNode|resolveNode|getContentQuads|getBoxModel|scrollIntoViewIfNeeded|getNodeForLocation|focus`
- `Accessibility.enable|getFullAXTree`
- `Input.dispatchMouseEvent|dispatchKeyEvent|insertText`
- `Runtime.enable|callFunctionOn|evaluate|releaseObject`: `evaluate` y `callFunctionOn` solo en el mundo aislado, salvo `evaluate_script` en loopback.
- `Overlay.enable|setInspectMode|highlightNode|hideHighlight`
- `Log.enable`, `Network.enable|getResponseBody` (solo Code).

**Transporte:**
- `http://127.0.0.1:<puerto fijo>/mcp`, un Bearer de 32 bytes **por servidor de OpenCode**: `clientFor({product, folder?, sandboxed})`, con registro token → cliente.
- Cualquier `Origin` → 403. También bloquea a las propias páginas embebidas, que además tienen `loopback-network` denegado.
- Config de OpenCode: `{type:'remote', url, headers:{Authorization}, oauth:false, enabled:true, timeout:<igual que computer>}`. Las esperas de aprobación bloquean la llamada, como ya hace `request_access` (probado en los Lotes A y B), con un tope de 10 min → denegado.
- El servidor `initialize` devuelve `instructions` (resumen de uso en español). Las descripciones de cada herramienta son autosuficientes: son la vía garantizada para Code, que no tiene `.md` propio.

### B.7 Cableado con OpenCode
- **Plugin nuevo `onyxcode-session.js`** (en `opencode-config.ts`, activo en TODOS los servidores): en `tool.execute.before`, si `input.tool` empieza por `browser_`, hace `output.args.onyxcode_session = input.sessionID` mutando el objeto en sitio, igual que plan-gate (`opencode-config.ts:142-148`). Añadir `onyxcode_session` a lo que ya vigila `looksLikeInjection` no hace falta: ya está.
- **Code (sidecar):**
  - `server.ts` pasa a hacer `await browserMcp.configFor({product:'code'})` antes del `spawn`, que se pasa a `buildInlineConfig({ browserMcp })` y produce `mcp.browser`.
  - Si el MCP no arranca, el sidecar arranca igual, sin navegador.
- **Cowork Sandbox (novedad: antes no había navegador):**
  - `mcp.browser` embebido con `clientFor({product:'cowork', folder, sandboxed:true})`.
  - `sandbox.ts` añade `StartCoworkServerOptions.extraOutboundPorts?: number[]`, que se suma a `outboundPorts` (`sandbox.ts:97`) y en `manager.ts` recibe `[browserMcp.port]`.
- **Control total:**
  - Si `browserService.state().enabled` (Lote C, que ahora significa «Usar Chrome aparte») y está disponible → `mcp.browser` = pasarela del Lote C, sin cambios.
  - Si no → `mcp.browser` embebido.
  - `agent.cowork.permission['browser_*']='deny'` se mantiene; `computer.md` ya tiene `browser_*: allow`.
  - La puerta del plan bloquea `browser_*` hasta aprobarlo: es correcto y el prompt lo dice.
- **Agentes:**
  - `computer.md` «Navegador»: reescrita para el navegador integrado y visible. Tarjeta por sitio en el panel, el usuario puede pausarlo o tomar el control, contraseñas y pagos los hace el humano, no hay subida de archivos, datos no confiables, e incluir la navegación en el plan.
  - `cowork.md`: sustituir «solo existe en Control total» por «disponible también en Sandbox, con permiso por sitio».
  - Code: nada más que las descripciones y `instructions` del MCP.

### B.8 Aprobaciones por sitio (se suavizan, no se eliminan)
- **Qué se pregunta:** solo las navegaciones de primer nivel **atribuidas al agente** hacia un sitio (eTLD+1, con `sites.ts` del Lote C reutilizado) que no esté en:
  - «Permitir siempre» del producto;
  - «Permitido en esta tarea» (en memoria, por `sessionId + sitio`);
  - «visitado por el usuario» (en memoria, por owner: si lo abriste tú, el agente puede seguir ahí).
- Los denegados persisten por producto. Los orígenes locales (`localhost:PUERTO`) se aprueban **por origen**, nunca por comodín.
- **Por qué no quitarla aunque ahora se ve:** verlo no garantiza prestar atención (en Control total la ventana se minimiza y el usuario suele estar en otra cosa), y una inyección necesita UNA sola navegación con datos en la URL para exfiltrar. Pedirla solo en la primera visita a cada sitio por tarea mantiene la protección con una fricción mínima; antes era por carpeta en un diálogo nativo modal.
- **Atribución** (el sentido seguro es «agente»): una navegación es del **usuario** solo si hubo un `input-event` humano en esa pestaña en el segundo previo, o si vino de la barra de URL/pestaña nueva/«Usar esta». Con una concesión de agente activa, todo lo demás cuenta como agente.
- **Momentos de control:**
  - antes de `loadURL` del agente;
  - `will-frame-navigate` (frame principal) y `will-redirect` → `preventDefault` y tarjeta; si se aprueba, `loadURL` de nuevo;
  - `did-start-navigation` → `stop()` + volver atrás o `about:blank`;
  - `verifyAfterAction`.
- **Tarjeta** (renderer de confianza, **fuera** del rectángulo de la vista, que se desplaza hacia abajo mientras la tarjeta está visible):
  - «¿Dejar que el agente abra **ejemplo.com**?», con la URL literal en monoespaciada;
  - botones «Permitir en esta tarea» · «Permitir siempre» · «No»;
  - `local-origin`: «¿Dejar que el agente abra tu servidor local **localhost:5173**?»;
  - `sensitive` y `download`: «Permitir» · «Cancelar».
- **Contra el clickjacking:**
  - los botones se **arman a los 700 ms** de aparecer;
  - el foco por defecto está en «No» y Esc deniega;
  - la tarjeta nunca se superpone a la página.
- **Sin anfitrión visible** (ventana minimizada, panel cerrado, sin ventana aparte): `dialog.showMessageBox` nativo como en el Lote C (URL literal, cancelar = No) más una notificación. Gana la primera respuesta, la de la tarjeta o la del diálogo.

### B.9 Interacción humana y control compartido
- El usuario hace clic, scroll, teclea, usa el IME y copia/pega directamente, porque es una vista nativa.
- Menú contextual propio de main: Atrás/Adelante/Recargar/Copiar/Pegar/Copiar enlace/«Abrir en el navegador del sistema» (solo http(s)). Sin «Inspeccionar».
- Atajos reservados con `before-input-event` sobre el webContents de la pestaña → evento `browser:shortcut`: ⌘L, ⌘T, ⌘W, ⌘R, ⌘[, ⌘] y ⌘1–4 (paneles de Code). Esc no se intercepta. ⌘⇧Esc sigue siendo global.
- **Barra del agente** en el panel:
  - «El agente está usando esta pestaña · {tarea}» con «Pausar» y «Detener» (detener = pausar + cancelar la acción en curso);
  - si el usuario toca la página mientras el agente actúa, estado «Estás usando el navegador: el agente espera» durante 3 s;
  - «Pausado · Reanudar».
- **Descargas:**
  - Del agente: tarjeta con nombre y destino (`item.pause()` hasta que se decida).
    - Cowork → `<carpeta>/.cowork/descargas/` (el sandbox puede leerla).
    - Code → `~/Downloads/<APP_NAME>/`.
  - Del usuario: diálogo de guardado nativo.
  - Nunca se abren solas.
- **Subidas:** solo el humano. El `<input type=file>` abre el selector nativo, que el agente no puede manejar, y no hay `DOM.setFileInputFiles`.
- **Diálogos JS:** `handle_dialog` según G4. Si Electron los muestra nativos aunque `Page.enable` esté activo, el humano los responde y la herramienta lo informa.

### B.10 Interfaz
**Componentes compartidos en `features/browser/`** (solo usan `window.api.browser`):
- `BrowserPanel({owner, product, visible, onAddToChat})`:
  - pestañas con título de la página, ✕ y «+»;
  - ← → ⟳/✕ y barra de URL editable (placeholder «Escribe una URL»), con el host resaltado e indicador «Conexión segura»/«No es seguro»; si no es una URL, busca en Google (pregunta 5);
  - botones «Seleccionar elemento» (`MousePointerClick`, `Overlay.setInspectMode`), «Añadir al chat» (`MessageSquarePlus`), «Abrir en ventana aparte» (`PictureInPicture2`) y «Abrir en el navegador del sistema»;
  - barra del agente, pila de tarjetas y el hueco de la vista.
- `useNativeViewport`: ResizeObserver, resize y `MutationObserver` que detecta `[role=dialog],[role=menu],[role=listbox],[data-floating]`. Si hay overlay o el panel está oculto → `visible:false` y captura congelada (`browser:capture`) como `<img>`.
- Registro de exploración (no hace falta en la ventana aparte). En la primera ejecución, un aviso: «Estás navegando dentro de {APP_NAME}. Nunca te pediremos contraseñas en esta zona».

**Code:**
- `RightPanel` añade `'browser'`: `PANEL_META {id:'browser', label:'Navegador', key:'4', icon:<Globe/>}` y ⌘4.
- La etiqueta de la pestaña del panel muestra el título de la página activa, truncado.
- Se monta la primera vez que se abre y luego queda oculto, como la Terminal. Al activarlo, el ancho pasa a ser al menos 640.
- Pestaña nueva vacía → `DevServerHint`: «Servidor de desarrollo detectado · http://localhost:5173 · Usar esta».
  - Fuentes: `browser:devServers` (scripts de `package.json` más sondeo TCP a 127.0.0.1 de los puertos inferidos y los comunes 3000/3001/4200/4321/5000/5173/5174/6006/8000/8080) y las URLs vistas en `pty:data` de la Terminal.
  - «Usar esta» cuenta como navegación del usuario.
- `browser:reveal` → abre el panel sin robar el foco.
- «Añadir al chat» y «elemento elegido» → `composer-inbox.ts` → el Composer inserta el texto «Página: {título} — {url}» o «Elemento: …» y adjunta la imagen (`Attachment` con `url` data:, formato que ya usa `Composer.tsx:36-47`).

**Cowork:**
- La cabecera del `aside` pasa a tener pestañas **«Progreso | Navegador»**.
- Con Navegador, el `aside` se puede redimensionar (560 por defecto, `cowork.browserWidth`).
- Owner = `{kind:'cowork', folder}` de la carpeta visible. `browser:reveal` → `setPanelOpen(true)` y pestaña Navegador.
- «Añadir al chat» → inserta el texto en el compositor (v1 sin imagen).

**Ventana aparte:**
- `BrowserWindow` «{APP_NAME} · Navegador», con preload `browser-host`, rol `browserHost` y página `onyxcode://app/browser/index.html`, que solo renderiza `BrowserPanel`.
- Se abre al pedirlo o **automáticamente** con `showInactive()` cuando el agente actúa y la ventana principal está minimizada u oculta (Control total).
- La vista se mueve a esta ventana; el panel principal muestra «Abierto en ventana aparte · Traer aquí».
- «Añadir al chat» desde aquí → `browser:toChat` → main lo reenvía a la ventana principal.

**Ajustes → Navegador** (`BrowserSection` reescrita):
- «Navegador integrado»:
  - «Permitir que el agente use el navegador» en Code y en Cowork;
  - sitios «Permitir siempre» y denegados por producto;
  - orígenes locales aprobados;
  - «Borrar datos» por producto.
- «Chrome aparte (avanzado, solo {COWORK_TERMS.fullControlShort})»: los controles del Lote C sin cambios de lógica.

### B.11 Destino del Lote C: se conserva como motor alternativo, sin borrar código
- **Motivos:**
  1. Muchos inicios de sesión (Google, Microsoft) rechazan navegadores embebidos («este navegador puede no ser seguro»).
  2. Algunos usuarios quieren un Chrome real aparte.
  3. Coste cero: el código ya existe y está probado con harness.
- **Reglas:**
  - Solo Control total, apagado por defecto, y **excluyente**: el flag `enabled` de `cowork-browser.json` pasa a significar «Usar Chrome aparte en vez del navegador integrado».
  - Cada servidor recibe UN único `mcp.browser`. Como los nombres de las herramientas coinciden, el prompt es uno solo.
  - No se toca `browser/{gateway,service,sites}.ts` ni `cowork-browser-handlers.ts`.

---

## C. Paquetes

Reglas comunes:
- No renombrar «OnyxCode». Texto en español; el nombre solo desde `brand.ts` y el glosario desde `cowork-glossary.ts`.
- Sin commits. Harnesses solo en el scratchpad propio (`$SP`).
- `npm run typecheck` limpio en lo propio.
- **Nadie toca** `resources/computer-use/**`, `src/preload/pill.ts` ni `CHANNEL_ROLES.pill`/`assist`. Nadie usa `--remote-debugging-port`.
- **Solo D5 ejecuta `npx electron-vite build`.** Nadie ejecuta `npm run dev`.

**Orden:** D0 primero, solo y como puerta. Después D1, D2, D3 y D4 en paralelo:
- D1 publica en sus primeros minutos `src/shared/ipc-browser.ts` y `src/main/embedded-browser/api.ts`.
- D3 publica el esqueleto exportado de `features/browser/index.ts` (`BrowserPanel` y sus props).
- Los demás esperan a que existan esos archivos antes de ejecutar typecheck.

Al final D5, solo.

### D0: Prueba de viabilidad en Electron real (ola 0, secuencial)
**Posee:** nada del repo; todo en `$SP`.

**Pasos:**
- `main.ts` propio compilado con `npx esbuild … --platform=node --format=cjs --external:electron` y lanzado con `npx electron $SP/d0/main.js`.
- Servidor HTTP de prueba en 127.0.0.1 con: botón que cambia texto, input, input de contraseña, `<select>`, enlace a `/p2`, enlace a otro puerto, `window.open`, descarga, `alert`, y un `fetch` a otro puerto loopback.

**Puertas (el informe pone PASA/FALLA y el fallback aplicado):**
- **G1.** Un `WebContentsView` dentro de un `BrowserWindow` visible con debugger `attach('1.3')`: `Accessibility.getFullAXTree`, `DOM.getContentQuads` más `Input.dispatchMouseEvent` (el texto cambia), `Input.insertText` y `Page.captureScreenshot`. **Si falla, se aborta el lote.**
- **G2.** Lo mismo con la vista NO añadida a ninguna ventana y `backgroundThrottling:false`, más `capturePage({stayHidden:true})`. Si falla: el agente siempre aloja la pestaña en el panel o en la ventana aparte antes de actuar.
- **G3.** ¿La entrada de CDP dispara `input-event`? ¿Y `sendInputEvent`? Decide si la atribución usa una ventana de tiempo o el evento.
- **G4.** ¿`alert`/`confirm` con `Page.enable` son nativos o se resuelven por CDP?
- **G5.** `wc.session === session.fromPartition(p)` dentro de `web-contents-created`.
- **G6.** Desde `https://example.com` (si hay red), un `fetch` a `http://127.0.0.1:<otro>` queda bloqueado con `loopback-network`/`local-network-access` denegados más la regla de `webRequest`.
- **G7.** `will-navigate` no se dispara con `loadURL` y sí `will-frame-navigate` en un clic enviado por CDP.
- **G8.** Mover la vista entre dos ventanas conserva la página y el debugger.
- **G9.** `xattr -p com.apple.quarantine` en un archivo descargado.

**Aceptación:** informe con las 9 puertas y los fallbacks.

### Correcciones de D0 (verificadas con Electron 44.4.5 real; D1 debe aplicarlas al pie de la letra)

1. **`capturePage`/`{stayHidden:true}` no es fiable cuando la vista no está en ningún `contentView` visible: cuelga sin resolver nunca.** `service.ts`/`surface.ts` deben usar SIEMPRE `Page.captureScreenshot` por CDP para la "captura congelada" (nunca la API nativa `webContents.capturePage`) cuando la vista pueda estar oculta o desprendida. El método `capture(tabId, maxLongSide)` de la API (B.5) se implementa así.
2. **La regla `webRequest.onBeforeRequest` que bloquea destinos loopback/privados NO es un refuerzo opcional: es la ÚNICA defensa que funciona en esta build.** Esta versión empaquetada de Chromium trae `LocalNetworkAccessChecks` desactivado (`--disable-features=...LocalNetworkAccessChecks...`), así que denegar `local-network-access`/`loopback-network` en los permission handlers NO tiene ningún efecto observable sobre un `fetch`/`XHR` normal — se comprobó en vivo: sin la regla de `webRequest`, una página remota alcanzó un puerto loopback sin problema; con la regla, quedó bloqueada. D1 debe implementar la regla de `webRequest` como obligatoria en B.2 («Red»), no como capa adicional, y su harness de verificación debe probar el caso SIN la regla primero (confirmar que sin ella fallaría) antes de confirmar que con ella bloquea.
3. **Confirmado con evidencia directa: `input-event` no distingue humano de agente.** `Input.dispatchMouseEvent` por CDP y `wc.sendInputEvent` disparan el mismo evento. La ventana de tiempo `userActive` (~3 s) de B.8 es indispensable, no un detalle menor; no hay atajo con `isTrusted` ni con el evento mismo.
4. **Las descargas no llevan `com.apple.quarantine` automáticamente** (verificado: `xattr -p com.apple.quarantine` no encuentra el atributo tras `will-download`+`setSavePath`). Si `downloads.ts` (D1) quiere que Gatekeeper avise antes de que algo abra un archivo descargado por el agente (coherente con el hallazgo S4 del AUDIT sobre `cowork:openPath`), debe añadirlo a mano con `xattr -w com.apple.quarantine …` al guardar una descarga atribuida al agente.
5. **Riesgo no confirmado, sin bloquear:** en una corrida con varios procesos Electron de prueba lanzados sin pausa, una puerta dio timeout una vez sin causa clara (posible contención de recursos, no de la API); en 2 reintentos aislados pasó limpio. D1/D2 deben limpiar siempre vista+debugger en cada ruta de error antes de crear la siguiente, y sus propios harnesses deben usar timeouts generosos si encadenan varias pruebas de Electron en la misma corrida.

### D1: Contratos, superficie aislada, IPC y endurecimiento (ola 1)
**Posee:**
- Nuevos: `src/shared/ipc-browser.ts`; `src/main/ipc/browser-handlers.ts`; `src/preload/{browser-api.ts,browser-host.ts}`; `src/main/embedded-browser/{api.ts,session.ts,cdp.ts,surface.ts,service.ts,approvals.ts,downloads.ts,store.ts,popout.ts,dev-servers.ts}`.
- Existentes: `src/shared/ipc.ts` (solo `WindowApi.browser`); `src/main/ipc/schemas.ts`; `src/preload/index.ts`; `src/main/extras/windows.ts` (solo `PreloadName` más `'browser-host'`); `electron.vite.config.ts` (preload `browser-host`, renderer `browser: src/renderer/browser/index.html`); `src/main/security/web-security.ts`; `src/main/index.ts`.

**Pasos:**
1. Publicar primero `ipc-browser.ts` (B.4) y `api.ts` (B.5, más `ALLOWED_CDP`).
2. Esquemas y roles (B.4), `browser-api.ts` (según el patrón de `extras-api.ts`), `index.ts` del preload y `browser-host.ts` (solo `window.api.browser`).
3. `session.ts` (B.2 completa) y la exención de `web-security.ts` (B.3).
4. `cdp.ts`: attach perezoso, reattach tras `detach`, lista blanca, timeout de 10 s, reparto de eventos y `isolatedContext()` con `Page.createIsolatedWorld` por frame principal.
5. `surface.ts`: la pestaña (webPreferences de B.2, todos los guardas, `input-event`, `before-input-event`, `context-menu`, crash, certificados), con un límite de 6 pestañas por owner y 12 en total.
6. `store.ts`: `userData/embedded-browser.json` = `{version:1, prefs:{agentEnabled:{code:true,cowork:true}}, sites:{code:[],cowork:[]}, denied:{code:[],cowork:[]}, localOrigins:[]}`.
7. `approvals.ts` (B.8: cola por owner, respaldo nativo, tope de 10 min) y `downloads.ts` (B.9).
8. `dev-servers.ts` (B.10) y `popout.ts`.
9. `service.ts`: owners, alojamiento y bounds (× `getZoomFactor()`), concesiones, atribución, captura, «Seleccionar elemento» (`Overlay.setInspectMode` → `inspectNodeRequested` → `PickedElement` calculado en el mundo aislado) y apertura automática de la ventana aparte si la principal está minimizada.
10. `browser-handlers.ts` y cableado en `index.ts`: `embeddedBrowser.init({getMainWindow, getMainConnection: () => server.start()})`, registrar los handlers y liberar todo en `before-quit`.

**Aceptación:**
- `grep -rn "remote-debugging" src` vacío.
- `grep -c "webviewTag: false"` sin cambios en los archivos existentes.
- `git diff --stat src/preload/pill.ts` vacío.
- `CHANNEL_ROLES.pill`/`assist` intactos.
- `missingSchemas()` vacío.

**Verificación:** harness Electron (`esbuild --alias:@shared=./src/shared --external:electron`) que:
1. llama a `installWebSecurity()` con `shell.openExternal` sustituido por un registro;
2. crea una pestaña y navega como usuario a la página de prueba → carga y `openExternal` NO se llama;
3. una `BrowserWindow` en la sesión por defecto que navega a `https://example.com` → sigue bloqueada y `openExternal` SÍ se llama;
4. una cookie puesta en la vista no aparece en `defaultSession.cookies`;
5. `window.open` denegado; `file:///etc/hosts` cancelado; `getDisplayMedia` rechazado;
6. `sendInputEvent` marca `userActive`;
7. `browser:attach` sobre una ventana real aplica los bounds escalados.

Typecheck.

### D2: Herramientas del agente, MCP en main y cableado con OpenCode (ola 1)
**Posee:**
- Nuevos: `src/main/embedded-browser/{snapshot.ts,input.ts,keys.ts,tools.ts,mcp-server.ts,owner.ts}`.
- Existentes: `src/main/opencode/{config.ts,server.ts}`; `src/main/cowork/{manager.ts,sandbox.ts,opencode-config.ts}`; `resources/opencode/agents/{computer.md,cowork.md}`.

**Pasos:**
1. `mcp-server.ts`: HTTP en main con un puerto fijo reservado una vez, `clientFor`/`configFor`, JSON-RPC copiado de `computer/mcp-server.ts:1600-1779`, 401/403 e `instructions`.
2. `owner.ts` (B.6.1); `snapshot.ts` (AXTree → texto con uids que caducan al navegar); `input.ts` (B.6.4–6); `keys.ts` (tabla de teclas; bloquea `Meta+Q`/`Meta+W`).
3. `tools.ts`: las 17 + 4 herramientas con las guardas de B.6, siempre a través de la API de D1.
4. El plugin `onyxcode-session.js` (B.7) en `opencode-config.ts`.
5. Code: `server.ts`/`config.ts`. Cowork: `manager.ts`/`sandbox.ts`, con la elección de motor de B.11.
6. Los prompts de B.7.

**Aceptación:**
- `grep -n "setFileInputFiles\|getAllCookies\|remote-debugging" src/main/embedded-browser` vacío.
- `tools/list`: 17 herramientas en Cowork y 21 en Code.

**Verificación:** harness Electron con la API real de D1 y la página de prueba. Llamadas HTTP JSON-RPC con `onyxcode_session` puesto a mano; las aprobaciones se resuelven desde el harness escuchando `browser:approval`.
- `initialize` y `tools/list`.
- Sin token → 401; con `Origin` → 403.
- `navigate_page` al origen de prueba → tarjeta `local-origin` → `task` → ok.
- `take_snapshot` contiene `button "Cambiar"` → `click` → `get_page_text` contiene «Cambiado».
- `fill` del input → el valor se comprueba con `executeJavaScript` del harness.
- `fill` de la contraseña → error.
- `press_key Enter` → `/done`.
- Clic en el enlace a otro puerto → tarjeta → `deny` → error «El usuario no permitió…» y la pestaña queda en un host permitido.
- `take_screenshot` → JPEG de ≤1366 px.
- `evaluate_script`: en Cowork, herramienta desconocida; en Code con loopback, devuelve valor.
- `sendInputEvent` del «humano» → el siguiente `click` da `userActive`; pausa → `paused`.

Además, un esbuild de `opencode-config.ts` que compruebe que el plugin generado contiene `startsWith('browser_')`, y un typecheck.

### D3: UI compartida del navegador y Code (ola 1)
**Posee:**
- Nuevos: `src/renderer/src/features/browser/**` (`BrowserPanel.tsx`, `TabStrip.tsx`, `UrlBar.tsx`, `AgentBar.tsx`, `Cards.tsx`, `DevServerHint.tsx`, `useNativeViewport.ts`, `store.ts`, `bridge.ts`, `index.ts`) y `features/code/impl/composer-inbox.ts`.
- Existentes: `features/code/impl/{CodeWorkspace.tsx,types.ts,store.ts,Composer.tsx}`.

**Pasos:**
1. Publicar primero `index.ts` con las props de B.10.
2. Componentes (B.8 tarjetas con armado a 700 ms; B.9 barra del agente; B.10).
3. `RightPanel`, `PANEL_META`, ⌘4, `initialPanel` y el ancho mínimo; `reveal`; bandeja del compositor.
4. «Seleccionar elemento», «Añadir al chat» y detección del dev server (con regex sobre `pty:data`).

**Aceptación:**
- Typecheck web.
- `grep -n "window.api.browser" features/browser` presente; `grep -n "window.api.\(code\|cowork\)" features/browser` vacío.
- Sin nombre de producto literal.

### D4: Cowork, Ajustes, ventana aparte y glosario (ola 1)
**Posee:**
- `features/cowork/impl/{CoworkWorkspace.tsx,CoworkComposer.tsx}`.
- `features/settings/impl/BrowserSection.tsx`.
- Nuevos `src/renderer/browser/{index.html,main.tsx}`.
- `src/shared/cowork-glossary.ts` (añade `browser:'Navegador'` y `externalChrome:'Chrome aparte'`).

**Pasos:** pestañas «Progreso | Navegador» y ancho del `aside`, `reveal` y el texto hacia el compositor; `BrowserSection` (B.10 y B.11); entrada de la ventana aparte (CSP `<meta>` igual que `quick/index.html` e importando `globals.css`).

**Aceptación:**
- Typecheck.
- `grep -rn "Acceso total\|acceso completo\|Carpetas autorizadas" src/renderer` vacío.

### D5: Integración, documentación y build (ola 2, secuencial, al final)
**Posee:**
- Documentación: `AUDIT.md` (§11), `docs/SEGURIDAD.md` (fila del §1 y nuevo «3 quater»), nuevo `docs/LOTE-D.md`.
- Correcciones de integración en cualquier archivo, solo porque trabaja después de todos los demás.

**Pasos:** `npm run typecheck && npx electron-vite build`; volver a pasar los harnesses de D1 y D2 contra el árbol final; greps de D1–D4; comprobar `ls out/preload/browser-host.js out/renderer/browser/index.html`; escribir la documentación con lo verificado y lo NO verificado.

---

## D. Comprobaciones finales y prueba manual

**Orquestador:**
- Typecheck y el build de D5.
- Greps: sin `remote-debugging`; `webviewTag: false` intacto; `pill.ts` sin diff; exención de `web-security.ts` solo por `isEmbeddedBrowserSession`; `ALLOWED_CDP` sin cookies, Target ni setFileInputFiles.
- `shasum resources/computer-use/helper.swift resources/computer-use/bin/cu-helper` sin cambios.
- Revisar los informes de D0 a D2.

**Prueba manual del usuario** (`npm run dev -- --watch`):
1. **Code, uso humano.** ⌘4 → «Escribe una URL» → example.com.
   - Clic, scroll, teclear, copiar/pegar y menú contextual funcionan.
   - Redimensiona el panel: la página se ajusta.
   - Abre el menú del proyecto encima: la página se congela o oculta y luego vuelve.
2. **Dev server.** `npm run dev` en la Terminal de un proyecto web → pestaña nueva → «Servidor de desarrollo detectado · Usar esta».
3. **Agente en Code.**
   - «abre localhost:5173 y pulsa X»: el panel se abre solo, el elemento se resalta antes de cada clic y aparece la barra «El agente está usando…».
   - «abre wikipedia.org»: aparece la tarjeta y los botones se activan tras un momento. «No» → el agente lo explica.
4. **Tomar el control.** Haz clic en la página mientras el agente trabaja → espera. Prueba también «Pausar», «Reanudar» y «Detener».
5. **Seleccionar elemento / Añadir al chat.** Aparecen el chip y la captura en el compositor.
6. **Login.** El agente se niega a escribir la contraseña y la escribes tú.
7. **Pago** (tienda de prueba): tarjeta «acción sensible».
8. **Descarga.** Tarjeta de descarga y archivo en `~/Downloads/<APP_NAME>/`; tus propias descargas piden «Guardar».
9. **Cowork Sandbox.** Tarea «busca en wikipedia…» → pestaña Navegador y las mismas tarjetas. En Ajustes aparecen los sitios por producto; prueba quitar uno y «Borrar datos».
10. **Cowork Control total.** La ventana se minimiza → aparece la ventana «Navegador» sin robar el foco y se ve en vivo. ⌘⇧Esc la detiene.
11. **Chrome aparte.** Activarlo → Control total usa el Chrome del Lote C. Desactivarlo.
12. **Seguridad a mano:**
    - un demo de `getDisplayMedia`/geolocalización es denegado;
    - un enlace `mailto:` no abre Mail;
    - `file:///etc/hosts` en la barra se rechaza;
    - `ps aux | grep remote-debugging` vacío;
    - un inicio de sesión de Google puede rechazar el navegador (esperado → Chrome aparte).
13. `curl -u … <baseUrl>/config` muestra `mcp.browser` (remote 127.0.0.1) en el sidecar y en Cowork.

---

## E. Riesgos y preguntas abiertas

**Riesgos**
1. **Exploit del renderer de Chromium** en una página arbitraria. Es la nueva clase principal de riesgo, y Electron publica los parches de Chrome con retraso.
   - Mitigación: renderer con sandbox, aislamiento de sitios, sin preload ni Node, partición propia y ningún IPC privilegiado alcanzable.
   - Queda como obligación mantener Electron al día (documentarlo en DISTRIBUCION/SEGURIDAD).
2. **Error en la exención de `web-security.ts`:** si cubriera ventanas de la app, perderían el endurecimiento. Mitigación: identidad del objeto de sesión y el test de D1.
3. **Inyección de prompt desde las páginas.**
   - Mitigado con: permiso por sitio, visibilidad, resaltado, acciones sensibles, sin scripts fuera de loopback, sin subidas, sin contraseñas, marca de «datos no confiables».
   - Queda: dentro de un sitio aprobado y con sesión iniciada, el agente puede hacer daño (borrar, enviar). La heurística de acciones sensibles es parcial.
4. **Clickjacking y suplantación de la interfaz.** La página puede cronometrar clics o imitar tarjetas dentro de su rectángulo.
   - Mitigación: las tarjetas nunca están dentro de ese rectángulo, se arman a los 700 ms, la opción por defecto es «No», y la barra de URL y la etiqueta son persistentes.
5. **Huella del anfitrión.** Aunque el UA se limpie, otras señales (`window.chrome`, client hints) pueden delatar Electron, y hay sitios que lo bloquean. Fallback: Chrome aparte.
6. **Red local.** Una página podría intentar alcanzar los servidores de OpenCode, el MCP o los proxies en 127.0.0.1.
   - Mitigación: LNA denegado, regla de `webRequest`, tokens y rechazo de `Origin`.
   - Queda: DNS rebinding contra un origen local que el propio usuario aprobó.
7. **Sesiones iniciadas persistentes** accesibles para el agente en sitios aprobados. Mitigación: perfiles separados Code/Cowork, «Borrar datos» y aprobación por tarea.
8. **Canal de salida en el Sandbox de Cowork.** El navegador sale por el proceso de la app, no por el proxy de egress. Lo cubre el permiso por sitio; quedan los subrecursos y la exfiltración por query string hacia sitios aprobados (igual que `websearch`).
9. **Atribución heurística.** Una redirección tardía mal atribuida es el error peligroso; por eso el sentido por defecto es «agente» y existe `verifyAfterAction`.
10. **Código de herramientas en el proceso principal:**
    - un bug corre en main: no escribe en disco, tiene entradas acotadas y la lista blanca de CDP;
    - un AXTree enorme podría bloquearlo: tope de 1500 nodos/60 KB;
    - rendimiento: un proceso por pestaña, con los topes de 6/12.
11. **Capas nativas:** fallos visuales de orden z o de bounds (zoom, pantallas múltiples).
12. **Rutinas desatendidas:** las aprobaciones esperan hasta 10 min y luego se deniegan.
13. **Deriva de versiones de OpenCode:** la inyección de `onyxcode_session` y la semántica de los MCP `remote` deben reverificarse al actualizar.

**Decisiones del usuario (2026-09-28)**
1. Anfitrión: en línea (pestaña en el panel) + ventana «Navegador» propia cuando la principal está minimizada o se pide — tal como proponía el plan.
2. **Navegador APAGADO por defecto**, en Code y en Cowork (igual criterio que el Lote C: se activa a mano en Ajustes).
3. Lote C («Chrome aparte») se conserva como opción avanzada, sin borrar código — tal como proponía el plan.
4. **Navegador SÍ se activa en Cowork Sandbox**, con permiso por sitio (recomendado por el plan), aceptando que ese tráfico no pasa por el proxy de egress.
5. Perfiles separados Code/Cowork y Google como buscador por defecto en la barra — tal como proponía el plan.

**Preguntas para el usuario** (como mucho 5) — ya resueltas arriba; quedan solo como registro del razonamiento original:
1. **«Dentro de la ventana»:** el diseño lo hace en línea (pestaña del panel en Code y en el `aside` de Cowork) y, además, abre una **ventana «Navegador» propia de la app** cuando la principal está minimizada (Control total) o si la pides. ¿Te vale, o quieres solo en línea, aunque en Control total no se vería mientras está minimizada?
2. **Valor por defecto:** ¿el agente puede usar el navegador **activado por defecto** en Code y Cowork, con permiso por sitio? El Lote C lo tenía apagado.
3. **Lote C:** ¿conservar «Chrome aparte» como opción avanzada solo para Control total (recomendado: Google y Microsoft suelen rechazar navegadores embebidos) o eliminarlo?
4. **Sandbox de Cowork:** ¿activar el navegador también en Sandbox (recomendado, con permiso por sitio), sabiendo que su tráfico no pasa por el proxy de egress?
5. **Perfiles y buscador:** ¿perfiles separados Code/Cowork (recomendado) o uno compartido? ¿Google o DuckDuckGo en la barra de URL?

### Archivos críticos para la implementación
- /Users/ben/Documents/App OpenCode/src/main/security/web-security.ts
- /Users/ben/Documents/App OpenCode/src/main/embedded-browser/service.ts (nuevo; con `api.ts`, `session.ts`, `surface.ts`, `cdp.ts`)
- /Users/ben/Documents/App OpenCode/src/main/embedded-browser/tools.ts (nuevo; con `mcp-server.ts`)
- /Users/ben/Documents/App OpenCode/src/main/cowork/manager.ts (más `src/main/opencode/server.ts` y `src/main/cowork/opencode-config.ts`)
- /Users/ben/Documents/App OpenCode/src/shared/ipc-browser.ts (nuevo; más `src/main/ipc/schemas.ts`)
