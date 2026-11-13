/**
 * PRUEBA (rama `exp/craft-office-pruebas`): ejecución segura de los programas de línea de comandos de ArtCraft desde el proceso principal:
 * sin shell, con tope de tiempo y con un entorno MÍNIMO por plataforma cuyas carpetas de datos son una carpeta temporal propia (el
 * programa no toca ni lee la configuración del usuario).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { privateTmp } from './private-tmp'

/** Entorno mínimo para ejecutar un programa de ArtCraft con todo apuntando a `home`. */
export function craftEnv(home: string, platform: string = process.platform): NodeJS.ProcessEnv {
  if (platform === 'win32') {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
    return {
      SystemRoot: root,
      PATH: `${root}\\System32;${root}`,
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      TEMP: home,
      TMP: home
    }
  }
  return { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home }
}

/** Ejecuta `binary args…` con carpeta de datos temporal propia (se borra al terminar). Lanza con un mensaje corto si falla. */
export async function runCraft(binary: string, args: string[], timeoutMs: number, input?: string): Promise<void> {
  const home = await mkdtemp(join(await privateTmp(), 'lazunox-craft-home-'))
  try {
    await new Promise<void>((ok, fail) => {
      const child = execFile(
        binary,
        args,
        { timeout: timeoutMs, maxBuffer: 16 << 20, env: craftEnv(home), cwd: home, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) return fail(new Error(String(stderr || err.message).slice(0, 300)))
          try {
            if (input !== undefined) checkCraftBatch(stdout, input)
            ok()
          } catch (e) {
            fail(e)
          }
        }
      )
      // EPIPE lo informa execFile al salir el proceso; no dejar un error de stream sin manejar.
      child.stdin?.on('error', () => {})
      child.stdin?.end(input)
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

/** Los CLI fijados de Word/Deck no aceptan --script. Su MCP local recibe los mismos comandos por stdin, sin ventana ni shell. */
export function craftBatch(commands: string[]): string {
  const parsed = commands.map((line) => {
    const eq = line.indexOf('=')
    return eq < 0 ? { command: line } : { command: line.slice(0, eq), params: JSON.parse(line.slice(eq + 1)) }
  })
  return [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lazunox', version: '1' } }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'batch', arguments: { commands: parsed, keepGoing: false } } }
  ]
    .map((message) => JSON.stringify(message) + '\n')
    .join('')
}

/** El MCP puede salir con código 0 aun cuando un comando falla: verificar el resultado de la tanda antes de leer la salida. */
function checkCraftBatch(stdout: string, input: string): void {
  const replies = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const reply = replies.find((r) => r.id === 2)
  if (!reply || reply.error || reply.result?.isError) throw new Error('ArtCraft: falló la tanda de comandos')
  const text = reply.result?.content?.find((c: { type: string }) => c.type === 'text')?.text
  const results: Array<{ ok: boolean; command?: string; error?: unknown }> = JSON.parse(text ?? 'null')
  if (!Array.isArray(results) || !results.length) throw new Error('ArtCraft: respuesta de tanda incompleta')
  const failed = results.find((r) => r.ok !== true)
  if (failed) throw new Error(`ArtCraft: ${failed.command ?? 'comando'} falló: ${String(failed.error ?? '').slice(0, 200)}`)
  const expected = JSON.parse(input.trim().split('\n').at(-1)!).params.arguments.commands.length
  if (results.length !== expected) throw new Error('ArtCraft: respuesta de tanda incompleta')
}
