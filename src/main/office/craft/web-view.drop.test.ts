import { describe, expect, it } from 'vitest'
import { dropScript } from './web-view'

describe('dropScript', () => {
  it('mete el archivo como datos JSON (no como código) y espera al motor', () => {
    const evil = "');alert(1);('"
    const s = dropScript('QUJD', evil, 'application/x-test')
    expect(s).toContain(JSON.stringify(evil))
    expect(s).toContain('TrunkApplicationStarted')
    expect(s).toContain('new DragEvent(t, o)')
    expect(s).toContain('"QUJD"')
  })

  /** Ejecuta el script en un contexto falso (sin Electron) y devuelve lo que responde. */
  const run = async (script: string, wasmReady: boolean, overrides: Record<string, unknown> = {}): Promise<unknown> => {
    const { runInNewContext } = await import('node:vm')
    const ctx = {
      window: wasmReady ? { wasmBindings: {} } : {},
      addEventListener: () => undefined,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 1),
      cancelAnimationFrame: clearTimeout,
      document: { querySelector: () => null },
      innerWidth: 1,
      innerHeight: 1,
      ...overrides
    }
    return runInNewContext(script, ctx) as Promise<unknown>
  }

  it('si el motor wasm nunca arranca, se rinde y devuelve false (no espera para siempre)', async () => {
    expect(await run(dropScript('QUJD', 'a.docx', 'application/x-test', 30), false)).toBe(false)
  })

  it('con el motor listo no se queda colgado (sin lienzo devuelve false)', async () => {
    expect(await run(dropScript('QUJD', 'a.docx', 'application/x-test', 30), true)).toBe(false)
  })

  it('vence incluso si el navegador deja de entregar cuadros de animación', async () => {
    expect(await run(dropScript('QUJD', 'a.docx', 'application/x-test', 30), true, { requestAnimationFrame: () => 1 })).toBe(false)
  })

  it('espera un lienzo con dimensiones útiles antes de entregar el archivo y despacha el drop una sola vez', async () => {
    const events: Array<{ type: string; dataTransfer: { items: { files: File[] } } }> = []
    const canvas = {
      clientWidth: 0,
      clientHeight: 0,
      width: 0,
      height: 0,
      dispatchEvent: (event: (typeof events)[number]) => events.push(event)
    }
    let probes = 0
    const result = await run(dropScript('QUJD', 'a.docx', 'application/x-test', 200), true, {
      document: {
        querySelector: () => {
          probes++
          if (probes === 1) return null
          if (probes === 3) {
            expect(events).toEqual([])
            Object.assign(canvas, { clientWidth: 600, clientHeight: 400, width: 1200, height: 800 })
          }
          return canvas
        }
      },
      atob,
      File,
      DataTransfer: class {
        items = {
          files: [] as File[],
          add(file: File) {
            this.files.push(file)
          }
        }
      },
      DragEvent: class {
        constructor(
          public type: string,
          options: object
        ) {
          Object.assign(this, options)
        }
      }
    })
    expect(result).toBe(true)
    expect(probes).toBe(3)
    expect(events.map((event) => event.type)).toEqual(['dragenter', 'dragover', 'drop'])
    const file = events[2]!.dataTransfer.items.files[0]!
    expect(file.name).toBe('a.docx')
    expect(await file.text()).toBe('ABC')
  })
})
