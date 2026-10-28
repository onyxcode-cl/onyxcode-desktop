# Inventario de funciones de Codex (OpenAI) a 17-oct-2026

Alcance: investigación web con tiempo limitado (no 40 min completos). Fuentes oficiales: documentación y changelog, hoy en **learn.chatgpt.com/docs** (developers.openai.com/codex/* redirige allí con 308). Marca de confianza: **O** = oficial, **T** = terceros (no oficial), **NC** = no confirmado.
Notas de contexto importantes:

- Desde jul-2026 Codex está **fusionado en la app de escritorio de ChatGPT** (Mac y Windows, todos los planes incl. Free) y comparte uso con «ChatGPT Work».
- No pude abrir GitHub openai/codex releases ni Reddit/HN directamente (la búsqueda no los devolvió). Las reacciones de la gente salen de blogs, foros de OpenAI, issues de GitHub y X: todas **no oficiales**.
- Los nombres de modelos (GPT-6 Astra/Sol/Luna, GPT-6.1 Sol, dots, Daybreak) vienen del changelog oficial; los detalles de DevDay vienen de blogs de terceros que a veces discrepan entre sí.

Fuente oficial base (changelog): https://learn.chatgpt.com/docs/changelog · «What's new»: https://learn.chatgpt.com/docs/whats-new · Precios: https://learn.chatgpt.com/docs/pricing

## 1. Planes y límites (O)

| Plan             | Precio                                | Notas                                                                           |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Free             | 0                                     | Codex en app de escritorio con GPT-6 Luna, velocidad estándar, según despliegue |
| Go               | 8 USD/mes                             | Uso ligero                                                                      |
| Plus             | 20 USD/mes                            | Añade web, CLI, IDE, iOS e integraciones cloud (revisión automática, Slack)     |
| Pro              | desde 100 USD; niveles 100/200/500    | Sin límite de 5 h actualmente; solo el de 500 trae Ultrafast                    |
| Business         | 20 USD/usuario/mes anual (25 mensual) |                                                                                 |
| Enterprise / Edu | por contacto                          | SCIM, auditoría, residencia de datos                                            |
| API key          | tarifa API                            | CLI, SDK, IDE; **sin** funciones cloud (revisión de GitHub, Slack)              |

Límites: dependen de modelo y tamaño; Plus ~ mensajes locales por 5 h: GPT-6 Astra 5–45, GPT-6.1 Sol 15–160, GPT-6 Sol 15–150, GPT-6 Luna 350–3000; pueden aplicar límites semanales. Fast = 2,5x uso incluido; Ultrafast = 8x. Créditos para exceder el límite. Voz de escritorio 0,05 USD/min. Fuente: pricing (O).
Reacción: **queja** fuerte, ver sección 2 (hilo «Confused about Codex limit usage after GPT-5.6 release (Plus plan)», https://community.openai.com/t/confused-about-codex-limit-usage-after-gpt-5-6-release-plus-plan/1388758, T).

## 2. Inventario de funciones

Formato: **Función** — qué hace · plataformas · plan · fecha · fuente · confianza · reacción.

### 2.1 App de escritorio

1. **App de Codex (lanzamiento Mac)** — chats paralelos, revisión Git, worktrees, skills, tareas programadas, dictado · macOS · cuenta ChatGPT · 2-6 feb 2026 · whats-new · O. Reacción: elogio por el diseño «todo en una app» y por la dirección del chat (steering); queja por acumulación de hilos y por revisar diffs en el panel lateral — https://thecartine.substack.com/p/codex-app-doesnt-suck (blog, no oficial, 18-feb-2026).
2. **App en Windows con sandbox nativo en PowerShell** · Windows · 2-6 mar 2026 · whats-new · O. Reacción: elogio por no necesitar WSL (TechRadar, T: https://www.techradar.com/pro/openai-releases-a-windows-version-of-codex-coding-app); queja: errores del sandbox de Windows muy comentados (issue #30009, 331 comentarios, https://upd.dev/openai/codex/issues/30009, espejo de GitHub, T).
3. **Codex fusionado en la app de ChatGPT** — Chat y Work/Codex juntos, con Proyectos · Mac y Windows · todos los planes · 6-10 jul 2026 y 13-17 jul · whats-new · O. Reacción: NC.
4. **App de ChatGPT para Linux (preview)** · Ubuntu/Debian/Fedora x64 y ARM64 · 10-14 ago 2026 · O. Reacción: NC.
5. **Chats independientes, chats con tareas programadas, bifurcar chats (fork)** · app · mar-abr 2026 · O.
6. **Ventana flotante siempre visible** · app · feb 2026 · O.
7. **Handoff Local ↔ Worktree** · app · mar 2026 · O (ver 2.3).
8. **Proyectos multicarpeta locales** · app · 20-24 jul 2026 · O.
9. **Búsqueda de tareas (task search)** · app · mar 2026 · O.
10. **Lee la salida de la terminal integrada** · app · 9-13 mar 2026 · O.
11. **Edición directa de Markdown/código con anotaciones en línea** · app · jul 2026 · O (vía changelog resumido por buscador; confianza media).
12. **Vista de actividad, refinado de imágenes (vistas Focused y Canvas)** · app · 27-31 jul 2026 · O.
13. **Hilos fijados unificados (escritorio e iOS)** · 17-21 ago 2026 · O.
14. **Instantáneas compartidas de hilos** · macOS · ago 2026 · O.
15. **Dictado con limpieza y diccionario propio** · app · may 2026 · O.
16. **Predicciones en el compositor (beta)** — sugiere el siguiente prompt, se acepta con Tab · app · solo Pro personal elegible · 9 oct 2026 · changelog · O. Nota: el CLI 0.159.0 quitó las sugerencias de seguimiento (sept).
17. **Importar desde Claude Code, Claude Cowork y Cursor** (y `/import` en CLI) · app/CLI · 10-14 ago 2026 · O. Dato relevante para la competencia.
18. **Mascota/Pets con chat rápido; Appshots** (envía el contexto de la ventana de otra app a Codex) · Appshots Mac may 2026, Windows sept 2026; Pets sept 2026 · O. Reacción: NC.
19. **Hardware «Codex Micro» (edición limitada)** · jul 2026 · O. Reacción: NC.
20. **Voz (GPT-Live) en la app de escritorio** · Plus, Pro, Business, Edu, Enterprise · 20-24 jul 2026 · O.
21. **«Dots»** — agentes persistentes a los que se delega trabajo continuo; creación desde la app móvil; despliegue gradual · oct 2026 · whats-new · O (detalle: T; algunos blogs dicen que usan GPT-6 Astra, NC).

### 2.2 CLI

22. **Codex CLI (actual 0.163.0, 15-oct-2026)** — panel `/config` buscable, dirección de la respuesta a mitad de generación, tecla líder configurable en `/keymap`, `/daemon`, herramientas de lectura en paralelo · multiplataforma · todos los planes y API key · O (changelog).
23. **0.162.0 (8-oct)** — herramientas de worktree Git gestionado, tareas fijadas en «Command Center», copiar transcripción, URLs clicables, instalador PowerShell firmado · O.
24. **0.159.0 (29-sep)** — steering opcional, pantalla de bienvenida nueva, plan desplazable, Mermaid · O.
25. **0.158.0** — copiar al seleccionar, pegar con clic derecho en TUI, OAuth MCP preregistrado, imágenes con fondo transparente · O.
26. **0.147.0** — bandera `--approve-for-me` · ago 2026 · O.
27. **0.146.0** — app server para clientes propios · jul 2026 · O.
28. **Codex SDK / Security CLI+TypeScript SDK (0.1.5)** · jul 2026 · O.
29. **Modo Goal (ya fuera de experimental)** · app, IDE, CLI · 18-22 may 2026 · O.
30. **Hooks (disponibilidad general)** · may 2026 · O. Reacción: NC.
31. **Slash `/review`** — revisa cambios locales sin tocar el árbol de trabajo (rama base, sin confirmar, commit, instrucciones) · app/CLI/IDE · https://learn.chatgpt.com/docs/code-review · O.
    Reacción general CLI: queja por modelos «más ansiosos», elogio por rapidez (comentarista de HN citado en https://www.eesel.ai/blog/gpt-6-sol-review, T).

### 2.3 Worktrees y agentes en paralelo

32. **Worktrees gestionados y permanentes** — varios chats en el mismo repo a la vez; HEAD desacoplado, handoff Local↔Worktree; conserva por defecto los 15 más recientes con instantánea antes de borrar; `.worktreeinclude` para copiar archivos ignorados como `.env` · app (y control desde móvil) · requiere repo Git · https://learn.chatgpt.com/docs/environments/git-worktrees · O. Reacción: elogio genérico del flujo paralelo (tutorial implicator.ai, T); queja: acumulación de worktrees si se programan tareas frecuentes (doc oficial lo advierte).
33. **Chats paralelos / subagentes / `/agents`** — vista para seguir trabajo delegado (DevDay) · CLI · NC fino (solo blogs: https://www.infoq.com/news/2026/10/openai-devday-2026/, T).

### 2.4 Automatizaciones (tareas programadas)

34. **Tareas programadas** — repiten trabajo por horario (RRULE) en proyecto local o worktree; independientes o dentro de un chat · app (necesita equipo encendido), web y móvil · GA 9-13 mar 2026 · https://learn.chatgpt.com/docs/automations · O.
35. **Disparadores por evento** — Gmail, Slack, PRs de GitHub (no combinables con horario) · web y móvil, planes elegibles · 24-28 ago 2026 · O.
    Reacción: crítica del blogger de la nota 1 («no entiendo para quién son») — T; sin más datos.

### 2.5 Skills, plugins, AGENTS.md, MCP

36. **Skills** — instrucciones reutilizables; se aplican solas o por mención (`$` en Codex, `@` en ChatGPT); `$skill-creator` · https://learn.chatgpt.com/docs/skills-and-plugins · O. Ámbitos repo/usuario/admin/sistema: solo guías de terceros (T).
37. **Plugins** — paquetes de skills + conectores + servidores MCP + hooks; directorio universal compartido por ChatGPT y Codex · 23-27 mar 2026 · O. Plugins compartidos por espacio (Business, may 2026); exportación CSV de metadatos (Enterprise, ago 2026) · O.
38. **AGENTS.md** — cadena global (`~/.codex`, con `AGENTS.override.md`) y por proyecto de la raíz al directorio actual; concatena de raíz a cwd; tope 32 KiB (`project_doc_max_bytes`) · https://learn.chatgpt.com/docs/agent-configuration/agents-md · O.
39. **MCP** — servidores por stdio/HTTP, OAuth preregistrado (0.158.0), eventos MCP (requieren MCP 2.0 y webhooks, DevDay) · doc en /codex/extend/mcp (no abierta; confianza media) · O parcial.
40. **Site tools (WebMCP)** en navegador integrado; no en Enterprise/Edu · ago 2026 · O.

### 2.6 Memorias y Chronicle

41. **Memorias de Codex** — resúmenes locales en `~/.codex/memories/`; **desactivadas por defecto**; se activan en Ajustes > Personalización · https://learn.chatgpt.com/docs/customization/memories?surface=app · O. En EEA/Reino Unido/Suiza, apagadas por defecto y desplegadas el 16-jun-2026 (T: pasqualepillitteri.it).
42. **Chronicle** — memoria consciente de la pantalla (vista previa de investigación, opt-in) · macOS · Pro · lanzada 20-abr-2026 · O/T. Riesgos que dicen los docs: consume límite rápido, más riesgo de inyección de prompts, almacenamiento sin cifrar (T citando la página oficial). Conflicto de fuentes sobre Europa (ver sección 6).
43. **Historial del equipo / Computer History** — macOS; Pro, Business, Enterprise; en Europa (EEA, Suiza, RU) con activación por admin desde 17-21 ago · whats-new · O.
    Reacción: el análisis de kingy.ai (T) lo describe como intento de acabar con el reinicio de contexto; riesgo de privacidad es la objeción principal.

### 2.7 Computer use, Record & Replay, navegador

44. **Computer Use** — ve y maneja apps gráficas · macOS (abr 2026) y Windows (25-29 may 2026, en primer plano, toma puntero y teclado) · «regiones soportadas» · https://learn.chatgpt.com/docs/computer-use · O. Aprobaciones por app, «Always allow», no automatiza terminales ni ChatGPT, no aprueba avisos de admin. «Locked use» (desbloquea el Mac brevemente, vía Remote) · O. Reacción: elogio genérico; queja: issue #29051 «Record & Replay visible pero no habilitado» (https://github.com/openai/codex/issues/29051, T).
45. **Record & Replay** — se le muestra un flujo una vez y lo convierte en skill reutilizable · macOS, requiere Computer Use · 15-19 jun 2026 (artículos: 18-20 jun) · excluye EEA, RU, Suiza · https://the-decoder.com/openais-codex-can-now-watch-you-work-once-and-repeat-the-task-forever/ · O (whats-new) + T. Reacción: elogio del concepto; queja: solo Mac, solo corre en Codex, privacidad, fiabilidad en flujos largos (kingy.ai / digitalapplied, T).
46. **Navegador integrado** — vista previa, comentarios visuales, Codex puede operar localhost y páginas de archivo; perfil aparte; no está en CLI ni IDE · escritorio · abr 2026 · https://learn.chatgpt.com/docs/browser · O.
47. **Modo Desarrollador con acceso CDP completo** (navegador integrado y Chrome) · 8-12 jun 2026 · O.
48. **Extensión de Chrome** — trabaja en pestañas y perfil reales (`@Chrome`); también Edge, Brave, Opera, Vivaldi; trabajo en pestañas en paralelo · may-ago 2026 · O.
49. **Historial de navegación y contexto de pestañas abiertas; anotaciones de sitios web** · jul-sept 2026 · O.
50. **Sesión iniciada en el navegador en la nube** (Work) · web, iOS, Android; Plus y Pro; no Enterprise/Edu · ago 2026 · O.
51. **Revisión automática de aprobaciones por agente («auto-review»)** · app/CLI · abr 2026 · O. Reacción: Dan Shipper se quejó de que el clasificador de seguridad pausa trabajo ya autorizado (https://x.com/danshipper/status/2102461471716483208, T).

### 2.8 Revisión de PRs

52. **Plugin de Code Review en la app** — bandeja de PRs, archivos vistos, PRs apilados, acción Fix para checks fallidos, enviar revisión (Comentar/Aprobar/Pedir cambios) · GitHub GA, GitLab MR en preview · abr 2026 · https://learn.chatgpt.com/docs/code-review · O.
53. **Revisión automática de PRs en GitHub (conector ChatGPT Codex)** — sin entorno cloud · planes Plus+ (API key no) · O.
54. **Revisión multi-repositorio** · app · jul 2026 · O.
55. **GitLab en Codex cloud (beta)** · todos los planes de ChatGPT · ago 2026 · O.
56. **Codex Security Review para PRs de GitHub (preview)** · Enterprise, Business, Edu, Pro; no Plus · 3-7 ago 2026 · O. Plugins Codex Security y «Security Cloud» (preview, DevDay) · O. Daybreak (defensores aprobados, niveles Blue/Red; requiere Trusted Access for Cyber), activado por defecto para cuentas elegibles en CLI 0.163.0 · O.

### 2.9 Web / Cloud

57. **Codex Cloud** — tareas en entornos remotos mientras el equipo duerme; ajustes de red (dominios permitidos, secretos), integraciones GitHub, GitLab beta, Slack, inicio desde CLI · https://learn.chatgpt.com/docs/cloud · O. Planes: Plus en adelante (pricing).
58. **Entornos cloud reutilizables** · sept-oct 2026 (DevDay) · O.
59. **Sign in with ChatGPT (beta)** — Airtable, GitLab, HubSpot, Notion, Supabase, Vercel · 27-31 jul 2026 · O.

### 2.10 Móvil / integración con ChatGPT

60. **Remote en la app móvil de ChatGPT** — controla Codex de un Mac o PC Windows (o nube); el equipo debe estar despierto y conectado · iOS (Windows desde 25-29 may) · 11-15 may 2026 · https://learn.chatgpt.com/docs/mobile · O. Planes: «según despliegue y espacio». Android: no confirmado para Remote (los textos citan solo iOS).
61. **Visualizaciones de tareas Codex en iOS, abrir desde Spotlight/Shortcuts/widgets, chat de Codex desde iOS** · may-oct 2026 · O.
62. **ChatGPT Work + tareas programadas + continuidad entre dispositivos** · jul-sept 2026 · O.
63. **Codex en Amazon Bedrock; GPT-5.6 vía Bedrock** · jun-jul 2026 · O.
64. **Extensión de IDE** — VS Code, Cursor, Windsurf, VS Code Insiders; Xcode y JetBrains con integraciones propias; contexto del editor, revisión en línea, delegación a Codex web · https://learn.chatgpt.com/docs/ide · O.
65. **Sandbox y aprobaciones** — `read-only`, `workspace-write`, `danger-full-access`; políticas `on-request` y `never` (`untrusted` ya no existe); Seatbelt en macOS, sandbox nativo en Windows, bubblewrap en Linux/WSL2; reglas por prefijo de comando; raíces escribibles · https://learn.chatgpt.com/docs/sandboxing · O.
66. **Modelos**: GPT-5.3-Codex-Spark (feb), GPT-5.4 (mar), GPT-5.5 (abr; retirado en Codex con login ChatGPT el 14-oct-2026), GPT-5.6 (jul), GPT-6 Astra (ago-sept), GPT-6 Sol/Luna (21-25 sept), GPT-6.1 Sol (29-sept, por defecto en CLI), Ultrafast para Pro 500 (8-oct) · changelog · O. Reacción: elogio de Sol como «daily driver» más barato (X de Dan Shipper); coste/valor discutido (eesel, note.com, T).

Total: **66 entradas de función** (algunas agrupan versiones de CLI).

## 3. Las 10 funciones más elogiadas (no oficial; inferencia con fuentes escasas)

1. Steering a mitad de tarea — favorito del blog Cartine (feb) y llegó también al CLI (0.159/0.163).
2. App multihilo/paralela con worktrees — el flujo central de las reseñas.
3. Sandbox nativo de Windows sin WSL (TechRadar).
4. GPT-6 Sol como modelo diario: rápido y barato (Shipper, eesel).
5. Record & Replay — concepto muy cubierto por blogs.
6. Computer Use en Mac y Windows.
7. Revisión de código/PR integrada en la app.
8. Tareas programadas en worktrees.
9. Navegador integrado con comentarios visuales.
10. Skills/plugins compartidos entre ChatGPT y Codex.
    Confianza baja: no encontré encuestas ni hilos de Reddit/HN, solo blogs y X.

## 4. Las 10 quejas más repetidas

1. Límites de uso se agotan rápido (foros OpenAI: https://community.openai.com/t/codex-users-report-rapid-quota-drains-since-may-10/1380649 ; https://community.openai.com/t/codex-limits-spark-frustration-among-subscribers/1390408).
2. Cambios de límites tras cada modelo nuevo (hilo GPT-5.6 Plus).
3. Errores del sandbox de Windows (issues #30009, #9062, #29622).
4. Quemado de tokens en GitHub (issue #14593).
5. Clasificador de seguridad que interrumpe trabajo autorizado (Shipper).
6. Disponibilidad parcial por región o por cuenta (issue #29051).
7. Modelos demasiado «ansiosos» en ejecución sin supervisión (comentario HN vía eesel).
8. Acumulación de hilos y mala revisión de diffs en el panel (Cartine).
9. Privacidad de Chronicle y Record & Replay (grabación de pantalla).
10. Record & Replay solo en Mac y solo reutilizable dentro de Codex.

## 5. Tendencias de 2026

- Pasó de herramienta de código a **agente general**: computer use, navegador, Work, dots, sitios.
- Fusión de Codex en la app de ChatGPT (jul).
- Control remoto y móvil (Remote iOS, Windows, bloqueo).
- Seguridad como producto (Codex Security, Daybreak, Agent Security).
- Ejecución en la nube reutilizable y agentes siempre activos.
- Modelos escalonados con modos de velocidad pagados (Fast/Ultrafast) y facturación por créditos.
- Interoperabilidad con competidores: importar desde Claude Code y Cursor.
- Revisión automática de aprobaciones por agente en lugar de pedir permiso humano.
- Despliegue escalonado por región: Europa llega semanas después.

## 6. Restricciones geográficas (lo confirmado)

| Función                                                                                     | Restricción                                                                                                                         | Fuente                                         |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Record & Replay                                                                             | Excluye EEA, Reino Unido, Suiza                                                                                                     | whats-new (O); the-decoder (T)                 |
| Computer History                                                                            | Inicial: Pro/Business/Enterprise sin UE, Suiza, RU; luego habilitado para ellos con admin (17-21 ago)                               | whats-new (O)                                  |
| Computer Use, extensión Chrome, memorias, Chronicle                                         | Desplegados en EEA/RU/Suiza el 16-jun-2026; memorias apagadas por defecto allí                                                      | whats-new (O); pasqualepillitteri.it (T)       |
| Chronicle                                                                                   | Conflicto: la página oficial aún lo declara no disponible en UE/RU/Suiza; el anuncio de junio dice lo contrario → **no confirmado** | developers.openai.com/codex/memories/chronicle |
| Computer Use                                                                                | «Limitado a regiones soportadas» sin lista de países → **no confirmado**                                                            | docs computer-use                              |
| Ultrafast                                                                                   | Opciones de residencia de datos en EE. UU. y Europa                                                                                 | changelog 8-oct (O)                            |
| Navegador en la nube (Work)                                                                 | Todas las regiones en planes de pago, no Free/Go                                                                                    | docs browser (O)                               |
| Remote móvil, memorias locales, Codex Cloud, worktrees                                      | Las páginas no mencionan restricciones regionales                                                                                   | docs (O); **no confirmado**                    |
| Sitio y otros                                                                               | Sin lista de países en las fuentes consultadas                                                                                      | —                                              |
| No encontré una lista oficial por país (p. ej. China, Rusia) en lo consultado; es un hueco. |

## 7. Limitaciones del estudio

- No leí las notas de release de GitHub ni hilos de Reddit/HN; las reacciones son de blogs, foros de OpenAI e issues.
- El changelog tiene 220 000 caracteres; leí octubre-septiembre y el resumen «What's new» (hasta feb-2026), no las entradas intermedias de CLI.
- Resúmenes de WebFetch pasan por un modelo pequeño; verificar cifras de límites antes de decidir.
