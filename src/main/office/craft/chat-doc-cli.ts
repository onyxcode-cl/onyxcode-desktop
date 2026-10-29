/**
 * Núcleo común de las líneas de comandos de las TAREAS para Word y Excel con el MISMO motor que el Chat:
 * `node build_chat_docx.cjs spec.json salida.docx` / `node build_chat_xlsx.cjs spec.json salida.xlsx`.
 * Lee el JSON del bloque del Chat (`DocxSpec` / `XlsxSpec`), lo valida con el mismo `isDocxSpec` / `isXlsxSpec` y llama a
 * `renderChatDocx` (WordCraft) / `renderChatGrid` (GridCraft), exactamente lo que ejecuta el Chat: no hay lógica de diseño duplicada.
 * Mismo contrato que `chat-deck-cli.ts` (presentaciones): el JSON es DATO (nunca ruta ni comando; el programa se lanza sin shell),
 * la ruta del programa viene SOLO de la variable de entorno que fija la app, la salida nunca pisa un archivo existente (ni un enlace
 * simbólico) y los códigos de salida son 0 ok, 1 contenido/motor, 2 uso, 3 programa no instalado (la skill sigue con su camino en Python).
 * Este módulo no importa nada de Electron.
 */
import { constants } from 'node:fs'
import { lstat, open, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

export const MAX_SPEC_BYTES = 1_000_000

export interface ChatDocCliKind<S> {
  /** Extensión de salida con punto: `.docx`. */
  ext: string
  /** Nombre del script para el mensaje de uso. */
  script: string
  /** Nombre humano del programa para los avisos. */
  engineName: string
  /** Variable de entorno con la ruta del programa. */
  envVar: string
  /** Qué camino de respaldo usa la skill (texto del aviso de código 3). */
  fallback: string
  /** Mismo validador que el Chat. */
  isSpec: (v: unknown) => v is S
  /** Pista de lo que falla cuando el esquema no cumple (primer bloque/hoja inválido, claves desconocidas…). */
  explain: (v: unknown) => string
  /** Genera los bytes del archivo con el programa (la misma función que usa el Chat). */
  render: (binary: string, spec: S, timeoutMs: number) => Promise<Buffer>
  /** Resumen para el mensaje final. */
  summary: (spec: S) => string
}

export interface ChatDocCliDeps {
  /** Ruta del programa ya resuelta (por defecto `process.env[kind.envVar]`). */
  binary?: string | undefined
  log?: (m: string) => void
  err?: (m: string) => void
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/** Devuelve el código de salida. No lanza. */
export async function runChatDocCli<S>(kind: ChatDocCliKind<S>, argv: string[], deps: ChatDocCliDeps = {}): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m))
  const err = deps.err ?? ((m: string) => console.error(m))
  if (argv.length !== 2 || !argv[1].toLowerCase().endsWith(kind.ext)) {
    err(`Uso: ${kind.script} spec.json salida${kind.ext}`)
    return 2
  }
  const binary = 'binary' in deps ? deps.binary : process.env[kind.envVar]
  if (!binary || !isAbsolute(binary) || !(await isFile(binary))) {
    err(`Aviso: ${kind.engineName} no está instalado; ${kind.fallback}`)
    return 3
  }
  let spec: unknown
  try {
    const specPath = resolve(argv[0])
    const st = await stat(specPath)
    if (!st.isFile() || st.size > MAX_SPEC_BYTES) throw new Error(`el JSON debe ser un archivo de hasta ${MAX_SPEC_BYTES} bytes`)
    spec = JSON.parse(await readFile(specPath, 'utf8'))
  } catch (e) {
    err(`ERROR en el contenido: no se pudo leer el JSON (${e instanceof Error ? e.message : String(e)})`)
    return 1
  }
  if (!kind.isSpec(spec)) {
    err(`ERROR en el contenido: el JSON no cumple el esquema del Chat (ver la guía de la skill). ${kind.explain(spec)} No se generó nada.`)
    return 1
  }
  const out = resolve(argv[1])
  try {
    if (!(await stat(dirname(out))).isDirectory()) throw new Error('la carpeta de salida no existe')
    // Nunca sobrescribir: ni archivo ni enlace simbólico (lstat no lo sigue).
    await lstat(out).then(
      () => {
        throw new Error(`${basename(out)} ya existe: elige otro nombre (no se sobrescribe)`)
      },
      (e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      }
    )
  } catch (e) {
    err(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  let bytes: Buffer
  try {
    bytes = await kind.render(binary, spec, 60_000)
  } catch (e) {
    err(`ERROR: ${kind.engineName} falló: ` + (e instanceof Error ? e.message : String(e)).slice(0, 400))
    return 1
  }
  try {
    // O_EXCL = crear y fallar si ya existe (cierra la carrera entre la comprobación y la escritura).
    const fh = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644)
    try {
      await fh.writeFile(bytes)
    } finally {
      await fh.close()
    }
  } catch (e) {
    err(`ERROR: no se pudo escribir ${basename(out)}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  log(`Creado: ${argv[1]} (${kind.summary(spec)}, motor del Chat)`)
  return 0
}

/** Ejecuta la CLI solo cuando el archivo es el punto de entrada del `.cjs` empaquetado (no al importarlo en pruebas). */
export function runIfMain<S>(kind: ChatDocCliKind<S>, isMain: boolean): void {
  if (isMain) void runChatDocCli(kind, process.argv.slice(2)).then((code) => process.exit(code))
}
