# Plan: Ficha del proyecto (acceso por proyecto + variables) en Overdrive y Code

Aprobado por el dueño el 2026-10-29 a partir de las maquetas de `docs/maquetas-ficha/` (`overdrive.html`, `code.html` y sus pantallazos).

## Qué se pidió (y solo eso)

1. **Overdrive**, panel derecho de «Progreso», de arriba abajo: **Ficha del proyecto**, **Plan** (justo debajo), **Contexto**, y lo que ya existe (Resultados = Archivos creados, Cambios, Qué usó el agente, Historial). Las secciones pasan a tarjetas.
2. **Code**: el mismo estilo. Un icono nuevo al principio de las pestañas del panel derecho muestra las tarjetas Ficha del proyecto, Plan, Contexto, Cambios e Historial. Git, Terminal, Archivos y Navegador quedan como están.
3. **Ficha del proyecto** (tarjeta con engranaje): nombre, carpeta, rama (Code), nivel de acceso con barra de tres tramos y sello de color, y **Bóveda** de variables y claves. El engranaje abre el diálogo «Ficha del proyecto» (nombre, carpetas, los tres niveles como bloques de color, fila «Bóveda de variables» que abre la lista con valores ocultos y «Agregar o pegar formato .env»).
4. **Sello de acceso** (chip de color) junto al selector de permisos de la caja de escribir. En Code, «Entorno» de la cabecera también abre la Ficha.
5. **Tarjeta ámbar** para aprobar `equipo_ejecutar` (ya hecha) y menú lateral por carpetas (ya hecho, opción A estilo Claude).

## Qué NO se toca

- Ninguna **zona intocable** de `AGENTS.md` §7: sandbox, proxies, `provider-egress`, `proxy-policy`, puerta del plan (`opencode-config.ts` y su uso en `manager.ts`), `folder-policy*`, tareas en Windows, CSP, preloads, esquema del visor. La prueba `zonas-intocables.test.ts` debe seguir verde SIN `zonas:actualizar`.
- Control remoto, motor (`lazunox-motor`), instalador, actualizaciones, releases, textos y diseño del resto de la app.
- El **nivel de acceso no cambia reglas de seguridad**: solo decide qué herramientas ya existentes se ofrecen (ver Diseño). Nada se auto-aprueba.

## Diseño

**Almacén por proyecto** (`src/main/project-profile/`, sin Electron en la lógica pura):
`{ folder → { name, access: 'aislado'|'comandos'|'total', vault } }` en `userData/project-profiles.json` (0600). La bóveda guarda nombres en claro y valores cifrados con `safeStorage`; si no hay cifrado disponible, se niega a guardar (nunca texto plano). Los valores **nunca** vuelven al renderer: la lista muestra `••••` y «Agregar/pegar» solo escribe.

**Acceso** (por carpeta, defecto `comandos` = el comportamiento de hoy):
- `aislado`: no se expone la ruta `equipo` al motor de esa carpeta.
- `comandos`: lo de hoy (`equipo_ejecutar` con tarjeta de aprobación, política `host-exec`).
- `total`: además se ofrece el control del equipo (herramienta `computer` existente) con su aprobación de plan actual. Sin atajos de permiso.
Se aplica al lanzar/relanzar el servidor de la carpeta y en `HostExecMcpServer` (`enabled()` por carpeta, además de la política de la organización, que manda siempre).

**Variables**: se inyectan **solo** en los comandos de `equipo_ejecutar` de esa carpeta (`runner.ts`, entorno mínimo + las del proyecto) y, en Code, en el entorno de esa sesión. No van a la sandbox de las tareas (para no tocar `manager.ts`/zonas). La salida de los comandos se **redacta** (valores reemplazados por `«NOMBRE»`) antes de volver a la IA y a los registros; la auditoría no guarda valores.

**IPC** (`projectProfile:get|setAccess|setName|vaultList|vaultSet|vaultDelete`, canales declarados en la lista de canales y de roles; ninguno expuesto al celular: clase X en `remote/policy.ts`).

**UI** (`src/renderer/features/project-profile/`): `ProjectCard`, `ProjectDialog`, `VaultDialog`, `AccessSeal`; i18n es/en. Overdrive: reordenar `ProgressPanel` en tarjetas. Code: pestaña «Resumen» con las mismas tarjetas.

## Pasos

0. **Verificar en el código** (sin cambiar nada): cómo se decide hoy qué MCP recibe cada carpeta, dónde se ofrece `computer`, y de dónde sale el entorno de una sesión de Code.
1. Almacén + cifrado + redacción + IPC + pruebas (incluida la regla «el valor jamás sale»).
2. Acceso por carpeta aplicado a `equipo` y `computer`, con pruebas por nivel.
3. UI de Overdrive (tarjetas, Ficha, diálogo, Bóveda, sello) y orden Plan/Contexto.
4. UI de Code (pestaña Resumen, «Entorno» abre la Ficha, sello).
5. Pruebas en la app real por CDP en Mac y en el PC con Windows, con pantallazos de cada pantalla y de un comando que usa una variable (sin mostrar su valor).
6. Documentación: CHANGELOG, `docs/SEGURIDAD.md` (bóveda y niveles), sin tocar zonas. Rama `feat/menu-carpetas`, sin `push`.

## Criterios de terminado

- Se ve como las maquetas; el resto de la app no cambió (comparación de pantallazos antes/después).
- `npm run typecheck`, lint, pruebas y `zonas-intocables.test.ts` verdes sin registrar cambios de zona.
- Una variable guardada llega a un comando aprobado y **no** aparece en la respuesta, la bitácora ni los diagnósticos.
- Mismo resultado en Windows.

## Preguntas abiertas (se resuelven en el paso 0)

- En Code, ¿las variables van también al terminal integrado? Propuesta: sí, solo a sesiones nuevas del proyecto.
- ¿«Total» pre-aprueba algo? Propuesta: no; solo ofrece la herramienta.
