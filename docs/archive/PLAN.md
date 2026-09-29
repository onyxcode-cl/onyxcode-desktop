> Archivado: documento histórico; ver README.md y docs/FASE6-PLAN.md.

# Plan — App de escritorio sobre OpenCode (nombre por definir)

Clon funcional de Claude Desktop (Chat · Cowork · Code) usando **OpenCode** como motor
y **OpenCode Go** como proveedor de modelos. Uso personal (macOS arm64 primero).

> El nombre de la app vive SOLO en `src/shared/brand.ts` (`APP_NAME`, `APP_ID`) y en
> `package.json`/`electron-builder.js`. Nunca hardcodear el nombre en otro lugar.

## Stack
- Electron 44 + electron-vite 5 + TypeScript (strict) + React 19 + Tailwind CSS 4
- Estado UI: Zustand. Iconos: lucide-react.
- Motor: `opencode serve` (binario en PATH o `~/.opencode/bin/opencode`) lanzado como sidecar
  por el proceso principal en `127.0.0.1:<puerto libre>`, con usuario/clave aleatorios.
- Cliente: `@opencode-ai/sdk` — se usa en el **renderer** vía `createOpencodeClient({ baseUrl })`
  (el main entrega baseUrl + auth por IPC). Eventos en tiempo real con `event.subscribe()` (SSE).
- Terminal: `node-pty` en main + `@xterm/xterm` en renderer.
- Modelos por defecto: proveedor `opencode-go` (ej. `opencode-go/deepseek-v4.1-flash`).

## Estructura
```
src/
  shared/          brand.ts, ipc.ts (contrato IPC tipado: canales + tipos), types.ts
  main/            index.ts (ventanas, tray, menú)
    opencode/      server.ts (sidecar: start/stop/health/restart)
    ipc/           handlers por módulo (register*Handlers)
    pty/           terminal
    scheduler/     rutinas (tareas programadas) persistidas en userData/routines.json
    git/           worktrees, status, diff (simple-git o child_process)
    store.ts       settings persistidos (userData/settings.json)
  preload/         index.ts → expone `window.api` tipado según shared/ipc.ts
  renderer/
    src/
      app/         App.tsx, layout (sidebar + modos), router por modo
      lib/         opencode.ts (cliente SDK + hook de eventos), api.ts (window.api)
      stores/      zustand stores
      features/
        chat/      Chat: conversaciones sin herramientas (agente "chat")
        code/      Code: proyectos/carpetas, diff, terminal, permisos, plan/build
        cowork/    Cowork: tareas autónomas sobre carpeta en sandbox
        routines/  Rutinas / tareas programadas
        settings/  Modelos, proveedor, MCP, apariencia
      components/  UI compartida (Button, Markdown, ModelPicker, MessageList…)
```

## Modos (como Claude Desktop)
| Modo | Descripción | Implementación |
|---|---|---|
| **Chat** | Conversación general, markdown, adjuntos, historial | sesión OpenCode con agente `chat` (sin tools), directorio = userData/chat-workspace |
| **Code** | Agente de programación sobre una carpeta | sesiones OpenCode con `directory` = proyecto; agentes `build`/`plan`; panel diff, terminal, permisos |
| **Cowork** | Tareas autónomas sobre una carpeta de documentos | agente `cowork` con tools de archivos + bash dentro de sandbox (`sandbox-exec` en macOS, fase 2: contenedor) |
| **Rutinas** | Tareas programadas (cron) que lanzan prompts | scheduler en main + notificaciones nativas |

## Fases
1. **Base** — scaffold, sidecar OpenCode, IPC tipado, layout con sidebar y selector de modo, selector de modelo, chat con streaming. ✅ criterio: enviar un mensaje y ver respuesta en streaming con un modelo de Go.
2. **Code** — abrir carpeta, sesiones por proyecto, permisos (aprobar/rechazar), diffs, terminal integrada, plan/build, git status/worktrees.
3. **Cowork + Rutinas + MCP** — agente cowork en sandbox, scheduler, gestión de servidores MCP y ajustes.
4. **Remote** — servidor accesible desde el teléfono vía dominio propio (Caddy) + UI web móvil.
5. **Extras** — artifacts (ventana HTML), voz (whisper.cpp), quick entry (atajo global), empaquetado firmado.

## Convenciones
- TypeScript strict, sin `any` salvo tipos del SDK imposibles.
- Todo texto de UI en español.
- Cada módulo de main expone `register<Modulo>Handlers(ipcMain)`; canales definidos en `shared/ipc.ts`.
- `npm run typecheck` y `npm run build` deben pasar antes de dar un trabajo por terminado.
