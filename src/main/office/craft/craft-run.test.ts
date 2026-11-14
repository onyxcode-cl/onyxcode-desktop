import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { CraftTimeoutError, craftBatch, runCraft } from './craft-run'
import { renderChatDocx } from './chat-word'
import { renderChatDeck } from './chat-deck'
import { renderChatGrid } from './chat-grid'
import { isDocxSpec, isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'

const state = vi.hoisted(() => ({
  seen: [] as Array<{ args: string[]; env: NodeJS.ProcessEnv; content: string }>,
  failure: false,
  timeout: false,
  maxBuffer: false
}))
vi.mock('node:child_process', () => ({
  execFile: (
    _binary: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv },
    done: (err: Error | null, out: string, stderr: string) => void
  ) => {
    if (process.platform === 'win32' && args.join(' ').length > 32_767) throw new Error('spawn ENAMETOOLONG')
    return {
      stdin: {
        on: () => {},
        end: (input?: string) => {
          if (state.timeout) return done(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), '', 'mensaje del motor')
          if (state.maxBuffer)
            return done(
              Object.assign(new Error('buffer lleno'), { killed: true, signal: 'SIGTERM', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
              '',
              ''
            )
          let content: string
          let results: Array<{ command: string; ok: boolean }>
          if (args[0] === 'mcp') {
            const commands = JSON.parse(input!.trim().split('\n').at(-1)!).params.arguments.commands as Array<{
              command: string
              params?: { path: string }
            }>
            content = input!
            results = commands.map((c) => ({ command: c.command, ok: !state.failure }))
            writeFileSync(commands.at(-1)!.params!.path, 'OFFICE')
          } else {
            content = readFileSync(args[args.indexOf('--script') + 1], 'utf8')
            results = []
            writeFileSync(args[args.indexOf('--out') + 1], 'OFFICE')
          }
          state.seen.push({ args, env: opts.env, content })
          done(null, JSON.stringify({ id: 2, result: { content: [{ type: 'text', text: JSON.stringify(results) }] } }), '')
        }
      }
    }
  }
}))
afterEach(() => {
  vi.unstubAllGlobals()
  state.seen = []
  state.failure = false
  state.timeout = false
  state.maxBuffer = false
  rmSync('/private/tmp/v23d-fake.docx', { force: true })
})

describe('contenido grande fuera de argv y del entorno', () => {
  it('conserva un timeout tipado aunque el programa haya escrito en stderr', async () => {
    state.timeout = true
    await expect(runCraft('/wordcraft', ['render'], 1000)).rejects.toBeInstanceOf(CraftTimeoutError)
  })
  it('no confunde el límite de salida con un timeout aunque execFile mate el proceso', async () => {
    state.maxBuffer = true
    await expect(runCraft('/wordcraft', ['render'], 1000)).rejects.toThrow('buffer lleno')
  })
  it.each(['win32', 'darwin'])('Word, presentación y planilla con 60.000 caracteres en %s', async (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    const text = 'á'.repeat(5000)
    const doc = { blocks: Array.from({ length: 12 }, () => ({ type: 'paragraph' as const, text })) }
    expect(isDocxSpec(doc)).toBe(true)
    await renderChatDocx('/wordcraft', doc)
    // Con identidad aplicada el cuerpo no baja de 14 pt: 40 láminas (el máximo) con viñetas que caben.
    const deckText = 'á '.repeat(25).trim()
    const gridText = 'á'.repeat(2000)
    const deck = { slides: Array.from({ length: 40 }, () => ({ title: 'Datos', bullets: [deckText, deckText, deckText, deckText] })) }
    const grid = { sheets: [{ name: 'Datos', rows: Array.from({ length: 30 }, () => [gridText]) }] }
    expect(isPptxSpec(deck)).toBe(true)
    expect(isXlsxSpec(grid)).toBe(true)
    await renderChatDeck('/deckcraft', deck)
    await renderChatGrid('/gridcraft', grid)
    expect(state.seen).toHaveLength(3)
    for (const [index, call] of state.seen.entries()) {
      expect(call.args.join(' ').length).toBeLessThan(1000)
      expect(JSON.stringify(call.env).length).toBeLessThan(4000)
      expect(call.args.join(' ') + JSON.stringify(call.env)).not.toContain(text)
      expect(call.content.split([text, deckText, gridText][index])).toHaveLength([13, 161, 31][index])
      expect(call.env.SystemRoot !== undefined).toBe(platform === 'win32')
    }
  })
  it('el límite simulado de Windows rechaza el transporte antiguo por argv', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await expect(
      runCraft('/wordcraft', ['run', '--cmd', 'text.insert=' + JSON.stringify({ text: 'x'.repeat(60_000) })], 1000)
    ).rejects.toThrow('ENAMETOOLONG')
  })
  it('propaga errores de comandos aunque el MCP salga con código cero', async () => {
    state.failure = true
    await expect(
      runCraft('/wordcraft', ['mcp'], 1000, craftBatch(['text.insert={"text":"x"}', 'file.saveAs={"path":"/private/tmp/v23d-fake.docx"}']))
    ).rejects.toThrow('falló')
  })
})
