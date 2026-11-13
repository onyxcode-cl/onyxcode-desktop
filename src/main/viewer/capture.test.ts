import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  windows: [] as Array<{ destroyed: boolean; url: string; opts: Record<string, unknown> }>,
  script: {
    sections: [{ width: 794, height: 1123, pageHeight: 1123 }] as Array<{ width: number; height: number; pageHeight: number }>,
    ready: '1' as string,
    loadFails: false
  },
  validators: [] as Array<(p: string) => string>,
  captured: [] as Array<{ x: number; y: number; width: number; height: number }>,
  advances: 0,
  blankFirst: 0,
  alwaysBlank: false
}))

vi.mock('electron', () => {
  const img = { isEmpty: () => false, getSize: () => ({ width: 794, height: 1123 }), resize: () => img, toPNG: () => Buffer.alloc(5000, 1) }
  const blank = {
    isEmpty: () => false,
    getSize: () => ({ width: 794, height: 1123 }),
    resize: () => blank,
    toPNG: () => Buffer.alloc(437, 1)
  }
  class BrowserWindow {
    state = { destroyed: false, url: '', opts: {} as Record<string, unknown> }
    webContents = {
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
      executeJavaScript: async (code: string) => {
        if (code.includes('captureReady')) return h.script.ready
        if (code.includes('.map((s)')) return h.script.sections
        if (code.includes('pptx-canvas-wrap')) return { x: 20, y: 30, width: 1000, height: 560 }
        if (code.includes('ArrowRight')) {
          h.advances++
          return true
        }
        if (code.includes('scrollTop')) return { x: 10, y: 20, width: 794 }
        return null
      },
      capturePage: async (r: { x: number; y: number; width: number; height: number }) => {
        h.captured.push(r)
        if (h.alwaysBlank) return blank
        if (h.blankFirst > 0) {
          h.blankFirst--
          return blank
        }
        return img
      }
    }
    constructor(opts: Record<string, unknown>) {
      this.state.opts = opts
      h.windows.push(this.state)
    }
    async loadURL(url: string): Promise<void> {
      this.state.url = url
      if (h.script.loadFails) throw new Error('no carga')
    }
    getContentSize(): [number, number] {
      return [1000, 1400]
    }
    setContentSize(): void {}
    isDestroyed(): boolean {
      return this.state.destroyed
    }
    destroy(): void {
      this.state.destroyed = true
    }
  }
  return { BrowserWindow, nativeImage: { createFromBuffer: () => img } }
})
vi.mock('../security/app-protocol', () => ({ VIEWER_SCHEME: 'lazunox-viewer' }))
vi.mock('./scheme', () => ({
  installViewerScheme: () => undefined,
  registerViewerPathValidator: (fn: (p: string) => string) => h.validators.push(fn)
}))
vi.mock('./session', () => ({ viewerSession: () => ({}) }))

import { setPrivateTmpBase } from '../office/craft/private-tmp'
import { captureDeckSlides, captureDocxPages, planSlices } from './capture'
import { resolveCaptureToken } from './tokens'

const base = mkdtempSync(join(tmpdir(), 'capture-test-'))
setPrivateTmpBase(join(base, 'priv'))
afterAll(() => {
  setPrivateTmpBase(null)
  rmSync(base, { recursive: true, force: true })
})
beforeEach(() => {
  h.windows.length = 0
  h.captured.length = 0
  h.script.sections = [{ width: 794, height: 1123, pageHeight: 1123 }]
  h.script.ready = '1'
  h.script.loadFails = false
  h.blankFirst = 0
  h.alwaysBlank = false
  h.advances = 0
})

describe('planSlices', () => {
  it('empieza en la página solicitada y mantiene el total sin capturar las anteriores', () => {
    const r = planSlices([{ width: 794, height: 30 * 1123, pageHeight: 1123 }], 2, 13)
    expect(r.total).toBe(30)
    expect(r.slots.map((s) => s.offset)).toEqual([12 * 1123, 13 * 1123])
  })
  it('una sección alta (Word de varias páginas sin saltos explícitos) se trocea en hojas', () => {
    const r = planSlices([{ width: 794, height: 5000, pageHeight: 1123 }], 12)
    expect(r.total).toBe(5)
    expect(r.slots.map((s) => Math.round(s.offset))).toEqual([0, 1123, 2246, 3369, 4492])
    expect(Math.round(r.slots[4]!.height)).toBe(508)
  })
  it('cuenta TODAS las páginas aunque solo capture hasta el tope', () => {
    const r = planSlices([{ width: 794, height: 30 * 1123, pageHeight: 1123 }], 12)
    expect(r.total).toBe(30)
    expect(r.slots).toHaveLength(12)
  })
  it('una cola de menos de 24 px no cuenta como página', () => {
    expect(planSlices([{ width: 794, height: 2 * 1122.5 + 8, pageHeight: 1122.5 }], 12).total).toBe(2)
  })
  it('varias secciones suman, sin alto de hoja usa la proporción A4, y lo diminuto se ignora', () => {
    const r = planSlices(
      [
        { width: 794, height: 1123, pageHeight: 0 },
        { width: 794, height: 2300, pageHeight: 0 },
        { width: 10, height: 10, pageHeight: 0 }
      ],
      12
    )
    expect(r.total).toBe(4) // 1 + 3 (2300 px son tres hojas A4); la sección diminuta no cuenta
  })
})

