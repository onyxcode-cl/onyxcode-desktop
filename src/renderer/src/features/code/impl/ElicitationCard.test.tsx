// @vitest-environment jsdom
// Tarjeta de formulario de un conector: texto plano, cabecera fija, validación local, Esc, foco atrapado y accesibilidad.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ElicitationReplyResult, ElicitationRequest } from '@shared/mcp-elicitation'
import { useLang } from '../../../lib/i18n'
import { ElicitationCard, ElicitationNoticeRow, isTrustedConnector, type ElicitationCardProps } from './ElicitationCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const request = (over: Partial<ElicitationRequest> = {}): ElicitationRequest => ({
  id: 'eli_1',
  sessionID: 'ses_1',
  server: 'crm',
  message: 'Necesito algunos datos para crear el contacto.',
  expiresAt: new Date('2026-10-25T15:30:00').getTime(),
  fields: [
    { name: 'nombre', type: 'string', title: 'Nombre', required: true, maxLength: 80 },
    { name: 'edad', type: 'integer', title: 'Edad', required: false, minimum: 0, maximum: 120 },
    { name: 'activo', type: 'boolean', title: 'Contacto activo', required: false },
    {
      name: 'tipo',
      type: 'enum',
      title: 'Tipo',
      required: false,
      options: [
        { value: 'a', label: 'Cliente' },
        { value: 'b', label: 'Proveedor' }
      ]
    }
  ],
  ...over
})

type Submit = ElicitationCardProps['onSubmit']
const ok: ElicitationReplyResult = { ok: true }

async function mount(req: ElicitationRequest, onSubmit: Submit, extra: Partial<ElicitationCardProps> = {}): Promise<void> {
  await act(async () => root.render(createElement(ElicitationCard, { request: req, onSubmit, ...extra })))
}

