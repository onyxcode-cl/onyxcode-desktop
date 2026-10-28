# Conectores de la vida diaria: correo, calendario y archivos en la nube

Investigación del **2026-10-17** (F8-B184). Objetivo: ofrecer en Personalización lo que Claude y Codex ofrecen (Gmail, Google Calendar, Google Drive, Outlook, OneDrive…), **gratis para la persona**, **solo lectura por defecto** y **sin que las contraseñas ni los tokens pasen por la app ni por terceros**.

**Resultado, dicho sin adornos: hoy no entra ninguna ficha nueva de correo, calendario ni archivos.** Ninguna opción cumple las cuatro condiciones a la vez _con el motor actual (OpenCode 1.19.0 fijado)_ y el esquema de v1 (solo conectores remotos). Lo que sí quedó: la etiqueta «Aún sin probar con una cuenta real» en las fichas que lo admiten, esta investigación, un script para repetirla y la lista exacta de lo que hay que decidir para desbloquear (sección 4).

## 1. Qué se evaluó

### 1.1 Servidores oficiales de Google (Gmail, Calendar, Drive, Docs, Sheets…): lo mejor que existe, bloqueado por el motor

- Fuente primaria: [Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers) y [aviso de Google](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html) (mayo de 2026).
- Son **remotos** (`https://gmailmcp.googleapis.com/mcp/v1`, `calendarmcp…`, `drivemcp…`, `docsmcp…`, `sheetsmcp…`), transporte Streamable HTTP, **oficiales de Google**, y Google los llama «developer preview» (vista previa pública para desarrolladores). La página no dice precio; el uso va con la cuenta de Google de la persona.
- **Exigen que la persona cree su propio cliente OAuth** en Google Cloud (proyecto, activar las APIs y los servicios `*mcp`, pantalla de consentimiento, cliente «Aplicación web» marcado «para un agente de IA», usuarios de prueba si es «Externo»). Google no anuncia registro dinámico de clientes (`accounts.google.com` no tiene `registration_endpoint`, comprobado). Es un trámite de una vez pero largo para una persona no técnica.
- Comprobado en vivo el 2026-10-17 (`node scripts/check-conectores-cotidianos.mjs`): `initialize` y `tools/list` responden **sin iniciar sesión**; solo `tools/call` devuelve 401. Herramientas reales (con su pista `readOnlyHint` del propio servidor):
  - Gmail, 23: lectura 6 (`search_threads`, `get_thread`, `get_message`, `list_drafts`, `get_draft`, `list_labels`); **no hay `send`** (solo `create_draft`), pero sí 17 que cambian cosas: etiquetas, papelera, spam.
  - Calendar, 9: lectura 5 (`list_events`, `get_event`, `list_calendars`, `search_events`, `suggest_time`); escriben 4 (`create_event`, `update_event`, `delete_event`, `respond_to_event`).
  - Drive, 8: lectura 6; escriben 2 (`copy_file`, `create_file`).
- **Por qué no entra** (dos bloqueos del _motor_, no de Google; comprobados con el OpenCode fijado en un perfil temporal, sin cuenta):
  1. **No se puede iniciar sesión.** El motor solo abre el inicio de sesión si el servidor contesta 401 al conectar. Estos servidores contestan 200, así que el motor los marca «conectado» y `POST /mcp/<nombre>/auth` devuelve una dirección de autorización **vacía** (`opencode mcp debug`: «Server responded successfully (no auth required)»). Una llamada a una herramienta daría 401, pero el motor no convierte eso en «falta entrar». La persona vería «Conectado» y errores sin forma de entrar. Probado también con una cabecera `Authorization` falsa para forzar el 401: Google la ignora.
  2. **No se puede limitar a solo lectura con permisos.** El motor pide al servicio _todos_ los permisos que el servidor anuncia (`scopes_supported`), ignorando el `scope` de la configuración. Para Gmail son 11, incluidos `mail.google.com` (todo), `gmail.send` y `gmail.modify`; para Calendar y Drive, también los de escritura. Comprobado en la dirección de autorización que arma el motor con otro servicio (Dropbox, abajo): pidió los nueve permisos anunciados, escritura incluida, aunque la configuración pedía solo tres de lectura.