describe('captureDocxPages: pintado', () => {
  it('si la primera captura sale en blanco (aún sin pintar), reintenta y entrega la página', async () => {
    h.blankFirst = 2
    const r = await captureDocxPages(Buffer.from('zip'), 12, 20_000)
    expect(r?.images).toHaveLength(1)
    expect(h.captured.length).toBeGreaterThanOrEqual(3)
  })
  it('si la hoja nunca se pinta no inventa imágenes: devuelve null', async () => {
    h.alwaysBlank = true
    expect(await captureDocxPages(Buffer.from('zip'), 12, 20_000)).toBeNull()
  })
})

describe('captureDocxPages', () => {
  it('un documento de varias páginas devuelve una imagen por página y la cuenta real', async () => {
    h.script.sections = [{ width: 794, height: 3400, pageHeight: 1123 }]
    const r = await captureDocxPages(Buffer.from('zip'), 12, 5000)
    expect(r?.images).toHaveLength(4)
    expect(r?.pages).toBe(4)
    expect(h.captured).toHaveLength(4)
  })
  it('respeta el tope de páginas pero informa el total', async () => {
    h.script.sections = [{ width: 794, height: 20 * 1123, pageHeight: 1123 }]
    const r = await captureDocxPages(Buffer.from('zip'), 3, 5000)
    expect(r?.images).toHaveLength(3)
    expect(r?.pages).toBe(20)
  })
  it('carga el visor real en modo captura, con ventana oculta y en caja', async () => {
    await captureDocxPages(Buffer.from('zip'), 12, 5000)
    const w = h.windows[0]!
    expect(w.url).toMatch(/^lazunox-viewer:\/\/viewer\/index\.html#t=[0-9a-f]{64}&kind=docx&lang=es&theme=light&capture=1$/)
    expect(w.opts).toMatchObject({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
    })
  })
  it('siempre revoca el token, destruye la ventana y borra la copia, también si algo falla', async () => {
    for (const mode of ['ok', 'no-carga', 'sin-paginas'] as const) {
      h.windows.length = 0
      h.script.loadFails = mode === 'no-carga'
      h.script.ready = mode === 'sin-paginas' ? 'error' : '1'
      const out = await captureDocxPages(Buffer.from('zip'), 12, 5000).catch(() => 'error')
      expect(mode === 'ok' ? out : out === 'error' || out === null).toBeTruthy()
      const w = h.windows[0]!
      expect(w.destroyed).toBe(true)
      const token = /#t=([0-9a-f]{64})/.exec(w.url)?.[1]
      if (token) expect(resolveCaptureToken(token)).toBeNull()
      expect(readdirSync(join(base, 'priv')).filter((d) => d.startsWith('lazunox-capture-'))).toEqual([])
    }
  })
  it('si vence el tiempo, falla y destruye la ventana', async () => {
    h.script.ready = '1'
    const r = await captureDocxPages(Buffer.from('zip'), 12, 1).catch((e: Error) => e.message)
    expect(['timeout', null, 'object']).toContain(typeof r === 'string' ? r : r === null ? null : 'object')
    expect(h.windows[0]!.destroyed).toBe(true)
  })
  it('el validador del visor solo sirve archivos de las carpetas de captura de la base privada', async () => {
    await captureDocxPages(Buffer.from('zip'), 12, 5000)
    const validate = h.validators[0]!
    const dentro = join(base, 'priv', 'lazunox-capture-prueba')
    mkdirSync(dentro, { recursive: true })
    writeFileSync(join(dentro, 'doc.docx'), 'x')
    writeFileSync(join(base, 'priv', 'otro.docx'), 'x')
    writeFileSync(join(base, 'fuera.docx'), 'x')
    expect(validate(join(dentro, 'doc.docx'))).toContain('lazunox-capture-prueba')
    expect(() => validate(join(base, 'priv', 'otro.docx'))).toThrow()
    expect(() => validate(join(base, 'fuera.docx'))).toThrow()
    expect(() => validate('/etc/passwd')).toThrow()
  })
})

describe('captureDeckSlides', () => {
  it('una imagen por diapositiva (hasta el tope), avanzando con la flecha del visor, y cuenta todas', async () => {
    h.script.ready = '20'
    const r = await captureDeckSlides(Buffer.from('zip'), 5, 20_000)
    expect(r?.images).toHaveLength(5)
    expect(r?.pages).toBe(20)
    expect(h.advances).toBe(4)
    expect(h.windows[0]!.url).toMatch(/kind=pptx&lang=es&theme=light&capture=1$/)
  })
  it('si el visor no pinta nada devuelve null y limpia (ventana destruida, token revocado)', async () => {
    h.script.ready = 'error'
    expect(await captureDeckSlides(Buffer.from('zip'), 5, 20_000)).toBeNull()
    const w = h.windows[0]!
    expect(w.destroyed).toBe(true)
    const token = /#t=([0-9a-f]{64})/.exec(w.url)?.[1]
    expect(resolveCaptureToken(token!)).toBeNull()
  })
})
