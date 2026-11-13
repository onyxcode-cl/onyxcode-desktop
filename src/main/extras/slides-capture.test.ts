import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testSlidePng } from './slides-png-fixture'

const state = vi.hoisted(() => ({
  commands: [] as Array<{ name: string; args?: unknown }>,
  png: Buffer.alloc(0) as Buffer,
  destroyed: false,
  attached: false,
  count: 2,
  validationError: '',
  hangCapture: false,
  callbacks: [] as number[]
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  session: {
    fromPartition: () => ({
      protocol: { handle: vi.fn() },
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn()
    })
  },
  BrowserWindow: class {
    webContents = {
      debugger: {
        attach: () => {
          state.attached = true
        },
        detach: () => {
          state.attached = false
        },
        isAttached: () => state.attached,
        sendCommand: async (name: string, args?: unknown) => {
          state.commands.push({ name, args })
          if (name === 'Page.captureScreenshot' && state.hangCapture) return new Promise(() => undefined)
          if (name === 'Page.captureScreenshot') return { data: state.png.toString('base64') }
          return {}
        }
      },
      isDestroyed: () => state.destroyed,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      executeJavaScript: async (script: string) => {
        if (script.includes('Presentación HTML inválida:')) {
          if (state.validationError) return { ok: false, error: state.validationError }
          return { ok: true, value: state.count }
        }
        return { ok: true, value: true }
      }
    }
    isDestroyed = () => state.destroyed
    destroy = () => {
      state.destroyed = true
    }
    loadURL = async () => {
      state.commands.push({ name: 'load' })
    }
    setOpacity = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    showInactive = vi.fn()
  }
}))
const { captureSlidesAsPngs } = await import('./artifact-window')

beforeEach(() => {
  state.commands = []
  state.png = testSlidePng()
  state.destroyed = false
  state.attached = false
  state.count = 2
  state.validationError = ''
  state.hangCapture = false
  state.callbacks = []
})

describe('captura HTML 4K', () => {
  it('fija DPR4 antes de cargar y entrega una captura exacta antes de pedir la siguiente', async () => {
    const count = await captureSlidesAsPngs('<section class="slide"></section>', 'Deck', async (png, i) => {
      expect(state.commands.filter((c) => c.name === 'Page.captureScreenshot')).toHaveLength(i + 1)
      expect(png.equals(state.png)).toBe(true)
      state.callbacks.push(i)
    })
    expect(count).toBe(2)
    expect(state.callbacks).toEqual([0, 1])
    expect(state.commands.slice(0, 3)).toEqual([
      {
        name: 'Emulation.setDeviceMetricsOverride',
        args: { width: 960, height: 540, deviceScaleFactor: 4, mobile: false, screenWidth: 960, screenHeight: 540 }
      },
      { name: 'Emulation.setEmulatedMedia', args: { media: 'print' } },
      { name: 'load' }
    ])
    expect(state.destroyed).toBe(true)
    expect(state.attached).toBe(false)
  })
  it('rechaza una captura de menor resolución antes de escribir y limpia la ventana', async () => {
    state.png = testSlidePng(1920, 1080)
    const write = vi.fn()
    await expect(captureSlidesAsPngs('<section class="slide"></section>', 'Deck', write)).rejects.toThrow(
      '1920×1080; se requieren 3840×2160'
    )
    expect(write).not.toHaveBeenCalled()
    expect(state.destroyed).toBe(true)
    expect(state.attached).toBe(false)
  })
  it('no exporta documentos fuera del contrato como una sola captura', async () => {
    state.validationError = 'Presentación HTML inválida: falta al menos un elemento .slide.'
    await expect(captureSlidesAsPngs('<p>Documento</p>', 'Deck', vi.fn())).rejects.toThrow('falta al menos un elemento .slide')
    expect(state.commands.some((c) => c.name === 'Page.captureScreenshot')).toBe(false)
    expect(state.destroyed).toBe(true)
  })
  it('propaga errores de escritura y limpia la captura', async () => {
    await expect(
      captureSlidesAsPngs('<section class="slide"></section>', 'Deck', async () => {
        throw new Error('disco lleno')
      })
    ).rejects.toThrow('disco lleno')
    expect(state.destroyed).toBe(true)
    expect(state.attached).toBe(false)
  })
  it('mantiene el plazo máximo incluso si Chromium no devuelve la captura', async () => {
    vi.useFakeTimers()
    try {
      state.hangCapture = true
      const pending = expect(captureSlidesAsPngs('<section class="slide"></section>', 'Deck', vi.fn())).rejects.toThrow(
        'tiempo máximo de 30 segundos'
      )
      await vi.advanceTimersByTimeAsync(30_000)
      await pending
      expect(state.destroyed).toBe(true)
      expect(state.attached).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
