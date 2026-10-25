// @vitest-environment jsdom
// Diálogo «Volver a antes de este turno»: modos, revisión previa, casillas desmarcadas, sin git, bloqueos, 404 y accesibilidad.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RewindMode, RewindOutcome, RewindReview, RewindReviewResult } from '@shared/rewind'
import { useLang } from '../../../lib/i18n'
import { RewindDialog } from './RewindDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const review = (over: Partial<RewindReview> = {}): RewindReview => ({
  archivos: [
    { file: 'a.txt', status: 'modified', additions: 1, deletions: 1, origen: 'herramienta' },
    { file: 'b.txt', status: 'modified', additions: 1, deletions: 1, origen: 'comando' },
    { file: '.mcp.json', status: 'modified', additions: 1, deletions: 0, origen: 'herramienta' }
  ],
  conflictos: ['b.txt'],
  protegidos: ['.mcp.json'],
  comandos: true,
  commitsDespues: [{ hash: 'abc123def456', asunto: 'Ajusta [algo](http://evil.example)' }],
  ayudantesActivos: [],
  mensajes: 6,
  restaurable: true,
  ...over
})

const okReview = (over: Partial<RewindReview> = {}): RewindReviewResult => ({ ok: true, review: review(over) })
const done: RewindOutcome = {
  ok: true,
  result: { modo: 'todo', restaurados: ['a.txt'], borrados: [], omitidos: [], mensajesOcultos: 6, puedeDeshacer: true }
}

interface Spies {
  loadReview: ReturnType<typeof vi.fn>
  onConfirm: ReturnType<typeof vi.fn>
  onFallback: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}

async function mount(r: RewindReviewResult | Promise<RewindReviewResult> = okReview(), outcome: RewindOutcome = done): Promise<Spies> {
  const spies: Spies = {
    loadReview: vi.fn(async () => r),
    onConfirm: vi.fn(async (_m: RewindMode, _o: readonly string[]) => outcome),
    onFallback: vi.fn(),
    onClose: vi.fn()
  }
  await act(async () => root.render(createElement(RewindDialog, spies as never)))
  return spies
}

const radio = (v: string): HTMLInputElement => host.querySelector(`input[type="radio"][value="${v}"]`)!
const checkboxes = (): HTMLInputElement[] => [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
const button = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const click = async (el: Element): Promise<void> => {
  await act(async () => (el as HTMLElement).click())
}

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('accesibilidad', () => {
  it('es un diálogo modal con nombre, un grupo de radio y el foco en el primer radio', async () => {
    await mount()
    const dlg = host.querySelector('[role="dialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)?.textContent).toBe('Volver a antes de este turno')
    const group = host.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-label')).toBe('Qué volver atrás')
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3)
    expect(document.activeElement).toBe(radio('todo'))
    // Cada radio tiene su etiqueta y su explicación en llano.
    expect(group.textContent).toContain('Código y conversación')
    expect(group.textContent).toContain('Solo el código')
    expect(group.textContent).toContain('Solo la conversación')
  })
  it('Esc cancela', async () => {
    const s = await mount()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(s.onClose).toHaveBeenCalledTimes(1)
  })
  it('mientras revisa lo dice en una región `status` y no deja confirmar', async () => {
    let release!: (r: RewindReviewResult) => void
    await mount(new Promise<RewindReviewResult>((res) => (release = res)))
    expect(host.textContent).toContain('Revisando qué cambiaría…')
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.querySelector('input[type="radio"]')).toBeNull()
    await act(async () => release(okReview()))
    expect(host.textContent).not.toContain('Revisando')
  })
  it('en inglés', async () => {
    useLang.setState({ lang: 'en' })
    await mount()
    expect(host.querySelector('h2')?.textContent).toBe('Go back to before this turn')
    expect(host.textContent).toContain('Code only')
  })
})

describe('revisión previa', () => {
  it('muestra comandos, commits, conflictos y protegidos; los de riesgo llegan desmarcados', async () => {
    await mount()
    expect(host.textContent).toContain('Lo que hicieron los comandos fuera de la carpeta')
    expect(host.textContent).toContain('Los commits no se deshacen')
    expect(host.textContent).toContain('abc123def456')
    expect(host.textContent).toContain('cambiaron después de este turno')
    expect(host.textContent).toContain('configuración protegida')
    const boxes = checkboxes()
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => !b.checked)).toBe(true)
    expect(boxes[0].getAttribute('aria-label')).toBe('Restaurar también este archivo: b.txt')
  })
  it('el resumen cuenta solo lo que se restaurará y lo que se ocultará', async () => {
    await mount()
    // a.txt se restaura; b.txt (conflicto) y .mcp.json (protegido) se saltan.
    expect(host.textContent).toContain('Se restaurarán 1 archivo y se ocultarán 6 mensajes.')
    await click(checkboxes()[0])
    expect(host.textContent).toContain('Se restaurarán 2 archivos y se ocultarán 6 mensajes.')
  })
  it('cambia el resumen y el texto del botón según el modo', async () => {
    await mount()
    expect(button('Restaurar código y ocultar mensajes')).toBeTruthy()
    await click(radio('codigo'))
    expect(host.textContent).toContain('Se restaurarán 1 archivo. Los mensajes se quedan.')
    expect(button('Restaurar el código')).toBeTruthy()
    await click(radio('conversacion'))
    expect(host.textContent).toContain('Se ocultarán 6 mensajes. Ningún archivo cambia.')
    expect(button('Ocultar los mensajes')).toBeTruthy()
    // En «solo conversación» no se listan archivos ni casillas.
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
  })
  it('los nombres y asuntos son texto plano: nada de enlaces ni elementos nuevos', async () => {
    await mount(
      okReview({
        archivos: [{ file: '<a href="https://evil.example">x</a>.md', status: 'added', additions: 1, deletions: 0, origen: 'otro' }],
        conflictos: [],
        protegidos: []
      })
    )
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('<a href="https://evil.example">x</a>.md')
    expect(host.textContent).toContain('[algo](http://evil.example)')
  })
})

