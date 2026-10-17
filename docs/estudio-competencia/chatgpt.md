# Inventario de funciones de ChatGPT (OpenAI), a 17 de octubre de 2026

## Método y límites (leer primero)
- Las páginas de help.openai.com y chatgpt.com/pricing respondieron **403** a la herramienta de lectura. Por tanto casi nada se pudo leer directo del Help Center. Los datos «oficiales» vienen de: learn.chatgpt.com/docs/changelog (OpenAI, solo se leyó octubre 2026), notas de lanzamiento resumidas por el agregador Releasebot (tercero; copia las notas de OpenAI, fechas pueden diferir), y la nota de prensa del 9-jul-2026 vía 9to5Mac.
- Niveles de confianza: **Oficial** = changelog/docs de OpenAI leídos; **Oficial (vía agregador)** = Releasebot citando las notas de OpenAI; **Terceros** = prensa/blogs/reseñas; **No confirmado** = fuentes contradictorias o una sola fuente dudosa.
- Hay **contradicciones de nombres de modelo** entre fuentes (GPT-5.6 Sol/Terra/Luna en jul-2026; GPT-6 Sol/Luna/Astra desde sep-oct 2026). Las tablas de precios de terceros mezclan ambos. Tratar los modelos como «no confirmado en detalle».
- Muchos blogs de «reseñas» son de afiliados o de proveedores competidores (p. ej. eesel.ai). Marcados como «no oficial».
- No se pudo verificar nada específico de Chile; la sección de países es mayormente «no confirmado».
- Tiempo: sondeo amplio (~12 búsquedas, ~12 lecturas), no exhaustivo. Faltan por verificar en fuente primaria: límites numéricos por plan, canvas, deep research y memoria (no aparecieron en las notas leídas; existen desde 2024-25 pero su estado actual en oct-2026 es **no confirmado**).

Abreviaturas de plataforma: M=Mac, W=Windows, L=Linux, Web, Mov=móvil.

---

## 1. Conversación y modelos

| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Elogio/crítica |
|---|---|---|---|---|---|---|---|---|
| 1 | Modelos GPT-5.6 Sol/Terra/Luna | Tres niveles (potente / equilibrado / rápido y barato); Sol es el tope en código y trabajo de oficina | Todas | Free y Go: Terra/Luna; Plus+ eligen los tres; «max» para todos con acceso | 9-jul-2026 | https://9to5mac.com/2026/07/09/openai-announcing-the-next-chapter-for-chatgpt-today-watch-here/ | Terceros (prensa, cita el anuncio) | Sin dato de opinión |
| 2 | GPT-6 (Sol / Luna / Astra / Pro) con «Intelligent UI» | El chat elige solo el formato: texto, visuales, calculadoras, juegos interactivos | Web/M/W/Mov | Plus, Pro, Business, Enterprise (Sol); Free y Go (Luna); Pro razona con Astra sin Intelligent UI | 7-oct-2026 (Free/Go al día siguiente) | https://releasebot.io/updates/openai/chatgpt | Oficial (vía agregador) | No confirmado |
| 3 | GPT-6 Pro en Chat | Razonamiento máximo, más rápido, mejor uso de herramientas, agentes en paralelo | Web | Pro elegibles | 16-oct-2026 | https://releasebot.io/updates/openai/chatgpt | Oficial (vía agregador) | No confirmado |
| 4 | Modo «ultra» / esfuerzo «max» | Varios agentes coordinados en paralelo en una tarea | Work, Codex | Work: Pro y Enterprise; Codex: Plus+ | 9-jul-2026 | 9to5Mac (arriba) | Terceros | No confirmado |
| 5 | Ultrafast (GPT-6.1 Sol) | Generación de tokens más rápida | Codex y Work | Pro 500; Enterprise/Edu si el admin lo activa | 8-oct-2026 | https://learn.chatgpt.com/docs/changelog | Oficial | No confirmado |
| 6 | Retiro del cambio automático Instant→Thinking | Se quitó para Plus/Pro (queda el cambio por seguridad) | Web | Plus, Pro | 14-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 7 | Banco de preguntas/flashcards interactivas | Tarjetas de estudio interactivas | Web, Mov | Todos | 22-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 8 | Salud (pestaña Health) | Explica gráficos, métricas y registros de salud conectados | Web/Mov | No confirmado el plan | 28-sep-2026 (explicaciones) | Releasebot | Oficial (vía agregador) | No confirmado |
| 9 | Finanzas (seguimiento de crédito Experian/VantageScore) | Seguimiento financiero; el crédito solo EE. UU. | Web, iOS, Android | Free/Go (EE. UU.) desde 2-oct; crédito en Plus/Pro EE. UU. | 21-sep y 2-oct-2026 | Releasebot | Oficial (vía agregador) | No confirmado; solo EE. UU. |

