# Lazunox

> Proyecto independiente y sin fines de lucro. No está afiliado a OpenCode ni a Anthropic.

**Lazunox es un cliente de escritorio de código abierto para trabajar con agentes de IA, en español, con tus propias claves y sin enviar nada a un servidor nuestro.** Corre en macOS (Apple Silicon) y en Windows 10/11 de 64 bits, y trae su propio motor de agentes.

| | |
|---|---|
| **Versión** | 1.7.9 · [qué cambió](./CHANGELOG.md) · [qué está verificado y qué no](./docs/VERIFICACION.md) |
| **Descarga** | [Releases](https://github.com/onyxcode-cl/onyxcode-desktop/releases/latest) · [guía de instalación](./docs/INSTALAR.md) |
| **Motor** | Lazunox Motor: fork propio y congelado de OpenCode 1.19.0 (MIT) · [plan](./docs/PLAN-MOTOR-PROPIO.md) |
| **Hoja de ruta del motor** | [Ola 7: acercarse a Claude Code, Codex y OpenCode 2.x (meta aún no demostrada)](./docs/PLAN-MOTOR-OLA7.md) |

## Qué hace

| Modo | Para qué |
|---|---|
| **Chat** | Conversar con el modelo que elijas; sin herramientas de archivos ni de terminal. |
| **Code** | Trabajar sobre un proyecto: editar, correr comandos, git, terminal, worktrees, ayudantes en segundo plano, volver atrás turno por turno. |
| **Tareas** | Trabajo autónomo sobre carpetas autorizadas, con aislamiento (Seatbelt en Mac, WSL2 en Windows) y una puerta que exige un plan aprobado antes de actuar. |
| **Rutinas** | Tareas programadas; piden un aviso explícito antes de activarse. |

Además: navegador integrado, control del Mac y del PC (con consentimiento por acción), traducción de PDF sin cambiar el diseño, visor de documentos y **control remoto desde el celular** (red local por defecto; «fuera de casa» es opcional y está apagado).

## Instalar

Gratis y sin administrador. Los instaladores no están firmados ni notarizados (no hay certificados de pago), así que el sistema muestra un aviso la primera vez: la guía [`docs/INSTALAR.md`](./docs/INSTALAR.md) lo explica paso a paso.

- **Mac con chip Apple:** `lazunox-X.Y.Z-arm64.dmg`. Ábrelo, arrastra Lazunox a Aplicaciones y ábrela. Si macOS dice que no puede verificarla: **Hecho**, luego **Ajustes del Sistema › Privacidad y seguridad › Abrir de todos modos**.
- **Windows 10/11 de 64 bits:** `Lazunox-Setup-X.Y.Z-x64.exe`. Si sale «Windows protegió su PC»: **Más información › Ejecutar de todas formas**.

<details>
<summary>Con la terminal: un comando, con verificación del hash SHA-256</summary>

Descargan la release de GitHub, verifican el hash y no desactivan ninguna protección del sistema.

```sh
# Mac con chip Apple
curl -fsSL https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.sh | sh
```

```powershell
# Windows 10/11 de 64 bits (PowerShell normal, no como administrador)
irm https://raw.githubusercontent.com/onyxcode-cl/onyxcode-desktop/main/scripts/install/install.ps1 | iex
```

</details>

No hay que instalar nada más: **el motor viene incluido**. La clave de OpenCode Go (o la de otro proveedor) se pega en el asistente de primer uso o en Ajustes › Modelos.

## El motor

Lazunox Motor parte de OpenCode 1.19.0 (licencia MIT, con el aviso de copyright conservado) y desde ahí es **nuestro**: no se sigue a OpenCode y los arreglos de seguridad de terceros se portan a mano. La app descarga su binario fijado en `resources/opencode-bin/pin.json` y verifica tamaño y SHA-256 antes de usarlo. Lo que añade sobre la base:

- ayudantes en segundo plano que se esperan y se reanudan, y shell en segundo plano con topes;
- Code Mode con pausa y límites seguros por defecto;
- rutas protegidas, permisos «siempre» persistentes por carpeta y ganchos de usuario por comando;
- rebobinar por turno (incluye lo que cambió un comando), compactación que conserva el plan y las habilidades, objetivo y presupuesto;
- **cero conexiones a servicios de OpenCode**, con una prueba que lo vigila.

Varias funciones están apagadas por defecto hasta que se demuestren con el banco de pruebas: **no prometemos ahorro de tokens sin una medición** (ver el CHANGELOG de la 1.7.7 y de la 1.7.8). La comparación con Claude Code, Codex y OpenCode 2.x, y lo que falta para igualarlos, está en [`docs/PLAN-MOTOR-OLA7.md`](./docs/PLAN-MOTOR-OLA7.md). Cómo se empaqueta y se actualiza: [`docs/DISTRIBUCION.md`](./docs/DISTRIBUCION.md) y [`docs/MANTENIMIENTO-MOTOR.md`](./docs/MANTENIMIENTO-MOTOR.md). Los avisos de licencia de lo que incluimos: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

Si prefieres tu propio CLI de OpenCode, puedes elegirlo («Usar mi CLI…» en el asistente o en Ajustes); la app te avisa si no es la versión probada. Aun así usa su propio almacén de claves y de sesiones. Con `OPENCODE_BIN=/ruta/al/binario` se fuerza uno concreto.

## Seguridad y privacidad

- **Tus claves y tus conversaciones se quedan en tu equipo.** No hay cuentas ni servidor propio. Solo hay conexión con tu proveedor de IA, con una consulta diaria a la API pública de GitHub para el aviso de versión (se apaga en Ajustes › Acerca de) y, solo si activas «También fuera de casa», con el servicio que conecta el celular (ve metadatos de la conexión, no el contenido).
- **Credenciales.** En Tareas con aislamiento solo se usa OpenCode Go: la clave real queda en un proxy fuera del aislamiento y el motor recibe un valor falso. En Chat, Code y Control total **no hay aislamiento de credenciales**: el motor lee el almacén propio de la app (`auth.json`, en la carpeta de datos de Lazunox). La app no lee `~/.local/share/opencode`.
- **Zonas intocables.** El aislamiento, el proxy de credenciales, la política de carpetas, la puerta del plan y la CSP las vigila una prueba por huella. Detalle y límites: [`docs/SEGURIDAD.md`](./docs/SEGURIDAD.md). Borrador de política de privacidad: [`docs/PRIVACIDAD-BORRADOR.md`](./docs/PRIVACIDAD-BORRADOR.md).
- **Control remoto.** Denegar por defecto, confirmación en el Mac, PIN por dispositivo y auditoría sin secretos. En Windows está encendido, pero emparejar un celular real y el modo fuera de casa **no se han probado**.

## Lo que todavía no está

Dicho sin adornos (el detalle y las pruebas hechas están en [`docs/VERIFICACION.md`](./docs/VERIFICACION.md)):

- Sin firma de Developer ID ni notarización en Mac, y sin firma de código en Windows: aparecen avisos del sistema.
- Tareas en Windows (WSL2) y Control del PC en Windows: **verificación parcial** en un equipo real; falta la batería completa, un Windows limpio sin WSL y una auditoría externa.
- La actualización de punta a punta desde GitHub Releases no se ha probado en Mac y Windows de forma completa.
- La licencia de Lazunox está pendiente de definir, y la política de privacidad no está publicada. La marca «Lazunox» no está verificada (INAPI, OMPI/USPTO, dominios): no se publica hasta que el dueño la verifique.
- El inglés está en beta.

## Términos de OpenCode y buenas prácticas

Lazunox es solo un cliente: los servicios (OpenCode, OpenCode Go y los modelos) son de OpenCode y de sus proveedores, y **cada persona es responsable de usarlos conforme a sus [términos](https://opencode.ai/legal/terms-of-service)** y su [política de privacidad](https://opencode.ai/legal/privacy-policy) (OpenCode Go no tiene términos propios: aplican los generales). Resumen, no asesoría legal:

- **Uso propio**, no en nombre ni en beneficio de terceros.
- **Procesos sin sesión iniciada:** los términos los restringen. Las **Rutinas** se ejecutan solas, así que la app pide un aviso explícito antes de activarlas.
- **Extracción programática de datos:** úsalo de forma interactiva y razonable.
- **Suspensión:** OpenCode puede suspender el acceso por cualquier motivo.
- **Modelos gratuitos:** el contenido enviado puede usarse para mejorar sus servicios. No envíes información sensible.

Buenas prácticas: no compartas tu cuenta ni tu clave ni rotes cuentas para saltarte límites; no exportes respuestas para entrenar otros modelos ni las presentes como escritas por una persona; no metas secretos en los prompts ni en las carpetas que abras en Tareas; y revisa lo que hacen los agentes, porque pueden ejecutar comandos y modificar archivos. Lazunox desactiva la función de compartir sesiones de OpenCode (`share: "disabled"`).

## Desarrollo

Necesitas Node.js 22 (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`). **Lee antes [`AGENTS.md`](./AGENTS.md)**: estructura, reglas de verificación, IPC, i18n, zonas intocables y reglas operativas.

```bash
npm install
npm run dev        # app en modo desarrollo
npm run typecheck  # tipos estrictos (main, preload, renderer, PWA)
npm test           # pruebas unitarias (Vitest)
npm run verify     # tipos, pruebas, lint, formato, build, smoke y E2E
npm run package    # DMG de Mac arm64 en dist/   (package:win para Windows)
```

Si `npm run dev` falla con `Electron uninstall`: `node node_modules/electron/install.js`. Variables útiles: `OPENCODE_SIDECAR_LOG=1` (muestra la salida del motor) y `OPENCODE_BIN`.

Cómo se conecta todo: el proceso principal lanza el motor en `127.0.0.1` con usuario y clave aleatorios (HTTP Basic), lo reinicia si cae y lo mata al cerrar; el renderer recibe la conexión por IPC y usa el SDK con un único flujo de eventos (SSE). La configuración de la app se inyecta al motor por `OPENCODE_CONFIG_CONTENT`. En el código, el modo Tareas se llama `tasks` y los textos visibles viven en `src/shared/labels.ts` y `src/shared/i18n`.

```
src/
  shared/    brand · contratos IPC tipados · i18n · protocolo del celular
  main/      motor (sidecar) · ipc · tasks (aislamiento, proxies) · scheduler · computer · remote · update · security · …
  preload/   window.api tipado (+ preloads secundarios autocontenidos)
  renderer/  app · features/{chat,code,tasks,routines,settings,browser} · ventanas secundarias
pwa/ e2e/ scripts/ resources/ docs/
```

Para agregar un modo (`ModeDefinition` en `features/<modo>/index.ts` y una línea en `app/modes.ts`) o un canal IPC (contrato, esquema estricto, handler, preload y clase en la política remota), sigue [`AGENTS.md`](./AGENTS.md) §5.

> **Identidad única Lazunox.** El nombre visible y el técnico son el mismo (`src/shared/brand.ts`; `APP_ID` `cl.bentec.lazunox`). Es una instalación nueva: permisos de macOS y vinculación de celulares se hacen desde cero. No se cambia sin un plan de migración, y las excepciones con el nombre anterior están en `src/test/legacy-name-allowlist.ts`.

## Licencia, marcas y agradecimientos

Licencia: pendiente de definir. Piezas incluidas con licencia propia: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md); en particular PyMuPDF (AGPL-3.0, traducción de PDF), por lo que el código fuente completo de cada versión distribuida es público.

OpenCode y OpenCode Go pertenecen a sus autores. Anthropic y Claude son marcas de Anthropic, PBC. Este proyecto no tiene afiliación con ellos ni cuenta con su respaldo.