const input = (label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  document.getElementById([...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.htmlFor) as never

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const button = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const key = (el: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(ev)
  return ev
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

describe('cabecera fija y texto plano', () => {
  it('lleva el nombre del conector, si es de confianza, cuándo caduca, y es un diálogo accesible con nombre y descripción', async () => {
    await mount(
      request(),
      vi.fn(async () => ok),
      { trusted: true }
    )
    const dlg = host.querySelector('[role="dialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)?.textContent).toBe('Formulario del conector crm')
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)?.textContent).toContain('crear el contacto')
    expect(dlg.textContent).toContain('Conector de confianza')
    expect(dlg.textContent).toContain('Lo pide el conector, no Lazunox')
    expect(dlg.textContent).toMatch(/Caduca a las \d{1,2}[:.]\d{2}/)
  })

  it('un conector sin marcar lo dice; sin dato de confianza (Chat) no dice nada', async () => {
    await mount(
      request(),
      vi.fn(async () => ok),
      { trusted: false }
    )
    expect(host.textContent).toContain('Conector sin marcar como de confianza')
    await mount(
      request(),
      vi.fn(async () => ok)
    )
    expect(host.textContent).not.toContain('de confianza')
  })

  it('el mensaje y las descripciones del conector son TEXTO: HTML, Markdown y enlaces se ven tal cual, sin elementos nuevos', async () => {
    const evil =
      'Pulsa <a href="https://evil.example">aquí</a> o [esto](https://evil.example) **ya** <img src=x onerror=alert(1)> <script>alert(1)</script>'
    await mount(
      request({
        server: '<b>crm</b>',
        message: evil,
        fields: [{ name: 'a', type: 'string', required: true, maxLength: 20, title: '**Nombre**', description: evil }]
      }),
      vi.fn(async () => ok)
    )
    expect(host.querySelector('a')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    expect(host.querySelector('strong, em')).toBeNull()
    expect(host.textContent).toContain('<a href="https://evil.example">aquí</a>')
    expect(host.textContent).toContain('[esto](https://evil.example)')
    expect(host.textContent).toContain('**Nombre**')
    expect(host.textContent).toContain('Formulario del conector <b>crm</b>')
    // Los saltos de línea del mensaje se respetan (pre-wrap), no se interpreta nada.
    const msg = host.querySelector('[role="dialog"] p.whitespace-pre-wrap')!
    expect(msg.children).toHaveLength(0)
  })

  it('el campo de contraseña no existe en la interfaz: ningún <input type="password"> y avisa que nunca se escriban claves', async () => {
    await mount(
      request(),
      vi.fn(async () => ok)
    )
    expect(host.querySelector('input[type="password"]')).toBeNull()
    expect(host.textContent).toContain('Nunca escribas aquí contraseñas ni claves')
  })
})

describe('campos: nada se rellena salvo el default', () => {
  it('todo vacío, casilla apagada y sin opción elegida', async () => {
    await mount(
      request(),
      vi.fn(async () => ok)
    )
    expect((input('Nombre') as HTMLInputElement).value).toBe('')
    expect((input('Edad') as HTMLInputElement).value).toBe('')
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
    expect((input('Tipo') as HTMLSelectElement).value).toBe('')
    expect(host.querySelector('input[autocomplete="off"]')).not.toBeNull()
  })

  it('con default del esquema, solo esos campos vienen rellenos', async () => {
    await mount(
      request({
        fields: [
          { name: 'a', type: 'string', title: 'A', required: false, maxLength: 20, default: 'hola' },
          { name: 'b', type: 'string', title: 'B', required: false, maxLength: 20 },
          { name: 'c', type: 'boolean', title: 'C', required: false, default: true }
        ]
      }),
      vi.fn(async () => ok)
    )
    expect((input('A') as HTMLInputElement).value).toBe('hola')
    expect((input('B') as HTMLInputElement).value).toBe('')
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
  })

  it('un string largo (maxLength > 200) usa área de texto y respeta el tope', async () => {
    await mount(
      request({ fields: [{ name: 'n', type: 'string', title: 'Notas', required: false, maxLength: 1000 }] }),
      vi.fn(async () => ok)
    )
    const ta = input('Notas') as HTMLTextAreaElement
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta.maxLength).toBe(1000)
  })
})

describe('validación local y envío', () => {
  it('con un obligatorio vacío NO envía, muestra el error (rol alert), marca el campo inválido y lleva el foco a él', async () => {
    vi.useFakeTimers()
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    await act(async () => button('Enviar a crm').click())
    expect(onSubmit).not.toHaveBeenCalled()
    const nombre = input('Nombre')
    expect(nombre.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Este dato es obligatorio.')
    expect(nombre.getAttribute('aria-describedby')).toContain(host.querySelector('[role="alert"]')!.id)
    await act(async () => vi.runAllTimers())
    expect(document.activeElement).toBe(nombre)
    vi.useRealTimers()
  })

  it('fuera de rango y entero inválido se explican; al corregirlos, envía', async () => {
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await type(input('Edad') as HTMLInputElement, '200')
    await act(async () => button('Enviar a crm').click())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.textContent).toContain('El máximo es 120.')
    await type(input('Edad') as HTMLInputElement, '3,5')
    expect(host.textContent).toContain('Escribe un número entero.')
    await type(input('Edad') as HTMLInputElement, '41')
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    })
    const sel = input('Tipo') as HTMLSelectElement
    await act(async () => {
      sel.value = 'b'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button('Enviar a crm').click())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('accept', { nombre: 'Ana', edad: 41, activo: true, tipo: 'b' })
  })

  it('los opcionales vacíos no viajan', async () => {
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await act(async () => button('Enviar a crm').click())
    expect(onSubmit).toHaveBeenCalledWith('accept', { nombre: 'Ana', activo: false })
  })

  it('«No enviar» manda decline sin contenido y sin validar', async () => {
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    await act(async () => button('No enviar').click())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('decline')
  })

  it('el botón principal nombra al conector y no se envía dos veces seguidas', async () => {
    let release: (r: ElicitationReplyResult) => void = () => {}
    const onSubmit = vi.fn(() => new Promise<ElicitationReplyResult>((r) => (release = r)))
    await mount(request(), onSubmit)
    expect(button('Enviar a crm')).toBeTruthy()
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await act(async () => button('Enviar a crm').click())
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(button('No enviar').disabled).toBe(true)
    await act(async () => release(ok))
  })

  it('400 del motor: la tarjeta queda abierta con el motivo en el campo y lo escrito se conserva', async () => {
    const onSubmit = vi.fn(async (): Promise<ElicitationReplyResult> => ({
      ok: false,
      invalid: [{ campo: 'nombre', motivo: 'ya existe' }]
    }))
    await mount(request(), onSubmit)
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await act(async () => button('Enviar a crm').click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain('El motor no aceptó este dato: ya existe')
    expect((input('Nombre') as HTMLInputElement).value).toBe('Ana')
    expect(button('Enviar a crm').disabled).toBe(false)
    // Al editar el campo se quita el motivo viejo.
    await type(input('Nombre') as HTMLInputElement, 'Ana M')
    expect(host.textContent).not.toContain('ya existe')
  })

  it('400 sin detalle por campo o error de red: mensaje general y la tarjeta sigue abierta', async () => {
    await mount(
      request(),
      vi.fn(async (): Promise<ElicitationReplyResult> => ({ ok: false, invalid: [] }))
    )
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await act(async () => button('Enviar a crm').click())
    expect(host.textContent).toContain('El motor no aceptó el contenido')
    await act(async () => root.render(null))
    await mount(
      request({ id: 'eli_2' }),
      vi.fn(async (): Promise<ElicitationReplyResult> => ({ ok: false, error: 'sin red' })),
      { trusted: true }
    )
    await type(input('Nombre') as HTMLInputElement, 'Ana')
    await act(async () => button('Enviar a crm').click())
    expect(host.textContent).toContain('No se pudo enviar: sin red')
  })
})

describe('Esc cancela; el foco queda dentro', () => {
  it('Esc manda cancel, no se propaga a quien escucha fuera (no detiene la ejecución) y no valida', async () => {
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    const outside = vi.fn()
    document.body.addEventListener('keydown', outside)
    const ev = key(input('Nombre'), 'Escape')
    document.body.removeEventListener('keydown', outside)
    expect(ev.defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledWith('cancel')
    expect(outside).not.toHaveBeenCalled()
  })

  it('Esc durante la composición de un IME no cancela', async () => {
    const onSubmit = vi.fn(async () => ok)
    await mount(request(), onSubmit)
    key(input('Nombre'), 'Escape', { isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('al abrirse, el foco entra al primer campo', async () => {
    await mount(
      request(),
      vi.fn(async () => ok)
    )
    expect(document.activeElement).toBe(input('Nombre'))
  })

  it('sin campos, el foco entra al botón principal', async () => {
    await mount(
      request({ fields: [] }),
      vi.fn(async () => ok)
    )
    expect(host.textContent).toContain('Este formulario no pide ningún dato.')
    expect(document.activeElement).toBe(button('Enviar a crm'))
  })

  it('Tab desde el último control da la vuelta al primero y Mayús+Tab desde el primero al último', async () => {
    await mount(
      request(),
      vi.fn(async () => ok)
    )
    const items = [...host.querySelectorAll<HTMLElement>('input, select, textarea, button')]
    items.at(-1)!.focus()
    const forward = key(items.at(-1)!, 'Tab')
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(items[0])
    const back = key(items[0], 'Tab', { shiftKey: true })
    expect(back.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(items.at(-1))
  })
})

describe('ayudas y avisos', () => {
  it('formatos y rangos se anuncian como descripción del campo', async () => {
    await mount(
      request({
        fields: [
          { name: 'f', type: 'string', title: 'Fecha', required: false, maxLength: 20, format: 'date', description: 'Cuándo' },
          { name: 'n', type: 'number', title: 'Monto', required: false, minimum: 1, maximum: 9 }
        ]
      }),
      vi.fn(async () => ok)
    )
    const f = input('Fecha')
    expect(document.getElementById(f.getAttribute('aria-describedby')!)?.textContent).toBe('Cuándo\nFormato AAAA-MM-DD')
    expect(document.getElementById(input('Monto').getAttribute('aria-describedby')!)?.textContent).toBe('Entre 1 y 9')
  })

  it('isTrustedConnector: de confianza en Ajustes, o interno de la app', () => {
    expect(isTrustedConnector('crm', ['crm'])).toBe(true)
    expect(isTrustedConnector('crm', ['otro'])).toBe(false)
    expect(isTrustedConnector('mi_crm', ['mi crm'])).toBe(true) // el motor sanea el nombre
    expect(isTrustedConnector('browser', [])).toBe(true)
  })

  it('el aviso es texto fijo de Lazunox (nunca del conector), con rol status y botón de cerrar', async () => {
    const dismiss = vi.fn()
    await act(async () =>
      root.render(createElement(ElicitationNoticeRow, { notice: { id: 'e', sessionID: 's', reason: 'secret' }, onDismiss: dismiss }))
    )
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Lazunox no envía contraseñas ni claves por formularios de conectores'
    )
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]')!.click())
    expect(dismiss).toHaveBeenCalled()
    for (const reason of ['schema', 'ambiguous', 'timeout'] as const) {
      await act(async () =>
        root.render(createElement(ElicitationNoticeRow, { notice: { id: 'e', sessionID: 's', reason }, onDismiss: dismiss }))
      )
      expect(host.textContent!.length).toBeGreaterThan(20)
    }
  })
})
