# OnyxCode

> Proyecto independiente y sin fines de lucro para promover OpenCode Go. No está afiliado a OpenCode ni a Anthropic.

OnyxCode es un cliente de escritorio para macOS, de código abierto, que usa el servidor de agentes de
[OpenCode](https://opencode.ai) y la suscripción **OpenCode Go**. Tiene cuatro modos: **Chat**, **Code**,
**Tareas** (trabajo autónomo sobre carpetas con sandbox) y **Rutinas**. El plan original está archivado en
[`docs/archive/PLAN.md`](./docs/archive/PLAN.md); el plan vigente es [`docs/FASE6-PLAN.md`](./docs/FASE6-PLAN.md).

> El nombre de la app vive solo en `src/shared/brand.ts`, `package.json` y `electron-builder.js`.

## Requisitos

Para usar la app:

- macOS con Apple Silicon (arm64).
- Nada más que instalar: **OpenCode ya viene incluido en el instalador**. El CLI de OpenCode es **opcional**
  (si ya lo tienes, la app puede usarlo; ver «Motor»). Ya no hace falta `opencode auth login`: la API key de
  OpenCode Go se pega en el asistente de primer uso (o en Ajustes › Modelos) y la guarda OpenCode.
- Opcional: `OPENCODE_BIN=/ruta/a/opencode` para forzar un binario concreto.

**Sobre tus credenciales.** OnyxCode tiene su propia conexión: las claves que pegas en el asistente o en
Ajustes › Modelos las guarda el motor en el almacén propio de la app
(`~/Library/Application Support/OnyxCode/opencode-data/opencode/auth.json`), aislado del CLI de OpenCode: la app no
lee `~/.local/share/opencode`. Ese fichero lo lee el motor y, además, el proceso principal de la app lo lee al
arrancar una Tarea con sandbox. En **Tareas con sandbox solo se usa OpenCode Go**: su clave real queda en un proxy
local fuera del sandbox y el motor de la Tarea recibe un valor falso; los demás proveedores (y los inicios de
sesión OAuth) **no se pasan** al sandbox, así que ahí no están disponibles. En **Control total** y en **Chat/Code
no hay aislamiento de credenciales**: el motor lee el almacén propio de la app. La app no registra la clave ni la
envía a ningún sitio salvo al proveedor (lo único que va al servidor de cuentas es tu correo; ver «Privacidad»). Detalle en [`docs/SEGURIDAD.md`](./docs/SEGURIDAD.md).

Para desarrollar: además, Node.js 22 (`/opt/homebrew/opt/node@22/bin`).

## Motor

El motor que hace el trabajo de fondo es **OpenCode oficial**, sin modificar y fijado a una versión que
probamos con esta versión de la app. Va **incluido dentro del instalador** (por eso no tienes que instalar
nada) y lo actualizamos nosotros más o menos una vez al mes, con cada versión nueva de OnyxCode.

Si prefieres tu propio OpenCode, puedes usarlo: la app usa tu CLI si tiene una versión compatible con la
probada y, si no, el motor incluido. También puedes elegir un binario concreto desde el asistente
(«Usar mi CLI…») o en Ajustes. Si el motor en uso no es el probado, la app te avisa (aviso cerrable) y
Ajustes › Acerca de muestra qué motor y qué versión estás usando. Los avisos de licencia de lo que
incluimos están en [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md); cómo se empaqueta y actualiza, en
[`docs/DISTRIBUCION.md`](./docs/DISTRIBUCION.md).

Aunque uses tu CLI como motor, la app usa su propio almacén de claves y sesiones.

## Términos de OpenCode y buenas prácticas de uso

OnyxCode es solo un cliente: los servicios (OpenCode, OpenCode Go y los modelos) son de OpenCode y de sus
proveedores, y **cada persona es responsable de usarlos conforme a sus
[términos de servicio](https://opencode.ai/legal/terms-of-service)** y su
[política de privacidad](https://opencode.ai/legal/privacy-policy). OpenCode Go no tiene términos propios: aplican
los generales. Léelos; estos son los puntos que más importan aquí (resumen, no asesoría legal):

- **Uso propio.** El servicio es para tu uso interno, no en nombre ni en beneficio de terceros.
- **Procesos sin sesión iniciada.** Los términos restringen los procesos que corren o se activan mientras no has
  iniciado sesión en sus servicios, y OpenCode decide qué cuenta como infracción. Las **Rutinas** se ejecutan solas,
  así que la app pide un aviso explícito antes de activarlas y no ejecuta ninguna por horario hasta que lo aceptes.
- **Extracción programática de datos.** Los términos limitan extraer datos o resultados de forma automática. Úsalo
  de forma interactiva y razonable.
- **Suspensión.** OpenCode puede suspender el acceso por cualquier motivo. OnyxCode no controla eso.
- **Modelos gratuitos.** El contenido enviado a los modelos gratuitos puede ser usado por OpenCode para mejorar sus
  servicios. No envíes información sensible con ellos.

Buenas prácticas:

- No compartas tu cuenta ni tu clave, ni rotes cuentas para saltarte límites.
- No exportes las respuestas para entrenar otros modelos ni las presentes como escritas por una persona.
- No metas secretos en los prompts ni en las carpetas que abras en Tareas.
- Revisa lo que hacen los agentes: pueden ejecutar comandos y modificar archivos.

OnyxCode desactiva la función de compartir sesiones de OpenCode (`share: "disabled"`) y no la usa.

## Uso (desarrollo)

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm run dev        # app en modo desarrollo (HMR)
npm run typecheck  # tsc estricto (main/preload + renderer)
npm run build      # compila a out/
npm test           # tests unitarios (Vitest)
npm run verify     # verificación completa: tipos, tests, lint, formato, build, smoke y E2E
npm run package    # build + DMG mac arm64 en dist/ (electron-builder)
```

Si `npm run dev` falla con `Error: Electron uninstall`, descarga el binario de Electron con
`node node_modules/electron/install.js`.

Variables útiles:

- `OPENCODE_SIDECAR_LOG=1` — imprime en consola la salida de `opencode serve`.
- `OPENCODE_BIN` — ruta explícita al binario de OpenCode.

## Cómo funciona

1. El proceso principal (`src/main/opencode/server.ts`) resuelve el binario `opencode` (`OPENCODE_BIN` →
   ruta de Ajustes → tu CLI si es compatible → motor incluido), elige un puerto
   libre y lanza `opencode serve --hostname 127.0.0.1 --port <n> --cors null` con usuario/clave
   aleatorios (`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`, HTTP Basic). Espera a
   `/global/health`, lo reinicia con backoff si se cae y lo mata al cerrar la app.
2. La config de la app se inyecta con `OPENCODE_CONFIG_CONTENT` (`src/main/opencode/config.ts`):
   define el agente `chat` (sin herramientas de archivos/terminal).
3. El renderer pide `baseUrl` + header `Authorization` por IPC (`opencode:connection`) y usa
   `@opencode-ai/sdk/v2/client` directamente. Los eventos llegan por un único stream SSE
   (`client.global.event()`), que alimenta el store genérico `stores/sessions.ts`.
4. El modo Chat trabaja en `userData/chat-workspace` (en macOS:
   `~/Library/Application Support/OnyxCode/chat-workspace`). Los ajustes se guardan en
   `userData/settings.json`.

## Estructura

```
src/
  shared/        brand.ts · ipc.ts + ipc-{code,tasks,extras,browser}.ts (contratos IPC tipados) · types.ts
  main/          index.ts · store.ts
                 opencode/ (sidecar) · ipc/ (register*Handlers, schemas, guard)
                 tasks/ (sandbox Seatbelt, servidores por carpeta, permisos) · scheduler/ (rutinas)
                 computer/ (control del Mac, helper Swift) · embedded-browser/ (navegador integrado, CDP)
                 pty/ · git/ · dialog/ · security/ · extras/ (bandeja, atajos) · util/ (net, exec, asar, paths)
  preload/       index.ts → window.api tipado (+ code-api, tasks-api, extras-api, browser-api)
                 quick · overlay · pill · assist · browser-host: preloads con sandbox, autocontenidos a propósito
  renderer/src/  app/ (layout, modos) · lib/ · stores/ · components/ · features/{chat,code,tasks,routines,settings,browser}
```

> **Nota para contribuidores:** en el código el modo Tareas se llama `tasks`
> (carpetas `features/tasks` y `main/tasks`, canales IPC `tasks:*`, `ModeId 'tasks'`). Los textos
> visibles viven en `src/shared/labels.ts`.

### Agregar un modo o una vista

Cada feature exporta un `ModeDefinition` desde `features/<modo>/index.ts` (vista, contenido de la
barra lateral y botón "nuevo"). Registrarlo es una línea en `src/renderer/src/app/modes.ts`.

### Agregar un canal IPC

1. Declararlo en el contrato de su área (`IpcInvokeContract` en `src/shared/ipc.ts`, o `ipc-code.ts`,
   `ipc-tasks.ts`, `ipc-extras.ts`, `ipc-browser.ts`) y en su lista de canales.
2. Añadir su esquema de validación en `src/main/ipc/schemas.ts`.
3. Implementarlo con `handle(ipcMain, 'canal', fn)` (o el `handle` de su área, todos creados con
   `makeInvokeHandler` de `src/main/ipc/handle.ts`) en `src/main/ipc/<modulo>.ts`; los registradores
   se llaman desde `src/main/index.ts`.
4. Usarlo en el renderer con `call('canal', req)` (`lib/api.ts`) o la API de su preload
   (`window.api.code`, `.tasks`, `.extras`, `.browser`).

## Estado

Chat, Code, Tareas, Rutinas, Ajustes y el navegador integrado están implementados. El detalle de cada
etapa (lotes A–D de Tareas, seguridad, rediseño) está en [`docs/`](./docs) y [`AUDIT.md`](./AUDIT.md);
la seguridad, en [`docs/SEGURIDAD.md`](./docs/SEGURIDAD.md) y la verificación, en
[`docs/VERIFICACION.md`](./docs/VERIFICACION.md).
Pendiente: control remoto desde el móvil, firma con Developer ID y auto-actualización (hoy solo hay un
aviso de versión nueva, sin instalación automática;
ver [`docs/DISTRIBUCION.md`](./docs/DISTRIBUCION.md)).

Licencia: pendiente de definir.

## Privacidad

OnyxCode se conecta a tres sitios:

- **Tu proveedor de IA**, el que elijas, con tus propias claves.
- **El servidor de cuentas (`https://api.onyxcode.cl`)**, porque la app exige iniciar sesión (con Google o con tu correo y un código). El servidor guarda **solo** tu correo, el proveedor con el que entraste (Google o correo) y las fechas (alta, último acceso y de las sesiones), más lo técnico imprescindible para operar (por ejemplo, la IP y el momento de cada petición). Puedes cerrar sesión, descargar tus datos y borrar tu cuenta desde Ajustes › Cuenta.
- **GitHub**, para el aviso de versión nueva: como mucho una consulta al día a su API pública, sin datos tuyos; no descarga ni instala nada. Puedes desactivarlo en Ajustes → Acerca de.

Tus **claves de IA y tus conversaciones se quedan solo en tu Mac**: nunca se envían al servidor de cuentas. Las páginas de política de privacidad y términos todavía no están publicadas; mientras tanto la app muestra el texto resumido (borrador en [`docs/PRIVACIDAD-BORRADOR.md`](./docs/PRIVACIDAD-BORRADOR.md) y [`docs/TERMINOS-BORRADOR.md`](./docs/TERMINOS-BORRADOR.md)).

## Marcas y agradecimientos

OnyxCode es un proyecto independiente y sin fines de lucro. OpenCode y OpenCode Go pertenecen a sus
autores. Anthropic y Claude son marcas de Anthropic, PBC. Este proyecto no tiene afiliación con ellos ni
cuenta con su respaldo.
