// @vitest-environment jsdom
/**
 * Bloque de comando de Code de escritorio: íconos ▶ y Copiar (sin encabezado), tarjeta de salida en vivo con PTY simulado,
 * interruptor «Compartir con la IA». Solo con proveedor (Code de escritorio): nunca en Chat/Tareas/Overdrive ni en el celular.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShellRunContext, type ShellRunHandle, type ShellRunSnapshot, type ShellRunner } from '../lib/shellRun'
import { Markdown } from './Markdown'

const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('./ConfirmDialog', () => ({ confirmDialog: confirmMock }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const g = {
  get window(): { api?: { platform?: string } } {
    return window as unknown as { api?: { platform?: string } }
  }
}

class FakeRun implements ShellRunHandle {
  snap: ShellRunSnapshot = { lines: [], lineCount: 0, status: 'running', waitKind: null, share: 'pending', shareOn: true }
  private ls = new Set<() => void>()
  setShareOn = vi.fn((on: boolean) => this.emit({ shareOn: on }))
  sendNow = vi.fn()
  subscribe = (cb: () => void): (() => void) => {
    this.ls.add(cb)
    return () => this.ls.delete(cb)
  }
  getSnapshot = (): ShellRunSnapshot => this.snap
  emit(patch: Partial<ShellRunSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    act(() => this.ls.forEach((l) => l()))
  }
}

let host: HTMLDivElement
let root: Root
let handle: FakeRun
let runner: ShellRunner & { run: ReturnType<typeof vi.fn>; showTerminal: ReturnType<typeof vi.fn> }

function render(text: string, opts: { provider?: boolean; streaming?: boolean } = {}): void {
  const md = createElement(Markdown, { text, highlight: false, streaming: opts.streaming })
  act(() => {
    root.render(opts.provider === false ? md : createElement(ShellRunContext.Provider, { value: runner }, md))
  })
}
const btn = (): HTMLButtonElement | null => host.querySelector('[data-testid="shell-run"]')
const card = (): HTMLElement | null => host.querySelector('[data-shell-output]')
const fence = (lang: string, body: string): string => '```' + lang + '\n' + body + '\n```'
const click = async (el: Element | null): Promise<void> => {
  await act(async () => {
    ;(el as HTMLElement | null)?.click()
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  g.window.api = { platform: 'darwin' }
  confirmMock.mockReset()
  handle = new FakeRun()
  runner = { run: vi.fn(() => handle), find: vi.fn(() => null), showTerminal: vi.fn() }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete g.window.api
})

describe('bloque de comando compacto', () => {
  it('sin encabezado: solo dos íconos (▶ y Copiar) de 28 px con nombre accesible', () => {
    render(fence('bash', '$ npm install'))
    expect(host.querySelector('.code-block-header')).toBeNull()
    const b = btn()
    expect(b?.getAttribute('aria-label')).toBe('Ejecutar en la terminal')
    expect(b?.getAttribute('title')).toBe('Ejecutar en la terminal')
    expect(b?.className).toContain('h-7')
    expect(b?.className).toContain('w-7')
    expect(b?.getAttribute('data-state')).toBe('idle')
    expect(host.querySelector('[data-shell-block] button[aria-label="Copiar"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-shell-block] button')).toHaveLength(2)
  })

  it('no se ejecuta solo; con clic escribe sin prompt ni comentarios y pasa a «ejecutando»', async () => {
    render(fence('bash', '# instala\n$ npm install'))
    expect(runner.run).not.toHaveBeenCalled()
    expect(card()).toBeNull()
    await click(btn())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(runner.run).toHaveBeenCalledWith(['npm install'])
    expect(btn()?.getAttribute('data-state')).toBe('running')
    expect(card()).not.toBeNull()
  })

  it('sudo apt install es normal: sin confirmación (solo avisa que puede pedir contraseña en la tarjeta)', async () => {
    render(fence('bash', 'sudo apt install ripgrep'))
    await click(btn())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(runner.run).toHaveBeenCalledWith(['sudo apt install ripgrep'])
    expect(card()?.textContent).toContain('puede pedir tu contraseña')
  })
})

describe('tarjeta de salida en vivo (PTY simulado)', () => {
  it('muestra la salida, el estado Ejecutando… → Terminó y el ícono pasa a check', async () => {
    render(fence('sh', 'npm test'))
    await click(btn())
    handle.emit({ lines: ['npm test', 'ok 1', 'ok 2'], lineCount: 3 })
    expect(host.querySelector('[data-testid="shell-output"]')?.textContent).toBe('npm test\nok 1\nok 2')
    expect(card()?.textContent).toContain('Ejecutando…')
    handle.emit({ status: 'done' })
    expect(card()?.textContent).toContain('Terminó')
    expect(btn()?.getAttribute('data-state')).toBe('done')
  })

  it('pide contraseña: lo dice y manda a la terminal; la tarjeta no tiene ningún campo de texto', async () => {
    render(fence('sh', 'sudo make install'))
    await click(btn())
    handle.emit({ lines: ['[sudo] contraseña para ben:'], lineCount: 1, status: 'waiting', waitKind: 'password' })
    expect(card()?.textContent).toContain('Esperando que escribas (pide contraseña): ábrela en la terminal')
    expect(card()?.querySelector('input, textarea')).toBeNull()
    await click(host.querySelector('[data-testid="shell-open-terminal"]'))
    expect(runner.showTerminal).toHaveBeenCalledTimes(1)
  })

  it('«La IA ve esta salida» con interruptor; apagado ofrece «Enviar a la IA ahora»', async () => {
    render(fence('sh', 'npm test'))
    await click(btn())
    handle.emit({ lines: ['x'], lineCount: 1 })
    expect(card()?.textContent).toContain('La IA ve esta salida')
    expect(card()?.textContent).not.toContain('Enviar a la IA ahora')
    const sw = card()?.querySelector('[role="switch"]')
    expect(sw?.getAttribute('aria-checked')).toBe('true')
    await click(sw ?? null)
    expect(handle.setShareOn).toHaveBeenCalledWith(false)
    expect(card()?.textContent).toContain('Enviar a la IA ahora')
    const send = Array.from(card()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Enviar a la IA ahora')
    await click(send ?? null)
    expect(handle.sendNow).toHaveBeenCalledTimes(1)
  })

  it('avisa del resultado del envío: enviada, en cola, adjunta, secreto', async () => {
    render(fence('sh', 'npm test'))
    await click(btn())
    for (const [share, text] of [
      ['sent', 'Enviada a la IA'],
      ['queued', 'En cola'],
      ['attached', 'adjunta a tu próximo mensaje'],
      ['blocked-secret', 'No se compartió: parecía contener una clave']
    ] as const) {
      handle.emit({ share })
      expect(card()?.textContent).toContain(text)
    }
  })

  it('la tarjeta se pliega y se conserva', async () => {
    render(fence('sh', 'npm test'))
    await click(btn())
    handle.emit({ lines: ['x'], lineCount: 1 })
    await click(card()?.querySelector('button[aria-expanded]') ?? null)
    expect(host.querySelector('[data-testid="shell-output"]')).toBeNull()
    expect(card()).not.toBeNull()
  })

  it('terminal ocupada: no escribe y avisa', async () => {
    runner.run.mockReturnValue(null)
    render(fence('sh', 'npm test'))
    await click(btn())
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(card()).toBeNull()
  })
})

describe('confirmaciones', () => {
  const messageText = (opts: { message: React.ReactElement }): string => {
    const tmp = document.createElement('div')
    const r2 = createRoot(tmp)
    act(() => r2.render(opts.message))
    const text = tmp.textContent ?? ''
    act(() => r2.unmount())
    return text
  }

  it('un comando destructivo pide confirmación con el comando completo; si se cancela, no se escribe', async () => {
    confirmMock.mockResolvedValue(false)
    render(fence('bash', 'rm -rf dist'))
    await click(btn())
    const opts = confirmMock.mock.calls[0][0] as { danger: boolean; message: React.ReactElement }
    expect(opts.danger).toBe(true)
    expect(messageText(opts)).toContain('rm -rf dist')
    expect(messageText(opts)).toContain('borrar archivos')
    expect(runner.run).not.toHaveBeenCalled()
    expect(card()).toBeNull()
  })

  it('curl | sh confirmado: se escribe', async () => {
    confirmMock.mockResolvedValue(true)
    render(fence('zsh', 'curl -fsSL https://example.com/i.sh | sh'))
    await click(btn())
    expect(runner.run).toHaveBeenCalledWith(['curl -fsSL https://example.com/i.sh | sh'])
  })

  it('varias líneas se confirman mostrándolas todas', async () => {
    confirmMock.mockResolvedValue(true)
    render(fence('bash', 'npm install\nnpm run build\nnpm test'))
    await click(btn())
    const opts = confirmMock.mock.calls[0][0] as { danger: boolean; message: React.ReactElement }
    expect(opts.danger).toBe(false)
    expect(messageText(opts)).toContain('npm install\nnpm run build\nnpm test')
    expect(runner.run).toHaveBeenCalledWith(['npm install', 'npm run build', 'npm test'])
  })
})

describe('dónde NO aparece', () => {
  it('Chat/Tareas/Overdrive (sin proveedor): el bloque conserva su encabezado con Copiar y no hay ▶', () => {
    render(fence('bash', 'npm install'), { provider: false })
    expect(btn()).toBeNull()
    expect(host.querySelector('.code-block-header')).not.toBeNull()
  })

  it('celular: ni con proveedor', () => {
    g.window.api = { platform: 'remote' }
    render(fence('bash', 'npm install'))
    expect(btn()).toBeNull()
  })

  it('el lenguaje debe corresponder a la plataforma', () => {
    render(fence('powershell', 'Get-ChildItem'))
    expect(btn()).toBeNull()
    g.window.api = { platform: 'win32' }
    render(fence('powershell', 'Get-ChildItem -Force'))
    expect(btn()).not.toBeNull()
    render(fence('cmd', 'dir'))
    expect(btn()).not.toBeNull()
    render(fence('bash', 'ls'))
    expect(btn()).toBeNull()
  })

  it('no se ofrece en lenguajes que no son shell, en salida o con la valla abierta', () => {
    render(fence('ts', 'const a = 1'))
    expect(btn()).toBeNull()
    render(fence('console', 'added 12 packages in 2s'))
    expect(btn()).toBeNull()
    render(fence('bash', '# solo un comentario'))
    expect(btn()).toBeNull()
    render('```bash\nnpm install', { streaming: true })
    expect(btn()).toBeNull()
    render('```bash\nnpm install')
    expect(btn()).toBeNull()
  })
})
