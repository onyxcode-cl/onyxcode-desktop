/**
 * PRUEBA (rama `exp/craft-office-pruebas`): ejecuta los comandos de `deck-builder.ts` por stdin de `deckcraft-cli mcp`.
 * Sin shell ni contenido en argumentos, con tope de tiempo y con carpetas de datos propias para que la herramienta no toque
 * la configuración del usuario. El archivo de salida lo decide quien llama (nunca el modelo).
 */
import { statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { buildDeckCommands, validateDeckSpec } from './deck-builder'
import { craftBatch, runCraft } from './craft-run'

export interface RunDeckResult {
  out: string
  bytes: number
  slides: number
  ms: number
}

export async function runDeck(binary: string, specInput: unknown, out: string, timeoutMs = 30_000): Promise<RunDeckResult> {
  const spec = validateDeckSpec(specInput)
  const target = resolve(out)
  if (extname(target).toLowerCase() !== '.pptx') throw new Error('La salida debe terminar en .pptx')
  const commands = buildDeckCommands(spec)
  const started = Date.now()
  await runCraft(binary, ['mcp'], timeoutMs, craftBatch([...commands, `file.saveAs=${JSON.stringify({ path: target })}`]))
  return { out: target, bytes: statSync(target).size, slides: spec.slides.length, ms: Date.now() - started }
}
