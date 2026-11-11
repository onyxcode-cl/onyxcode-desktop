/**
 * H5 (revisión RI2 de la jaula V2): en Tareas con jaula el motor NO carga código que la propia tarea pueda dejar escrito.
 *
 * Un programa que el modelo ejecuta dentro de la jaula puede escribir en la carpeta de la tarea y en la carpeta privada del motor. Sin esto,
 * el motor (que guarda la contraseña de su servidor, los tokens de las rutas del proxy MCP y el del guardián) cargaba en ese arranque o en
 * el siguiente, DENTRO de su proceso o como hijo con todo su entorno:
 *  - de la carpeta de la tarea (y de sus carpetas madre hasta la raíz del repositorio): `opencode.json(c)` (MCP locales, formateadores, LSP,
 *    lista de complementos, permisos, variables `{env:…}`), `.opencode/**` (complementos, herramientas, comandos, agentes, modos) y
 *    `.claude/agents`;
 *  - de su carpeta privada (`XDG_CONFIG_HOME/opencode`, la «config global» del motor dentro de la jaula): lo mismo.
 *
 * Qué hace la app (sin cambiar el motor):
 *  1. `OPENCODE_DISABLE_PROJECT_CONFIG=1` en el servidor con jaula: el motor ignora TODA la config del proyecto (motor lazunox.17:
 *     `config/config.ts:422-519`, `config/paths.ts:32`, `session/instruction.ts:204,268,333`, `permission/capas.ts:196`).
 *  2. Lo que es solo TEXTO y la persona usa se vuelve a dar por la config inline, con ruta absoluta: las instrucciones de la carpeta
 *     (`AGENTS.md`, o `CLAUDE.md`/`CONTEXT.md` si no hay `AGENTS.md`, como hace el motor) y las skills de `.opencode/skills` (las que aprende
 *     la app, `learned-skills.ts`). Una skill es texto: sus scripts los corre el modelo con la herramienta shell, dentro de la jaula y sin
 *     los secretos.
 *  3. `lsp: false` y `formatter: false` en la config inline (ya estaban apagados por omisión; así ninguna otra fuente los enciende).
 *  4. Antes de cada arranque con jaula, lo que haya en la config global privada del motor se aparta a una cuarentena (la app nunca escribe
 *     ahí; si hay algo, lo dejó la tarea).
 *
 * Lo que la persona configuró FUERA (config de la app en `OPENCODE_CONFIG_DIR`, sus conectores, sus permisos recordados) entra por la config
 * inline y por `OPENCODE_CONFIG_DIR`, que no toca nada de esto. Control total (sin jaula) queda igual.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRealDir } from './no-follow'

/** Variables que apagan la config del proyecto en el motor con jaula. Control total: ninguna. */
export function projectCodeEnv(fullAccess: boolean): Record<string, string> {
  return fullAccess ? {} : { OPENCODE_DISABLE_PROJECT_CONFIG: '1' }
}

/** Mismo orden que el motor (`session/instruction.ts:185-189`): gana el primero que exista. */
export const PROJECT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md'] as const

/** Carpetas de skills del proyecto que el motor leía de `.opencode/` (`skill/index.ts:38`, `{skill,skills}/**\/SKILL.md`). */
export const PROJECT_SKILL_DIRS = [join('.opencode', 'skills'), join('.opencode', 'skill')] as const

export interface ProjectText {
  /** Archivo de instrucciones de la carpeta (ruta del anfitrión). Si no existe ninguno, `AGENTS.md`: el motor lo lee en cada mensaje. */
  instructionFile: string
  /** Carpetas de skills del proyecto (ruta del anfitrión). El motor ignora las que no existan. */
  skillDirs: string[]
}

/** Lo que es solo texto de la carpeta y se sigue dando al motor por la config inline. */
export function projectText(folder: string, exists: (p: string) => boolean = existsSync): ProjectText {
  const found = PROJECT_INSTRUCTION_FILES.map((f) => join(folder, f)).find((p) => exists(p))
  return {
    instructionFile: found ?? join(folder, PROJECT_INSTRUCTION_FILES[0]),
    skillDirs: PROJECT_SKILL_DIRS.map((d) => join(folder, d))
  }
}

/** Carpeta de cuarentena dentro de la carpeta privada (el motor no lee nada de ahí). */
export const QUARANTINE_DIR = 'cuarentena-config'
/** Cuántas cuarentenas se guardan (las más nuevas). */
export const QUARANTINE_KEEP = 3
/** Lo que el propio motor escribe en su config global al arrancar (`config/config.ts:310-327, 484-492`). No es código que cargue. */
const ENGINE_OWN = new Set(['node_modules', 'package.json', 'package-lock.json', 'bun.lock', '.gitignore'])

/**
 * Aparta a `<privada>/cuarentena-config/<marca>/` todo lo que haya en la config global privada del motor (`<privada>/config/opencode`)
 * salvo lo que el motor escribe solo (y solo si es un archivo o carpeta real, no un enlace). Mueve, no borra: `rename` mueve el enlace o la
 * carpeta tal cual, sin seguir enlaces. Si `config/opencode` es un enlace o un archivo, se quita ESE enlace y se crea una carpeta vacía.
 * Devuelve los nombres apartados. Lanza si no se puede garantizar (quien llama no arranca).
 */
export function quarantineEngineUserConfig(privateDir: string, log: (msg: string) => void = (m) => console.warn('[tasks]', m), now = Date.now()): string[] {
  const dir = ensureRealDir(privateDir, join(privateDir, 'config', 'opencode'), {
    create: true,
    replace: true,
    onReplaced: (p) => log(`la config global privada del motor era un enlace o un archivo (${p}); se quitó`)
  })
  const moved = readdirSync(dir).filter((name) => {
    if (!ENGINE_OWN.has(name)) return true
    const st = lstatSync(join(dir, name))
    return st.isSymbolicLink() || !(st.isDirectory() || st.isFile())
  })
  if (!moved.length) return []
  const root = ensureRealDir(privateDir, join(privateDir, QUARANTINE_DIR), { create: true, replace: true })
  let stamp = String(now)
  for (let i = 1; lstatOrNull(join(root, stamp)); i++) stamp = `${now}-${i}`
  const dest = join(root, stamp)
  mkdirSync(dest)
  for (const name of moved) renameSync(join(dir, name), join(dest, name))
  // Solo las más nuevas; `rm` no sigue enlaces (borra el enlace, nunca su destino).
  const all = readdirSync(root).sort()
  for (const old of all.slice(0, Math.max(0, all.length - QUARANTINE_KEEP))) rmSync(join(root, old), { recursive: true, force: true })
  log(`config global privada del motor: se apartó a la cuarentena lo que dejó la tarea (${moved.join(', ')})`)
  return moved
}

function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}
