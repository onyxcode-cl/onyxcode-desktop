// @vitest-environment jsdom
/**
 * Captura de la salida de un comando leyendo el búfer REAL de xterm (con el flujo real de zsh a distintos anchos y con un prompt
 * largo `ben@MacBook-Pro-de-Benjamin-2 prueba-ejecutar %`): tiene que terminar («done»), quedarse solo con la salida y no arrastrar
 * ni el prompt ni la nota de «sigue en ejecución».
 */
import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutputView, ShareStatus } from '@shared/terminal-capture'
import { OutputCapture } from './outputCapture'
import { bufferTextFrom } from './terminalBuffer'
import fixturesJson from './terminalBuffer.fixtures.json'

interface Fixture {
  prompt_kind: 'largo' | 'corto'
  cols: number
  cmd: string
  first: string
  raw: string
}
const fixtures = fixturesJson as Fixture[]

const write = (term: Terminal, data: string): Promise<void> => new Promise((r) => term.write(data, r))

type Shared = Array<{ view: OutputView; status: ShareStatus }>

async function run(f: Fixture, rawUntil?: (raw: string) => string): Promise<{ cap: OutputCapture; shares: Shared; term: Terminal }> {
  const term = new Terminal({ cols: f.cols, rows: 24, scrollback: 5000, allowProposedApi: false })
  await write(term, f.first)
  const buf = term.buffer.active
  const startRow = buf.baseY + buf.cursorY
  const promptLine = buf.getLine(startRow)?.translateToString(true) ?? ''
  const shares: Shared = []
  const cap = new OutputCapture({
    promptLine,
    command: f.cmd,
    cols: () => term.cols,
    readText: () => bufferTextFrom(term.buffer.active, startRow),
    onShare: (view, status) => shares.push({ view, status })
  })
  const raw = rawUntil ? rawUntil(f.raw) : f.raw
  // En trozos, como llega del pty.
  for (let i = 0; i < raw.length; i += 17) {
    const chunk = raw.slice(i, i + 17)
    await new Promise<void>((r) =>
      term.write(chunk, () => {
        cap.push(chunk)
        r()
      })
    )
  }
  return { cap, shares, term }
}

afterEach(() => vi.useRealTimers())

describe('captura leyendo el búfer real de xterm', () => {
  it('hay muestras de prompt largo y corto a varios anchos', () => {
    expect(new Set(fixtures.map((f) => f.cols))).toEqual(new Set([40, 50, 60, 80, 100]))
    expect(new Set(fixtures.map((f) => f.prompt_kind))).toEqual(new Set(['largo', 'corto']))
  })

  it.each(fixtures.map((f) => [`${f.prompt_kind} ${f.cols} cols`, f] as const))('%s: termina y solo queda la salida', async (_n, f) => {
    const { cap, shares, term } = await run(f)
    const snap = cap.getSnapshot()
    expect(snap.status).toBe('done')
    expect(snap.view.text).toBe('hola-desde-lazunox\nfin')
    expect(snap.view.text).not.toContain('MacBook')
    expect(snap.view.text).not.toContain('prueba-ejecutar')
    await vi.waitFor(() => expect(shares).toHaveLength(1), { timeout: 3000 })
    expect(shares[0].status).toBe('done') // nunca «running»: no hay nota de «sigue en ejecución»
    expect(shares[0].view.text).toBe('hola-desde-lazunox\nfin')
    cap.dispose()
    term.dispose()
  })

  it('a mitad del comando (antes de «fin») sigue «running» con la salida parcial y sin prompt', async () => {
    const f = fixtures.find((x) => x.prompt_kind === 'largo' && x.cols === 50)!
    const { cap, term } = await run(f, (raw) => raw.slice(0, raw.indexOf('hola-desde-lazunox\r\n') + 20))
    expect(cap.getSnapshot().status).toBe('running')
    expect(cap.getSnapshot().view.text).toBe('hola-desde-lazunox')
    cap.dispose()
    term.dispose()
  })
})
