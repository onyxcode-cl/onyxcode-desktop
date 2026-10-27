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
- No pidas control del ratón y del teclado reales salvo que de verdad haga falta.
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
