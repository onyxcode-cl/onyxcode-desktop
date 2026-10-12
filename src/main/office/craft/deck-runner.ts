/**
 * PRUEBA (rama `exp/craft-office-pruebas`): ejecuta `deckcraft-cli run` con los comandos de `deck-builder.ts`.
 * Sin shell (`execFile` con arreglo de argumentos), con tope de tiempo y con carpetas de datos propias para que la herramienta no toque
 * la configuración del usuario. El archivo de salida lo decide quien llama (nunca el modelo).
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { buildDeckCommands, validateDeckSpec } from './deck-builder'

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
  const home = mkdtempSync(join(tmpdir(), 'lazunox-craft-'))
  const started = Date.now()
  try {
    await new Promise<void>((ok, fail) => {
      const args = ['run', '--save', target]
      for (const c of commands) args.push('--cmd', c)
      execFile(
        binary,
        args,
        {
          timeout: timeoutMs,
          maxBuffer: 1 << 20,
          env: { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home }
        },
        (err, _stdout, stderr) => (err ? fail(new Error(`deckcraft-cli falló: ${String(stderr || err.message).slice(0, 400)}`)) : ok())
      )
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  return { out: target, bytes: statSync(target).size, slides: spec.slides.length, ms: Date.now() - started }
}
