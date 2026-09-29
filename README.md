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
- OpenCode CLI instalado (`~/.opencode/bin/opencode` o en el `PATH`) y con el proveedor
  `opencode-go` autenticado (`opencode auth login`). La app **no** lee ni copia tus credenciales:
  el propio `opencode serve` las usa.
- Opcional: `OPENCODE_BIN=/ruta/a/opencode` para forzar un binario concreto.

Para desarrollar: además, Node.js 22 (`/opt/homebrew/opt/node@22/bin`).

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

1. El proceso principal (`src/main/opencode/server.ts`) busca el binario `opencode`, elige un puerto
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
  shared/        brand.ts · ipc.ts + ipc-{code,cowork,extras,browser}.ts (contratos IPC tipados) · types.ts
  main/          index.ts · store.ts
                 opencode/ (sidecar) · ipc/ (register*Handlers, schemas, guard)
                 cowork/ (sandbox Seatbelt, servidores por carpeta, permisos) · scheduler/ (rutinas)
                 computer/ (control del Mac, helper Swift) · embedded-browser/ (navegador integrado, CDP)
                 pty/ · git/ · dialog/ · security/ · extras/ (bandeja, atajos) · util/ (net, exec, asar, paths)
  preload/       index.ts → window.api tipado (+ code-api, cowork-api, extras-api, browser-api)
                 quick · overlay · pill · assist · browser-host: preloads con sandbox, autocontenidos a propósito
  renderer/src/  app/ (layout, modos) · lib/ · stores/ · components/ · features/{chat,code,cowork,routines,settings,browser}
```

> **Nota para contribuidores:** en el código, el modo que la app muestra como «Tareas» se llama `cowork`
> (carpetas `features/cowork` y `main/cowork`, canales IPC `cowork:*`, `ModeId 'cowork'`). Los textos
> visibles viven en `src/shared/labels.ts`.

### Agregar un modo o una vista

Cada feature exporta un `ModeDefinition` desde `features/<modo>/index.ts` (vista, contenido de la
barra lateral y botón "nuevo"). Registrarlo es una línea en `src/renderer/src/app/modes.ts`.

### Agregar un canal IPC

1. Declararlo en el contrato de su área (`IpcInvokeContract` en `src/shared/ipc.ts`, o `ipc-code.ts`,
   `ipc-cowork.ts`, `ipc-extras.ts`, `ipc-browser.ts`) y en su lista de canales.
2. Añadir su esquema de validación en `src/main/ipc/schemas.ts`.
3. Implementarlo con `handle(ipcMain, 'canal', fn)` (o el `handle` de su área, todos creados con
   `makeInvokeHandler` de `src/main/ipc/handle.ts`) en `src/main/ipc/<modulo>.ts`; los registradores
   se llaman desde `src/main/index.ts`.
4. Usarlo en el renderer con `call('canal', req)` (`lib/api.ts`) o la API de su preload
   (`window.api.code`, `.cowork`, `.extras`, `.browser`).

## Estado

Chat, Code, Tareas, Rutinas, Ajustes y el navegador integrado están implementados. El detalle de cada
etapa (lotes A–D de Tareas, seguridad, rediseño) está en [`docs/`](./docs) y [`AUDIT.md`](./AUDIT.md);
la seguridad, en [`docs/SEGURIDAD.md`](./docs/SEGURIDAD.md) y la verificación, en
[`docs/VERIFICACION.md`](./docs/VERIFICACION.md).
Pendiente: control remoto desde el móvil, firma con Developer ID y auto-actualización
(ver [`docs/DISTRIBUCION.md`](./docs/DISTRIBUCION.md)).

Licencia: pendiente de definir.

## Marcas y agradecimientos

OnyxCode es un proyecto independiente y sin fines de lucro. OpenCode y OpenCode Go pertenecen a sus
autores. Anthropic y Claude son marcas de Anthropic, PBC. Este proyecto no tiene afiliación con ellos ni
cuenta con su respaldo.