describe('confirmar', () => {
  it('«código y conversación» sin marcar nada: no manda sobrescribir', async () => {
    const s = await mount()
    await click(button('Restaurar código y ocultar mensajes'))
    expect(s.onConfirm).toHaveBeenCalledWith('todo', [])
    expect(s.onClose).toHaveBeenCalledTimes(1)
  })
  it('manda SOLO lo que la persona marcó', async () => {
    const s = await mount()
    await click(checkboxes()[1]) // .mcp.json
    await click(button('Restaurar código y ocultar mensajes'))
    expect(s.onConfirm).toHaveBeenCalledWith('todo', ['.mcp.json'])
  })
  it('«solo la conversación» nunca manda rutas a sobrescribir aunque se hubieran marcado antes', async () => {
    const s = await mount()
    await click(checkboxes()[0])
    await click(radio('conversacion'))
    await click(button('Ocultar los mensajes'))
    expect(s.onConfirm).toHaveBeenCalledWith('conversacion', [])
  })
  it('un 409 se explica en llano y el diálogo queda abierto', async () => {
    const s = await mount(okReview(), { ok: false, kind: 'conflict', motivo: 'pendiente', message: 'x' })
    await click(button('Restaurar código y ocultar mensajes'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Hay un permiso, una pregunta o un formulario esperando tu respuesta'
    )
    expect(s.onClose).not.toHaveBeenCalled()
  })
  it('un 404 al rebobinar vuelve al flujo antiguo', async () => {
    const s = await mount(okReview(), { ok: false, kind: 'unavailable' })
    await click(button('Restaurar código y ocultar mensajes'))
    expect(s.onFallback).toHaveBeenCalledTimes(1)
    expect(s.onClose).not.toHaveBeenCalled()
  })
  it('un error de red muestra el motivo', async () => {
    await mount(okReview(), { ok: false, kind: 'error', error: 'red caída' })
    await click(button('Restaurar código y ocultar mensajes'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo volver atrás: red caída')
  })
})

describe('carpeta sin git, bloqueos y motor viejo', () => {
  it('sin git: solo «Solo la conversación», lo dice y no promete deshacer archivos', async () => {
    const s = await mount(
      okReview({ restaurable: false, motivo: 'sin-git', archivos: [], conflictos: [], protegidos: [], comandos: false })
    )
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(1)
    expect(radio('conversacion').checked).toBe(true)
    expect(host.textContent).toContain('Esta carpeta no usa git')
    expect(host.textContent).toContain('Los archivos no se tocarán')
    expect(host.textContent).not.toContain('Se restaurarán')
    await click(button('Ocultar los mensajes'))
    expect(s.onConfirm).toHaveBeenCalledWith('conversacion', [])
  })
  it('caducado: solo conversación y lo explica', async () => {
    await mount(okReview({ restaurable: false, motivo: 'caducado' }))
    expect(host.textContent).toContain('ya caducó')
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  })
  it('bloqueado: lo explica y el botón de confirmar queda deshabilitado', async () => {
    await mount(
      okReview({ bloqueado: 'hija-ocupada', ayudantesActivos: [{ tipo: 'ayudante', id: 'ses_9', titulo: 'Revisor de pruebas' }] })
    )
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Un ayudante de esta conversación está trabajando')
    expect(host.textContent).toContain('Revisor de pruebas')
    expect(button('Restaurar código y ocultar mensajes').disabled).toBe(true)
  })
  it('motor sin las rutas (404 en la revisión): llama a onFallback y no muestra radios', async () => {
    const s = await mount({ ok: false, kind: 'unavailable' })
    expect(s.onFallback).toHaveBeenCalledTimes(1)
    expect(host.querySelector('input[type="radio"]')).toBeNull()
  })
  it('un fallo al revisar se muestra y no se puede confirmar', async () => {
    await mount({ ok: false, kind: 'error', error: 'boom' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo revisar lo que cambiaría: boom')
    expect(host.querySelector('input[type="radio"]')).toBeNull()
  })
})
