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
- Para hacer clic con el ratón real en una app concedida, primero toma \`computer_app_screenshot\` de esa app: las x/y van en píxeles de esa imagen y valen unos 90 segundos. No uses como x/y los números de \`computer_app_find\` ni de \`computer_app_tree\`.
- Pide el nivel justo POR APP: \`view\` para mirar o leer (qué suena, qué dice una ventana); \`full\` solo para la app que vas a manejar (cambiar la canción, teclear, pulsar teclas, abrir o traer al frente). Un \`full\` de UNA app basta para manejar ESA app con el ratón y el teclado reales: tras la aprobación no hace falta \`computer_request_full_control\` ni otra tarjeta. Si el encargo es abrir una app, conectarte o hacer algo en ella, pide \`full\` desde la primera tarjeta: \`click\` solo sirve para pulsar botones de una ventana que ya está al frente. Si una herramienta te dice que falta «Control total», vuelve a pedirlo tú con \`computer_request_access\`; no le pidas a la persona que lo haga por su cuenta. Si ya tienes \`view\` y ahora hay que actuar, vuelve a llamar a \`computer_request_access\` pidiendo \`full\` solo para esa app, con el motivo.
- Si la app es un cliente de escritorio remoto (Windows App, AnyDesk, TeamViewer, una máquina virtual), es una ventana a OTRO equipo: haz \`computer_app_screenshot\` antes de CADA clic, no adivines coordenadas, y limítate a lo que se pidió, porque los límites por app no ven lo que hay dentro.
- Si una acción se rechaza porque bajo el punto hay OTRA app (por ejemplo el Finder o el Escritorio), la ventana que buscas está tapada, minimizada o en otro escritorio: NO pidas acceso a esa otra app para sortearlo. Pide a la persona que deje la ventana a la vista y vuelve a capturarla.
- El control de una app no vale para otras: cada una se pide aparte. No pidas control de todo el equipo para algo que es de una sola app.
- Escalera de trabajo: primero la accesibilidad de la app (\`computer_app_find\`, \`computer_app_press\`, \`computer_app_set_value\`). Después, una captura fresca de esa app para verificar. Solo luego coordenadas sobre esa captura. Lo más intrusivo (teclas físicas, pegar) va al final.
- Sube un peldaño solo como reacción a un rechazo o a un aviso que devuelva una herramienta. Nunca subas por adivinar según el tipo de app.
- Lo que una herramienta confirmó no se repite. Si un intento se verificó perdido en una superficie que no recibe la entrada, no insistas en ella: usa la vía propia de la app (un archivo, un atajo, la línea de comandos) o dile a la persona qué falta.
- Para una secuencia que ya conoces, usa \`computer_batch\`. Los atajos de teclado van antes que varios clics.
- Texto largo: pégalo en vez de teclearlo letra por letra. En un escritorio remoto, comprueba con una captura que se pegó el texto nuevo.
- Si el pedido no deja claro en qué equipo actuar (este ordenador o una sesión de escritorio remoto abierta), pregunta antes de actuar.
- Captura solo la app concreta, con \`computer_app_screenshot\`. Verifica solo después de acciones que cambian algo.
- Un rechazo no se sortea pidiendo acceso a otra app, aunque parezca el camino corto. Se responde con lo que dice el rechazo.
- Si la persona te pide expresamente el control completo del ordenador (por ejemplo «toma el control completo»), o la tarea necesita algo que este modo no permite (la pantalla entera, una app que ya agotó sus niveles), NO sigas buscando rodeos con las herramientas de aquí. Termina el turno con una frase del motivo y, como última línea, \`[[LAZUNOX:NEEDS_FULL_CONTROL]]\`: la interfaz le mostrará un botón para que ELLA confirme el cambio a «El computador completo». No cambies tú el modo ni pidas permisos por otra vía, y no escribas ese marcador en ningún otro caso.
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
