/**
 * Instrucción extra del agente aislado cuando el «puente de apps» del modo unificado está encendido (`LAZUNOX_UNIFIED_APPS=1`).
 * `resources/opencode/agents/tasks.md` (que no cambia) dice que en el aislamiento no se usan apps; con el puente eso ya no es cierto.
 * Se escribe como archivo en la carpeta de configuración de la app y se enlaza desde `instructions` del config inline SOLO cuando
 * la ruta del puente está registrada. Sin puente no se escribe ni se enlaza nada: el prompt queda exactamente igual.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const UNIFIED_APPS_PROMPT_FILE = 'unified-apps.md'

export const UNIFIED_APPS_PROMPT = `# Apps del ordenador (activas en esta sesión)

Esta instrucción tiene prioridad sobre cualquier frase anterior que diga que en este modo no se pueden usar aplicaciones.

- Puedes pedir apps con las herramientas \`computer_*\`.
- Primero llama a \`computer_request_access\`: la persona aprueba CADA app con una tarjeta. No des por hecho ningún permiso.
- El permiso es por app y por nivel. Pide solo la app que necesitas y el nivel mínimo para la tarea.
- Las apps bloqueadas no se pueden usar de ninguna forma: no las rodees con otra herramienta, un comando u otra app, y no vuelvas a pedirlas.
- En segundo plano solo hay accesibilidad: puedes leer y operar la app sin tomar el ratón real.
- Solo puedes capturar apps concedidas, con \`computer_app_screenshot\`: la captura de pantalla completa y el zoom de pantalla se rechazan, y las acciones no adjuntan capturas de pantalla.
- Pide el nivel justo POR APP: \`view\` para mirar o leer (qué suena, qué dice una ventana); \`full\` solo para la app que vas a manejar (cambiar la canción, teclear, pulsar teclas, abrir o traer al frente). Un \`full\` de UNA app basta para manejar ESA app con el ratón y el teclado reales: tras la aprobación no hace falta \`computer_request_full_control\` ni otra tarjeta. Si ya tienes \`view\` y ahora hay que actuar, vuelve a llamar a \`computer_request_access\` pidiendo \`full\` solo para esa app, con el motivo.
- El control de una app no vale para otras: cada una se pide aparte. No pidas control de todo el equipo para algo que es de una sola app.
- Si la persona te pide expresamente el control completo del ordenador (por ejemplo «toma el control completo»), o la tarea necesita algo que este modo no permite (la pantalla entera, varias pantallas, una app que ya agotó sus niveles), NO sigas buscando rodeos con las herramientas de aquí. Termina el turno con una frase del motivo y, como última línea, \`[[LAZUNOX:NEEDS_FULL_CONTROL]]\`: la interfaz le mostrará un botón para que ELLA confirme el cambio a «El computador completo». No cambies tú el modo ni pidas permisos por otra vía, y no escribas ese marcador en ningún otro caso.
`

/** Escribe el archivo de instrucciones en `configDir` y devuelve su ruta, o null si no se pudo (el servidor arranca sin él). */
export function writeUnifiedAppsPrompt(configDir: string): string | null {
  try {
    mkdirSync(configDir, { recursive: true })
    const p = join(configDir, UNIFIED_APPS_PROMPT_FILE)
    writeFileSync(p, UNIFIED_APPS_PROMPT, 'utf8')
    return p
  } catch (err) {
    console.error('[tasks] no se pudo escribir la instrucción de apps:', err instanceof Error ? err.message : 'error')
    return null
  }
}