- Lo que sí se puede hacer por herramienta con el motor: la clave `permission` admite `"<servidor>_<herramienta>": "deny"` (gana la última regla que coincide; [documentación de permisos](https://opencode.ai/docs/permissions/)). Con las listas de arriba se podría negar cada herramienta que escribe. **No se activó porque sin poder iniciar sesión no hay ficha que lo use**, y hay que revisar la lista cuando Google cambie sus servidores (la comprueba el script).

### 1.2 Microsoft 365 / Outlook / OneDrive: descartado

- Los servidores oficiales de Microsoft (Work IQ Mail, Calendar, OneDrive; [Work IQ MCP overview](https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview)) son para cuentas de trabajo o escuela, con un tenant de Entra y, según Microsoft Learn, una **licencia de Microsoft 365 Copilot** (de pago), más consentimiento de un administrador. Una fuente secundaria habla de cobro por consumo desde junio de 2026; no se pudo confirmar en las páginas de Microsoft. En ambos casos **no es gratis para una persona con Outlook.com o Hotmail**.
- Para cuentas personales solo hay proyectos comunitarios locales (`Softeria/ms-365-mcp-server`, MIT, `npx`, `--read-only`, inicio de sesión por código de dispositivo con una app de Microsoft del autor por defecto o una propia; guarda los tokens cifrados en un archivo y la clave en el Llavero). Son **programas locales**, fuera del esquema v1 (ver 1.4).

### 1.3 Dropbox y Box (archivos en la nube remotos): descartados por ahora

- **Dropbox** ([ayuda oficial](https://help.dropbox.com/integrations/connect-dropbox-mcp-server)): remoto (`https://mcp.dropbox.com/mcp`), responde 401 y el motor sí llega a «falta entrar». Pero el registro dinámico solo se concede a clientes de confianza (Claude, ChatGPT, Cursor): intentado como OpenCode, **403 `registration_not_supported`**. Para otros clientes hay que crear una app propia en Dropbox y Dropbox lo presenta como versión de prueba. Además la dirección de autorización pide los nueve permisos (escritura incluida, bloqueo 2 de arriba): no se puede garantizar «solo lectura» ni conocer los nombres de sus herramientas sin una cuenta. Se implementó y se probó una ficha con app propia y se **retiró** antes de publicarla por no poder respaldar «solo consulta».
- **Box**: remoto (`https://mcp.box.com/`), sin registro dinámico; exige app propia y que un administrador de Box habilite el MCP. No evaluado más allá de eso.

### 1.4 Servidores locales de la comunidad: la vía realista, fuera de lo que permite v1

- **`taylorwilsdon/google_workspace_mcp`** ([repositorio](https://github.com/taylorwilsdon/google_workspace_mcp)): licencia MIT, unos 3 400 estrellas, 3 229 commits, `uvx workspace-mcp --tools gmail calendar drive --read-only` (el indicador `--read-only` pide solo permisos de lectura). Gmail, Calendar, Drive, Docs, Sheets… El software es gratis; el autor ofrece además una instancia administrada de pago, que **no** se usaría. La persona también crea su propio cliente OAuth de Google; la sesión se abre en su navegador y el servidor guarda el acceso en su equipo (la página no precisa la ruta por defecto). No se pudo confirmar la fecha del último commit.
- **`Softeria/ms-365-mcp-server`** ([repositorio](https://github.com/Softeria/ms-365-mcp-server)): MIT, `npx @softeria/ms-365-mcp-server --read-only`, cuentas personales (`MS365_MCP_TENANT_ID=consumers`) con correo, calendario y OneDrive.
- Por qué no entran hoy: (a) el esquema v1 y su prueba exigen `transport: "remote"` y que añadir un conector **no ejecute ningún programa**; (b) hace falta `uv`/`npx` instalados y descargar código de PyPI/npm al conectar (cadena de suministro); (c) el sandbox de Tareas y el modo viaje habría que repasarlos. Es una decisión del dueño, no algo para colar en una ficha.

### 1.5 Servicios intermediarios (Composio, Zapier MCP, Pipedream, Smithery…): descartados

Ponen un servidor de terceros en medio: las credenciales o los tokens de la cuenta pasan por ellos y los planes útiles son de pago. Incumplen las dos reglas del proyecto (sin fines de lucro, nada de intermediarios de pago, credenciales sin terceros).

### 1.6 Los conectores de Anthropic (gmail.mcp.claude.com, microsoft365.mcp.claude.com): no sirven

Están atados a cuentas de Claude y a su propia aplicación OAuth.

## 2. Qué entró

- Ninguna ficha nueva. `catalogVersion` pasa a 2 por un cambio de contenido de las fichas existentes.
- **Etiqueta de estado real.** Nuevo campo opcional `accountTested` (`false` = nadie lo ha probado con una cuenta real). Las fichas que ya decían en su verificación «no se probó con una cuenta real» (Atlassian, Linear, Notion, Sentry) lo declaran, y la tarjeta y el detalle muestran «Aún sin probar con una cuenta real». Una prueba exige que la etiqueta y el texto de verificación coincidan, para que no se pueda afirmar una cosa y mostrar otra.
- Agrupación («Correo y calendario», «Archivos en la nube») y buscador ya existían desde F8-B181; los grupos aparecen solos cuando haya fichas.

## 3. Cómo repetir la comprobación

```
node scripts/check-conectores-cotidianos.mjs
```

Con red, sin cuentas ni claves. Imprime si los servidores de Google siguen respondiendo sin sesión, sus herramientas que escriben, los permisos que anuncian y si Dropbox/Box aceptan el registro dinámico. Si dice «CAMBIÓ», vuelve a evaluar la sección 1.1: puede que ya sea viable una ficha de Google.

## 4. Qué haría falta para tener Gmail y Calendar de verdad (decisiones para el dueño)

1. **Opción A, conectores locales** (la más cercana a lo que hacen Claude y Codex de escritorio): ampliar el esquema con `transport: "local"` solo para programas fijados por versión y hash, con la ficha diciendo qué se descarga y de dónde, y con `--read-only` obligatorio. La app seguiría sin ver contraseñas ni tokens (los guarda el programa). Hay que repasar el sandbox de Tareas y la prueba `catalogo.test.ts`.
2. **Opción B, inicio de sesión propio de la app** para los servidores oficiales de Google: la app haría el flujo OAuth (PKCE, navegador del sistema, permisos de lectura exactos) con el cliente OAuth de la persona y guardaría el acceso en el Llavero. Resuelve los dos bloqueos, pero **la app pasaría a manejar tokens**, lo contrario del principio actual. Solo con decisión expresa y revisión de seguridad.
3. **Opción C, esperar al motor**: que OpenCode inicie sesión tras un 401 en una llamada y respete el `scope` configurado. Habría que pedirlo al proyecto; mientras tanto el script avisa si algo cambia.

## 5. Qué NO se verificó

- Ninguna autorización con una cuenta real (ni de Ben ni de nadie): no se creó ninguna app ni cuenta en Google, Microsoft o Dropbox, ni se instaló ningún servidor local.
- Los nombres de herramientas de Dropbox y Box (necesitan una cuenta para listarlas).
- Si Google o Dropbox aceptan `http://127.0.0.1:19876/mcp/oauth/callback` como dirección de retorno de un cliente «Aplicación web» (el motor usa esa dirección fija).
- Que los servidores locales de la sección 1.4 funcionen dentro de Lazunox.

## 6. Pasos para que Ben pruebe una autorización real cuando se decida una opción

No hace falta darle a nadie contraseñas ni claves. Todo lo hace Ben en su navegador y en su equipo.

1. Con la opción A elegida y un servidor local instalado por Ben (por ejemplo `uvx workspace-mcp --tools gmail calendar --read-only` tras crear su cliente OAuth de Google siguiendo el README del proyecto): añadirlo como conector, abrir **Personalización › Conectores** y comprobar que figura «Aún sin probar con una cuenta real» hasta que el flujo funcione.
2. Entrar a la cuenta **en el navegador**, aceptar solo los permisos de lectura que muestre la pantalla de Google, volver a Lazunox.
3. Pedir «¿Qué tengo en la agenda esta semana?» y «Busca el último correo de [persona]». Debe preguntar antes de cada uso.
4. Pedir «Crea un evento mañana a las 10» o «Borra este correo»: debe **negarse** o pedir confirmación; si lo ejecuta sin preguntar, no dar por bueno el conector.
5. Revisar en la cuenta de Google (Seguridad › Conexiones con terceros) que la app tiene solo permisos de lectura, y **quitar** el conector en Personalización › Tuyos; confirmar que el acceso desaparece también allí.
6. Si todo sale bien, subir la ficha con `accountTested` omitido (o `true`) y la fecha de la prueba en `verification`.

## 7. Actualización F8-B186: la opción A se implementó

Se implementó la opción A (§4): conectores locales de solo consulta para Google Workspace (`workspace-mcp` 2.0.1) y Microsoft 365 (`@softeria/ms-365-mcp-server` 0.157.2, cuentas personales). Comprobado el 2026-10-17: ambos arrancan por stdio, responden `initialize` y `tools/list` y en modo solo consulta exponen 18 de 38 (Google) y 44 de 101 (Microsoft) herramientas; Google pide únicamente `gmail.readonly`, `calendar.readonly` y `drive.readonly`; Microsoft, solo `Mail.Read`, `Calendars.Read`, `Files.Read`, `MailboxSettings.Read` y `User.Read` (con `--preset personal` pedía `Files.ReadWrite`, por eso se usa `--preset mail,calendar,files`). El motor respalda el solo-consulta con permisos por herramienta en `deny`. Diseño, límites y lo que no se verificó: `docs/SEGURIDAD.md` §3 quinquagies novies; cómo probarlos con una cuenta real: `docs/conectores-locales-prueba.md`. Los hallazgos de §1.1 (el motor no inicia sesión en los servidores oficiales de Google) siguen vigentes: por eso se usan los locales, que hacen su propio inicio de sesión.

**Actualización F8-B195.** Los conectores locales ya no exigen `uv` ni Node.js instalados: Lazunox descarga y verifica los suyos (Node.js 24.22.0 y uv 0.13.1, `docs/SEGURIDAD.md` §3 quinquagies septendecies); la ficha ofrece «Instalar lo necesario».
