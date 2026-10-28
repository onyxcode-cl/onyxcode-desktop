# Plan maestro 1.7: lo nuevo, visible, que no se pierde y que supera a Codex, Claude y OpenCode

Fecha: 2026-10-23 (noche). Ventana de trabajo: hasta las 06:00. Estado de partida: **1.6.3 publicada** (motor `v1.19.0-lazunox.4`). Todo lo de abajo se hace en ramas; `main` de los dos repositorios sigue siendo lo publicado hasta pasar la puerta de calidad.

## Objetivo

Que las funciones nuevas (ayudantes, Code Mode con pausa, shell en segundo plano, `permission.ask`) sean **visibles, controlables, resistentes y consistentes**:

1. Al terminar un trabajo en segundo plano la conversación **despierta sola** (como OpenCode 2.x) y sin canal de inyección abierto.
2. Una ejecución de Code Mode viva **respeta el rechazo de un permiso** y al pausarse informa un **resumen útil** de lo avanzado.
3. El shell en segundo plano funciona también en **Windows nativo**, probado en el PC de pruebas.
4. Lo que el motor tenía en marcha **no se pierde en silencio** tras un reinicio: marcadores en disco, mensaje claro y limpieza de procesos huérfanos.
5. La app muestra **un solo panel de trabajos** (comandos, scripts, ayudantes) con botón de esperar/parar.
6. Los límites de Code Mode y del shell se **configuran en Ajustes**.

## Carriles (cada uno con su rama y su copia del servidor; no se pisan)

| #   | Carril                                                                                                            | Repositorio / rama                 | Copia en el servidor   | Entrega  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------- | -------- |
| L1  | Despertar al terminar (shell y celdas)                                                                            | motor `feat/despertar-al-terminar` | `/opt/lzx-a-wake`      | 00:10    |
| L2  | Celda viva: rechazo de permiso detiene el resto + resumen al pausar                                               | motor `feat/celda-viva`            | `/opt/lzx-a-celda`     | 02:15    |
| L3  | Shell en segundo plano en Windows nativo (probado en el PC)                                                       | motor `feat/shell-windows`         | `/opt/lzx-a-win`       | 02:15    |
| L4  | Marcadores en disco, aviso tras reinicio, limpieza de huérfanos **y las rutas HTTP de trabajos (contrato abajo)** | motor `feat/trabajos-reinicio`     | `/opt/lzx-a-reinicio`  | 02:15    |
| L5  | Panel unificado de trabajos en la app                                                                             | app `feat/panel-trabajos`          | `/opt/lzx-app-panel`   | 02:30    |
| L6  | Ajustes: límites de Code Mode y shell                                                                             | app `feat/ajustes-limites`         | `/opt/lzx-app-ajustes` | 02:30    |
| L7  | Revisión de seguridad independiente de TODO lo anterior (solo lectura)                                            | —                                  | —                      | 03:30    |
| L8  | Integración, compilación, pruebas reales, paquetes (yo)                                                           | rama `integracion-1.7` del motor   | `/opt/lzx-fork/src`    | continuo |

Reglas para todos los agentes: no publicar, no hacer `git push`, no tocar `main` ni `/Applications`, nada de bun/npm pesado en el Mac (todo en el servidor con `/opt/lzx-test.sh` para el motor y `/opt/lzx-app-test.sh` para la app, una prueba a la vez por agente), commits con la línea `Co-Authored-By`, y entregar un informe con resultados REALES.

## Contrato motor ↔ app (lo acuerdan L4 y L5 sin esperarse)

- `GET /experimental/session/{sessionID}/trabajos` → `{ "trabajos": [ { "id": "sh_…" | "cm_…", "tipo": "shell" | "celda", "titulo": string, "estado": "en_curso" | "terminado" | "terminado_por_ti" | "tope_de_vida" | "perdido", "codigo": number | null, "inicio": number, "fin": number | null } ] }` (milisegundos desde 1970; solo los trabajos de ESA sesión; máximo 50, los más recientes primero).
- `POST /experimental/session/{sessionID}/trabajos/{id}/terminar` → `{ "ok": boolean }` (mata el grupo de procesos o interrumpe la celda; `ok:false` si no existe, ya terminó o es de otra sesión; nunca revela trabajos ajenos).
- Se registran igual que `POST /experimental/session/:sessionID/background` (grupo `experimental`). La app los llama con `fetch` directo al sidecar y con la autorización de siempre.

## Orden de integración (conflictos mínimos)

L1 primero (toca `shell.ts` y `code-mode.ts`), luego L3 y L4 (`shell.ts`/`background.ts`), luego L2 (`code-mode.ts`). La app: L6 antes que L5 (comparten tipos de ajustes). Todo entra a `integracion-1.7`; a `main` solo tras la puerta.

## Calendario

| Hora        | Hito                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| 00:00       | Arrancan L2-L6 (L1 ya trabaja)                                                                      |
| 00:30       | Integro L1, compilo, pruebo el aviso contra el motor real                                           |
| 02:15-02:30 | Entregas de L2-L6                                                                                   |
| 02:30-03:30 | Integración, compilación 3 plataformas, `engine-probe` completo, suite del servidor, L7 en paralelo |
| 03:30-04:15 | Correcciones de lo que encuentre L7 y las pruebas                                                   |
| **04:15**   | **CONGELAMIENTO**: nada nuevo; solo se corrige lo que falle                                         |
| 04:15-05:15 | Empaquetar macOS y Windows, E2E, `pack-check`, prueba en tu app real, borrador                      |
| 05:15       | Puerta final y decisión de publicar                                                                 |

## Puerta de calidad (todo debe cumplirse para publicar 1.7.0; si algo falla, esa pieza se deja fuera y sale lo demás, o no sale nada)

- Servidor: suite completa 0 fallas y tipos sin errores; E2E de Electron verde.
- `engine-probe` contra el binario real: todas las comprobaciones, incluidas las nuevas de cada carril.
- Windows: `pack-check -Install` con 0 fallos, y el shell en segundo plano probado en el PC.
- Revisión de seguridad L7 sin hallazgos críticos ni altos abiertos.
- Prueba manual en tu app real (Chat, Code, ayudante, comando largo con aviso).
- Compilación idéntica dos veces en las tres plataformas.
- Si a las 05:15 no se cumple todo: **se queda la 1.6.3** y las ramas esperan.

## Decisión tuya (la dejo con recomendación)

**Dos mecanismos de comandos largos** (`bgshell` de la app y el shell del motor). Recomendación: mantener ambos esta noche (el nuevo ya despierta solo con L1) y decidir mañana con datos de uso cuál se retira.

## Riesgos y cómo se controlan

- **Muchos cambios a la vez:** ramas separadas, congelamiento a las 04:15 y puerta de calidad; la 1.6.3 publicada no se toca.
- **Canal de inyección** en los avisos automáticos: texto marcado como dato, tope por sesión y revisión L7.
- **Capacidad del servidor (8 núcleos):** una prueba por agente a la vez; las compilaciones las hago yo.
- **PC Windows compartido:** L3 solo trabaja bajo `C:\onyx\` y limpia lo que cree.
