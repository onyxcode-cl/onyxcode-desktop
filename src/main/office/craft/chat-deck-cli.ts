/**
 * Línea de comandos de las TAREAS para armar una presentación con el MISMO motor que el Chat: `node build_chat_deck.cjs spec.json salida.pptx`.
 * Lee el `PptxSpec` del Chat (el mismo JSON del bloque ```pptx), lo valida con el mismo `isPptxSpec` y llama a `renderChatDeck`
 * (`chatDeckCommands` + `runCraft` → `deckcraft-cli`): no hay lógica de diseño duplicada. Se empaqueta con `scripts/build-chat-deck.mjs`
 * en un `.cjs` autocontenido dentro de la skill `pptx` (Node suelto, sin Electron; este módulo no importa nada de Electron).
 *
 * Seguridad: el JSON es DATO (nunca ruta ni comando; `deckcraft-cli` se lanza sin shell). La ruta de `deckcraft-cli` viene SOLO de
 * `LAZUNOX_DECKCRAFT` (la que la app instaló), nunca del JSON. La salida nunca pisa un archivo existente (ni un enlace simbólico).
 * Códigos de salida: 0 ok, 1 error de contenido o de DeckCraft, 2 uso, 3 DeckCraft no instalado (la skill sigue con `build_pptx.py`).
 */
import { constants } from 'node:fs'
import { lstat, open, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { isPptxSpec } from '@shared/chat-doc-spec'
import { renderChatDeck } from './chat-deck'
import { runCraft } from './craft-run'

export const MAX_SPEC_BYTES = 1_000_000

export interface ChatDeckCliDeps {
  /** Ruta de `deckcraft-cli` ya resuelta (por defecto `$LAZUNOX_DECKCRAFT`). */
  deckcraft?: string | undefined
  run?: typeof runCraft
  log?: (m: string) => void
  err?: (m: string) => void
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/** Devuelve el código de salida. No lanza. */
export async function runChatDeckCli(argv: string[], deps: ChatDeckCliDeps = {}): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m))
  const err = deps.err ?? ((m: string) => console.error(m))
  if (argv.length !== 2 || !argv[1].toLowerCase().endsWith('.pptx')) {
    err('Uso: build_chat_deck spec.json salida.pptx')
    return 2
  }
  const binary = 'deckcraft' in deps ? deps.deckcraft : process.env.LAZUNOX_DECKCRAFT
  if (!binary || !isAbsolute(binary) || !(await isExecutableFile(binary))) {
    err('Aviso: DeckCraft no está instalado; usa build_pptx.py (diseño estándar).')
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
  if (!isPptxSpec(spec)) {
    err(
      'ERROR en el contenido: el JSON no cumple el esquema de presentación (theme/style/palette/fonts/slides…, ver la guía de la skill). ' +
        'No se generó nada.'
    )
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
    bytes = await renderChatDeck(binary, spec, 30_000, deps.run ?? runCraft)
  } catch (e) {
    err('ERROR: DeckCraft falló: ' + (e instanceof Error ? e.message : String(e)).slice(0, 400))
    return 1
  }
  try {
    // `wx` = crear y fallar si ya existe (cierra la carrera entre la comprobación y la escritura).
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
  log(`Presentación creada: ${argv[1]} (${spec.slides.length} diapositivas, motor del Chat)`)
  return 0
}

// Entrada del `.cjs` empaquetado (`require.main === module` solo es cierto al ejecutarlo; al importarlo en pruebas no corre).
declare const require: NodeJS.Require | undefined
declare const module: NodeJS.Module | undefined
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void runChatDeckCli(process.argv.slice(2)).then((code) => process.exit(code))
}
