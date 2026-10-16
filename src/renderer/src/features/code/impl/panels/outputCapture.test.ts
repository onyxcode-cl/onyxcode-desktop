import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutputView, ShareStatus } from '@shared/terminal-capture'
import { OutputCapture } from './outputCapture'

const PROMPT = 'demo@tienda % '
let shares: Array<{ view: OutputView; status: ShareStatus }>
const make = (command: string, promptLine = PROMPT): OutputCapture =>
  new OutputCapture({ promptLine, command, cols: () => 80, onShare: (view, status) => shares.push({ view, status }) })

beforeEach(() => {
  vi.useFakeTimers()
  shares = []
})
afterEach(() => vi.useRealTimers())

describe('OutputCapture: cuándo se comparte (una sola vez)', () => {
  it('el shell vuelve al prompt: terminó, sin la línea del prompt', () => {
    const c = make('npm test')
    c.push('npm test\r\n')
    c.push('\u001b[32m3 passed\u001b[0m\r\n')
    c.push('demo@tienda % ')
    expect(c.getSnapshot().status).toBe('done')
    expect(shares).toHaveLength(0)
    vi.advanceTimersByTime(500)
    expect(shares).toHaveLength(1)
    expect(shares[0].status).toBe('done')
    expect(shares[0].view.text).toBe('3 passed')
  })

  it('sin reconocer el prompt, ~3 s de calma = terminó', () => {
    const c = make('ls', '')
    c.push('ls\r\nREADME.md\r\n')
    vi.advanceTimersByTime(2900)
    expect(shares).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(shares).toEqual([expect.objectContaining({ status: 'done' })])
    expect(c.getSnapshot().status).toBe('done')
  })

  it('pide contraseña: comparte solo lo previo, como «waiting», y no la tecla nada', () => {
    const c = make('sudo apt update')
    c.push('sudo apt update\r\n[sudo] contraseña para ben: ')
    expect(c.getSnapshot()).toMatchObject({ status: 'waiting', waitKind: 'password' })
    vi.advanceTimersByTime(500)
    expect(shares).toHaveLength(1)
    expect(shares[0].status).toBe('waiting')
    expect(shares[0].view.text).toContain('[sudo] contraseña para ben:')
  })

  it('pregunta s/n también espera', () => {
    const c = make('npm init')
    c.push('npm init\r\nOk to proceed? (y/n) ')
    expect(c.getSnapshot().waitKind).toBe('answer')
  })

  it('un servidor que sigue: tras ~5 s estables comparte UNA vez con «running» y no vuelve a enviar', () => {
    const c = make('npm run dev')
    c.push('npm run dev\r\nlisto en http://localhost:5173\r\n')
    vi.advanceTimersByTime(4900)
    expect(shares).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(shares).toEqual([expect.objectContaining({ status: 'running' })])
    c.push('GET /\r\n')
    vi.advanceTimersByTime(20_000)
    c.push('demo@tienda % ')
    vi.advanceTimersByTime(20_000)
    expect(shares).toHaveLength(1)
    expect(c.getSnapshot().status).toBe('done') // la tarjeta sí se actualiza
  })

  it('el progreso con \\r se queda con la última versión de la línea y los secretos se tachan', () => {
    const c = make('descarga')
    c.push('descarga\r\n10%\r50%\r100%\r\nexport API_KEY=abcdef123456\r\ndemo@tienda % ')
    vi.advanceTimersByTime(500)
    expect(shares[0].view.text).toBe('100%\nexport API_KEY=…')
  })

  it('dispose cancela el aviso', () => {
    const c = make('x')
    c.push('x\r\ny\r\n')
    c.dispose()
    vi.advanceTimersByTime(10_000)
    expect(shares).toHaveLength(0)
  })

  it('tras terminar, lo que se teclee a mano después NO entra en la captura', () => {
    const c = make('npm test')
    c.push('npm test\r\n3 passed\r\ndemo@tienda % ')
    expect(c.getSnapshot().status).toBe('done')
    c.push('ls -la\r\ntotal 8\r\ndemo@tienda % ')
    vi.advanceTimersByTime(500)
    expect(shares).toHaveLength(1)
    expect(shares[0].view.text).toBe('3 passed')
    expect(c.getSnapshot().view.text).toBe('3 passed')
  })
})
