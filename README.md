# OpenDesk (nombre provisorio)

Cliente de escritorio estilo Claude Desktop (modos **Chat · Code · Cowork · Rutinas**) construido sobre
el servidor de agentes de [OpenCode](https://opencode.ai), usando la suscripción **OpenCode Go** como
proveedor de modelos. El plan completo está en [`PLAN.md`](./PLAN.md).

> El nombre de la app vive solo en `src/shared/brand.ts`, `package.json` y `electron-builder.yml`.

## Requisitos

- macOS (arm64 primero), Node.js 22 (`/opt/homebrew/opt/node@22/bin`).
- OpenCode CLI instalado (`~/.opencode/bin/opencode` o en el `PATH`) y con el proveedor
  `opencode-go` autenticado (`opencode auth login`). La app **no** lee ni copia tus credenciales:
  el propio `opencode serve` las usa.
- Opcional: `OPENCODE_BIN=/ruta/a/opencode` para forzar un binario concreto.

## Uso

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm run dev        # app en modo desarrollo (HMR)
npm run typecheck  # tsc estricto (main/preload + renderer)
npm run build      # compila a out/
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
   `~/Library/Application Support/OpenDesk/chat-workspace`). Los ajustes se guardan en
   `userData/settings.json`.

## Estructura

```
src/
  shared/        brand.ts · ipc.ts (contrato IPC tipado) · types.ts
  main/          index.ts · store.ts · opencode/ (sidecar) · ipc/ (register*Handlers)
                 pty/ · git/ · scheduler/ (fases 2–3)
  preload/       index.ts → window.api tipado
  renderer/src/  app/ (layout, modos) · lib/ · stores/ · components/ · features/{chat,code,cowork,routines,settings}
```

### Agregar un modo o una vista

Cada feature exporta un `ModeDefinition` desde `features/<modo>/index.ts` (vista, contenido de la
barra lateral y botón "nuevo"). Registrarlo es una línea en `src/renderer/src/app/modes.ts`.

### Agregar un canal IPC

1. Declararlo en `IpcInvokeContract` (y en `IPC_INVOKE_CHANNELS`) en `src/shared/ipc.ts`.
2. Implementarlo con `handle(ipcMain, 'canal', fn)` en `src/main/ipc/<modulo>.ts`
   (`register<Modulo>Handlers`, registrado en `src/main/ipc/index.ts`).
3. Usarlo en el renderer con `call('canal', req)` (`lib/api.ts`).

## Estado

Fase 1 (base) lista: sidecar, IPC tipado, layout con selector de modo, selector de modelo y Chat con
streaming (texto, razonamiento colapsado, herramientas compactas, Markdown con resaltado, detener,
renombrar y eliminar conversaciones). Code, Cowork, Rutinas y Ajustes avanzados son placeholders.