## 2. Trabajo con archivos y documentos

| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 10 | ChatGPT Slides | Crear, editar, presentar y co-editar presentaciones; exporta a PowerPoint, PDF o Google Slides | Web | Pro elegibles al inicio | 16-oct-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 11 | Space (reemplaza a Library) | Espacio compartido con Pages, hojas, presentaciones, Sites, imágenes y archivos, agrupado por tema o equipo | Web y escritorio primero, móvil después | Pro, Business, Enterprise (inicio 1-oct) | 29-sep-2026 | https://kodemagisk.no/en/blog/chatgpt-dots-space-pages-ai-agents-norway/ y Releasebot | Terceros + agregador; partes («mantener actualizado») no activas aún | Crítica (no oficial): ¿quién revisa lo que escriben los agentes? https://busabase.com/blog/chatgpt-space-dots-agent-writes |
| 12 | Pages | Documentos editables co-escritos con el agente | Web/escritorio | Los de Space | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 13 | Sites | Sitios web/herramientas creados con ChatGPT, publicables y programables; se quitó el tope de creación en Plus/Pro (15-oct) | Web, escritorio | Todos los de pago (anuncio jul); límites de uso y almacenamiento | jul-2026; 15-oct | 9to5Mac; Releasebot | Terceros + agregador | No confirmado |
| 14 | Subida de audio | Convierte grabaciones en transcripción, resumen, notas y borradores de seguimiento | Web/apps | Planes de pago | 6-oct-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 15 | Complemento de ChatGPT para Microsoft Word | Usar ChatGPT dentro de Word | Word | Todos, incluido Free | 17-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 16 | Escaneo móvil multipágina a PDF | Une varias páginas en un solo PDF | iOS | No confirmado | 1-oct-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 17 | Subir archivos y límites | Subir documentos/imágenes al chat | Todas | Todos; límites crecientes Free<Go<Plus<Pro | n/d | https://www.ai-toolbox.co/chatgpt-models/chatgpt-pricing | Terceros (no oficial; sin cifras fijas) | **Límites numéricos: no confirmado** |
| 18 | Biblioteca con favoritos y carpetas; prueba virtual de ropa | Organiza lo generado; probador virtual con fotos de referencia | Web/Mov | No confirmado | 1-oct-2026 | Releasebot | Oficial (vía agregador) | No confirmado |

## 3. Automatización y agentes

| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 19 | **ChatGPT Work** (agente) | Toma un objetivo, planifica, usa apps conectadas y entrega documentos, presentaciones y hojas de cálculo; corre en la nube o en local (escritorio); comparte plugins con Codex | Web, Mov, M/W (escritorio) | Free/Go (modelo Terra), Plus+ ; incluido en Business/Enterprise | 9-jul-2026 | https://www.latent.space/p/unpacking-chatgpt-work (análisis externo, no oficial) y 9to5Mac | Terceros | Elogio: sesión de navegador reproducible, perfil con sesiones iniciadas, puedes tomar el control. Crítica: errores lógicos y exceso de confianza (reseña G2 citada por https://www.eesel.ai/blog/chatgpt-work, no oficial); Amazon bloquea el navegador de centro de datos |
| 20 | Voz en Work y Codex | Iniciar tareas y ver progreso por voz; en Work puede crear archivos, usar apps y seguir en texto | Escritorio M/W; web y móvil (Work) | No confirmado | 23-jul y 23-sep-2026 | https://learn.chatgpt.com/docs/changelog (resumen del buscador) y Releasebot | Oficial (vía agregador) | No confirmado |
| 21 | Tareas programadas | Tareas únicas/recurrentes y de monitoreo (avisan solo si algo cambia); página «Programadas» | Web y móvil | Plus, Pro, Business, Enterprise | 17-jun-2026 | https://yellow.com/news/chatgpt-pulse-scheduled-tasks-hub | Terceros | Límites (no oficial): como máximo una vez por hora, tareas en proyectos no ven los archivos del proyecto |
| 22 | Pulse (retirado) | Resumen diario; reemplazado por tareas programadas | Mov | n/d | retirado jun-2026 | yellow.com | Terceros | n/d |
| 23 | Automatizaciones disparadas por eventos de apps | Un evento en una app conectada lanza una automatización | Web/escritorio | No confirmado | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 24 | **Dots** (agentes siempre activos) | Agente con su propia computadora y navegador en la nube, que sigue trabajando entre conversaciones | Web/escritorio | Pro y Business Premium, en mercados elegibles; **Pro excluye EEE, Suiza y Reino Unido** | 29-sep-2026 (despliegue gradual) | https://betanews.com/article/openai-dots-agents-chatgpt/ ; https://www.tryagentsonic.com/articles/openai-dots-uk-eu-availability | Terceros | No confirmado |
| 25 | Investigación profunda (Deep Research) | Informes largos con fuentes | Web/apps | Free limitado; Plus+ más; Pro máximo | n/d | ai-toolbox (arriba) | Terceros; estado actual **no confirmado** | n/d |
| 26 | Modo agente anterior («ChatGPT Agent») | Predecesor de Work | Web | de pago | 2025 | https://cybernews.com/ai-tools/chatgpt-agent-review/ | Terceros | Crítica: lento (una tarea de unos 30 min); elogio: puntos de aprobación antes de comprar (no oficial, reseñas 2025) |

## 4. Control del computador y navegador

| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 27 | Computer Use en Codex | Ve, hace clic y escribe en apps de escritorio | M (antes), **W desde 29-may-2026** | Sesión con cuenta ChatGPT | 29-may-2026 | learn.chatgpt.com (vía buscador) | Oficial (resumen) | No confirmado |
| 28 | Navegador integrado en la app de escritorio | Work y Codex usan herramientas que los sitios ofrecen (31-ago); inspector de red | M/W | No confirmado | 31-ago-2026 | changelog (resumen) | Oficial (resumen) | Elogio: el navegador con inspector de red es útil (HN, https://news.ycombinator.com/item?id=49281916) |
| 29 | **Atlas (navegador)** | Navegador con ChatGPT; **descontinuado: sus funciones pasaron a la app de escritorio**. Fecha de cierre 9-ago-2026 según un directorio | M | n/d | cierre ago-2026 | https://windowsforum.com/windows-news.4/chatgpt-atlas-shuts-down-august-9-2026-migration-guide.437530/ | Terceros, **no confirmado en fuente OpenAI**. Windows nunca llegó | n/d |
| 30 | Reuniones (plugin Meetings) | Toma notas de reuniones | M (escritorio), beta | No confirmado | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |

## 5. Memoria y contexto
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 31 | Memoria (guardada + historial) | Recuerda preferencias; Go tiene más memoria que Free; Pro «memoria máxima» | Todas | Todos, con cupos | n/d | ai-toolbox | Terceros; detalle **no confirmado** (help.openai.com dio 403) | Crítica: en voz con GPT-Live OpenAI reconoció fallos de memoria (TechRadar, https://www.techradar.com/ai-platforms-assistants/chatgpt/got-chatgpts-new-voice-mode-heres-how-to-check-and-5-things-you-should-try-first); un usuario de HN dice que la memoria solo contaminaba el contexto |
| 32 | Proyectos | Agrupa chats y archivos; fijar chats y proyectos en la barra | Todas | Plus+ (Free limitado: no confirmado) | n/d | help.openai.com release notes (vía buscador) | Terceros | Elogio: ayudan a mantener el foco (HN, usuario nsonha) |
| 33 | Contexto de Work (memoria de perfil, Personal Context) | Contexto entre hilos viene de la capa de producto, no del computador | Work | Los de Work | jul-2026 | latent.space | Terceros | Crítica: el agente no puede editar su perfil de memoria ni guardar memoria persistente |
| 34 | Ventana de contexto por plan | Free 27K; Go/Plus 54K instant, 256K razonamiento; Pro 128K/400K | Todas | ver | oct-2026 | ai-toolbox | Terceros, **no confirmado** | n/d |

## 6. Integraciones y ecosistema
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 35 | Plugins / apps conectadas | Apps vía MCP, skills y plantillas; multicuenta; paneles interactivos | Todas | Según plan | 17-sep y 29-sep-2026 | Releasebot | Oficial (vía agregador) | Crítica: Work ignora plugins instalados que no usa y descubrir nuevos es débil (latent.space) |
| 36 | GPTs personalizados → plugins | **Los GPTs personalizados se retiran el 11-dic-2026** (11-feb-2027 en Enterprise con prórroga); instrucciones pasan a skill; las acciones personalizadas **no migran** | Web | creadores/admins | anuncio 11-sep-2026 | https://visualstudiomagazine.com/articles/2026/09/28/openai-replacing-custom-gpts-with-plugins-including-for-codex-in-vs-code.aspx | Terceros (fechas varían entre fuentes) | Crítica implícita: obliga a reconstruir acciones (no oficial) |
| 37 | Iniciar sesión con ChatGPT / apps usan tu cupo | Otras apps usan tu asignación de ChatGPT | Dev | Plus/Pro, vista previa | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 38 | Anuncios | Aparecen en Free y Go (según fuentes); no en Plus+ | Web/Mov | Free, Go | 2026 | https://cittago.com/blog/chatgpt-ads-europe-2026/ | Terceros | No confirmado, ver país |

## 7. Colaboración
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 39 | Chats grupales (**retirados**) | Se cierran desde 9-jul-2026; vuelven solo como solo lectura; pestaña de mensajes tipo DM | Web/Mov | n/d | jul-2026 | https://help.openai.com/en/articles/12703475-retiring-group-chats-in-chatgpt | Oficial (por título/resumen del buscador; no leído) | n/d |
| 40 | Perfiles compartibles | Compartir perfil | Web | No confirmado | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 41 | Co-edición en Space/Slides | Edición compartida de páginas y presentaciones | Web | Pro/Business/Enterprise | sep-oct-2026 | arriba | ver arriba | ver arriba |

## 8. Seguridad y privacidad
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 42 | Privacy Center | Panel central de privacidad | Web | Free, Go, Plus, Pro con sesión | 21-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 43 | Historial de seguridad | Inicios/cierres de sesión y cambios de MFA | Web | No confirmado | 25-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 44 | Control de entrenamiento («Mejorar el modelo para todos») y chat temporal | Desactiva el uso de tus chats; el chat temporal no crea memoria | Web | Cuentas personales | n/d | https://www.itechguides.com/what-happens-to-your-chatgpt-data-how-to-manage-privacy-settings-in-2026/ | Terceros; retención de 30 días **no confirmada** | n/d |
| 45 | Controles empresariales | SSO, MFA, consola de admin, SOC 2, SCIM, claves de cifrado, residencia de datos en 10 regiones, compuertas de aprobación en Work; no se entrena con datos de Business por defecto | Web | Business/Enterprise | 2026 | eesel.ai (no oficial) | Terceros | La reseña dice que los planes de pago aportan mayormente privacidad, administración y límites, no nuevas capacidades |
| 46 | Residencia de inferencia (EE. UU./Europa) | Para Ultrafast: EE. UU. y EEE+Suiza | Codex/Work | Pro 500/Enterprise | oct-2026 | changelog | Oficial | n/d |

## 9. Voz y multimodal
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 47 | Voz GPT-Live (1.1 y Quip) | Voz «full-duplex» natural; plugins y apps también en voz (23-sep); nuevas voces (15-oct) | Web, iOS, Android | Free limitado; más en pago | 8-jul-2026 | https://www.eesel.ai/blog/gpt-live-review ; Releasebot | Terceros + agregador | Elogio: la más natural hasta ahora (Kompozy, no oficial). Crítica: sin video ni pantalla compartida al lanzar; idiomas poco comunes irregulares |
| 48 | Generación de imágenes | Imágenes con GPT Image; límites mayores en Pro | Todas | Todos | n/d | https://aivideobootcamp.com/blog/chatgpt-plus-image-generation-complete-guide-2026/ | Terceros | Cifras de límites no confirmadas |
| 49 | Video (Sora) | **Descontinuado**: anunciado 24-mar-2026, apps cerradas 26-abr, API cierra 24-sep-2026 | n/a | n/a | 2026 | https://www.buildfastwithai.com/ai-tools/sora-openai | Terceros, no confirmado en fuente OpenAI | n/d |

## 10. Programación (Codex)
| # | Función | Qué hace | Plataformas | Plan | Fecha | Fuente | Confianza | Opinión |
|---|---|---|---|---|---|---|---|---|
| 50 | Codex dentro de la app de escritorio | Fusionado con ChatGPT; app anterior renombrada «ChatGPT Classic»; edición de Markdown/código, revisión de PR de GitHub, varios repos por proyecto | M, W; **Linux (Ubuntu 24.04) en vista previa desde 14-ago** | Según plan | 9-jul-2026 | https://learn.chatgpt.com/docs/changelog | Oficial (resumen) | Elogio: orquestación multiagente, worktrees, automatizaciones («mucho mejor que la CLI», HN). Crítica: 1,27 GB de RAM vs 478 MB de Classic, Electron, fuga de memoria de 10 GB (HN) https://news.ycombinator.com/item?id=49281916 |
| 51 | Codex en la nube | Tareas de código en espacios aislados | Web | de pago | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 52 | Revisión de código y escaneos de seguridad (Codex Security Cloud) | Revisión automática y escaneo | Codex | No confirmado | 29-sep-2026 | Releasebot | Oficial (vía agregador) | No confirmado |
| 53 | Predicciones del compositor | Sugiere el siguiente mensaje; Tab acepta | Codex escritorio (local y SSH) | Beta, Pro personal, mayores de 18, regiones admitidas | 9-oct-2026 | changelog | Oficial | No confirmado |
| 54 | Codex CLI 0.163.0 y retiro de GPT-5.5 en Codex | Panel /config, dirigir a mitad de respuesta; GPT-5.5 retirado 14-oct | CLI | n/d | 14-15-oct-2026 | changelog | Oficial | n/d |

**Total: 54 funciones listadas** (algunas son retiros).

---

## Planes (todo de terceros salvo aviso; precios oficiales no verificados por el 403)
Fuentes: https://www.ai-toolbox.co/chatgpt-models/chatgpt-pricing (proveedor, no oficial) y búsqueda de precios.
- **Free** $0: chat básico, límites en subidas, imágenes, voz, investigación profunda; probablemente con anuncios.
- **Go**: unos 8 USD/mes en EE. UU., precio localizado; más cupo que Free; anuncios (según fuentes).
- **Plus** 20 USD: Proyectos, investigación profunda, Codex ampliado, razonamiento.
- **Pro**: reaparece en **100, 200 y 500 USD**. Pro 500 se lanzó el 29-sep-2026 con Ultrafast. Dots solo en Pro y Business Premium.
- **Business**: 25 USD/usuario/mes (20 anual), mínimo 2 asientos; asientos Premium ~100-125 USD. GPT-6 Pro limitado (15/mes Standard, 50/semana Premium; no confirmado).
- **Enterprise/Edu**: a medida; gobernanza, SCIM, residencia de datos.
Los números exactos de uso por plan: **no confirmado** (las páginas no publican cifras fijas).

---

## (1) Las 10 funciones más elogiadas (muestra pequeña; ver límites)
1. Codex en la app de escritorio: orquestar varios agentes con worktrees y colas de revisión (HN).
2. Navegador integrado con inspector de red (HN).
3. Proyectos y chats fijados para mantener el foco (HN).
4. Voz GPT-Live: conversación natural con pausas e interrupciones (reseñas no oficiales).
5. Work: navegador reproducible y toma de control manual, aprobaciones antes de acciones riesgosas.
6. Entregables reales de Work (hojas con fórmulas, presentaciones) y conexión con SharePoint, Drive, GitHub, Box.
7. Tareas programadas y de monitoreo que solo avisan si algo cambia.
8. Complemento para Word en todos los planes, incluido Free.
9. Intelligent UI: el chat decide el formato (aún sin reseñas; **no confirmado el elogio**).
10. Subida de audio a transcripción y resumen (sin reseñas aún).
Honestidad: las posiciones 9 y 10 son supuestos por novedad, no por opiniones medidas. El conjunto es una muestra pequeña, no un ranking estadístico.

## (2) Las 10 quejas más repetidas / oportunidades
1. App de escritorio pesada: Electron, 1,27 GB de RAM, fugas de memoria (HN). Oportunidad: cliente ligero y nativo.
2. Producto confuso: Chat, Work y Codex mezclados, ajustes sobrecargados, no queda claro qué corre local o en la nube (HN).
3. Errores lógicos y exceso de confianza en Work que obligan a revisar todo (G2).
4. Lentitud de los agentes (tareas de 30 min en el agente 2025).
5. Navegador en la nube bloqueado por sitios (Amazon) y sin toma de control en móvil (latent.space).
6. Memoria poco fiable y que contamina el contexto; el agente no guarda memoria persistente.
7. Plugins: descubrimiento débil; los GPTs personalizados se retiran y las acciones no migran.
8. Límites opacos por plan; Pro con tres escalones de precio.
9. Retiros frecuentes (Pulse, chats grupales, Atlas, Sora, GPTs): inestabilidad del catálogo.
10. Seguridad: piden ejecutar las apps en VM; un instalador en Windows habría alterado permisos (un usuario, otro lo discute) (HN). Anuncios en Free/Go.

## (3) Tendencias 2026
- **Superapp de escritorio**: ChatGPT + Codex + Atlas fundidos; Work/Codex con modos local y nube. Se espera que Work se fusione con Chat a fin de año (declaración atribuida a Brockman por latent.space; no oficial).
- **De chatbot a agentes siempre activos** (Work, Dots, tareas programadas, eventos).
- **Plugins reemplazan a GPTs**; MCP como estándar.
- **Voz que actúa** (control por voz de Work y Codex).
- **Documentos vivos** (Space, Pages, Slides, Sites).
- **Niveles de precio más finos**: Go, Pro 100/200/500, anuncios en capas bajas.
- **Verticales de salud y finanzas**.
- **Poda de productos** (Sora, Atlas, Pulse, grupos).

## (4) Disponibilidad por país
Todo lo siguiente es **terceros o no confirmado**; no encontré nada oficial sobre Chile.
- **Chile/Latinoamérica**: no hay confirmación de exclusiones. Datos sueltos: anuncios (ads) sin fecha para Chile, Argentina, Colombia, Uruguay (blogs); informe «Tu año con ChatGPT» no disponible en la UE ni Latinoamérica (tercero); WhatsApp no disponible fuera del EEE (blog); Go existe en Latinoamérica con precio localizado, el precio de Chile **no confirmado**. Finanzas con crédito: solo EE. UU. (agregador).
- **UE/EEE/Suiza/Reino Unido**: Dots (Pro) excluidos (terceros); ChatGPT Agent estuvo excluido del EEE y Suiza en 2025 con informes contradictorios después; predicciones del compositor «en regiones admitidas»; anuncios en Europa desde ago-2026 (blog).
- Sugerencia: antes de decidir, comprobar en la cuenta de Ben qué aparece en Chile.

## Fuentes principales
- https://learn.chatgpt.com/docs/changelog (OpenAI, solo oct-2026 leído)
- https://releasebot.io/updates/openai/chatgpt (agregador)
- https://9to5mac.com/2026/07/09/openai-announcing-the-next-chapter-for-chatgpt-today-watch-here/
- https://www.latent.space/p/unpacking-chatgpt-work (no oficial)
- https://news.ycombinator.com/item?id=49281916 (Hacker News, no oficial)
- https://www.ai-toolbox.co/chatgpt-models/chatgpt-pricing (no oficial)
