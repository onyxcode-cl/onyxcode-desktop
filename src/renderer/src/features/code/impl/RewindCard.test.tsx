// @vitest-environment jsdom
// «Cambios de este turno» y aviso de «volviste atrás»: lista con +/− en texto, origen, avisos honestos, diff bajo demanda y texto plano.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TurnDiffResult, TurnSummary } from '@shared/rewind'
import { useLang } from '../../../lib/i18n'
import { RewindCard, RewindResultNotice } from './RewindCard'
import type { RewindNotice } from './rewind-logic'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const summary = (over: Partial<TurnSummary> = {}): TurnSummary => ({
  messageID: 'msg_1',
  time: 1,
  restaurable: true,
  truncated: false,
  files: [
    { file: 'src/a.ts', status: 'modified', additions: 30, deletions: 10, origen: 'herramienta' },
    { file: 'b.txt', status: 'added', additions: 10, deletions: 0, origen: 'herramienta' },
    { file: 'old.log', status: 'deleted', additions: 0, deletions: 2, origen: 'otro' }
  ],
  ...over
})

const okDiff = (file: string, patch = '@@ -1 +1 @@\n-a\n+b\n'): TurnDiffResult => ({
  ok: true,
  diff: { file, status: 'modified', additions: 1, deletions: 1, patch, binary: false, truncated: false }
})

async function mount(props: Partial<Parameters<typeof RewindCard>[0]> = {}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(RewindCard, { summary: summary(), loadDiff: vi.fn(async (f: string) => okDiff(f)), onRewind: vi.fn(), ...props })
    )
  )
}

const click = async (el: Element): Promise<void> => {
  await act(async () => (el as HTMLElement).click())
}
const header = (): HTMLButtonElement => host.querySelector('section > button')!
const byText = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!

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

describe('tarjeta plegada', () => {
  it('muestra «Cambios de este turno · 3 archivos · +40 −12» y está plegada', async () => {
    await mount()
    expect(header().textContent).toContain('Cambios de este turno')
    expect(header().textContent).toContain('3 archivos')
    expect(header().textContent).toContain('+40 −12')
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('ul')).toBeNull()
    // Texto completo para lectores de pantalla (el color no es la única señal).
    expect(header().textContent).toContain('40 líneas añadidas, 12 quitadas')
  })
  it('sin archivos no pinta nada', async () => {
    await mount({ summary: summary({ files: [] }) })
    expect(host.querySelector('section')).toBeNull()
  })
  it('en inglés', async () => {
    useLang.setState({ lang: 'en' })
    await mount()
    expect(header().textContent).toContain('Changes in this turn')
    expect(header().textContent).toContain('3 files')
  })
})

describe('lista abierta', () => {
  it('cada archivo lleva +/−, estado y origen en texto', async () => {
    await mount()
    await click(header())
    expect(header().getAttribute('aria-expanded')).toBe('true')
    const rows = [...host.querySelectorAll('ul > li')]
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('src/a.ts')
    expect(rows[0].textContent).toContain('+30 −10')
    expect(rows[0].textContent).toContain('modificado')
    expect(rows[0].textContent).toContain('editado por el agente')
    expect(rows[1].textContent).toContain('nuevo')
    expect(rows[2].textContent).toContain('borrado')
    expect(rows[2].textContent).toContain('otro origen')
  })

  it('avisa con honestidad cuando hay archivos hechos por comandos', async () => {
    await mount({
      summary: summary({ files: [{ file: 'out.txt', status: 'added', additions: 1, deletions: 0, origen: 'comando' }] })
    })
    await click(header())
    expect(host.textContent).toContain('Los cambios hechos por comandos de la terminal pueden no aparecer completos.')
  })
  it('sin archivos de comando no muestra ese aviso; con «otro origen» avisa que pueden ser cambios ajenos', async () => {
    await mount({ summary: summary({ files: [{ file: 'a', status: 'added', additions: 1, deletions: 0, origen: 'herramienta' }] }) })
    await click(header())
    expect(host.textContent).not.toContain('comandos de la terminal')
    expect(host.textContent).not.toContain('otro origen')
    await mount()
    expect(host.textContent).toContain('«otro origen»')
  })
  it('dice si hay más archivos que los mostrados y por qué no se pueden restaurar los archivos', async () => {
    await mount({ summary: summary({ truncated: true, restaurable: false, motivo: 'sin-git' }) })
    await click(header())
    expect(host.textContent).toContain('Hay más archivos de los que se muestran.')
    expect(host.textContent).toContain('Esta carpeta no usa git')
  })
  it('«Volver a antes de este turno…» abre el diálogo; deshabilitado si la conversación trabaja', async () => {
    const onRewind = vi.fn()
    await mount({ onRewind })
    await click(header())
    await click(byText('Volver a antes de este turno'))
    expect(onRewind).toHaveBeenCalledTimes(1)
    await mount({ onRewind, disabled: true })
    expect(byText('Volver a antes de este turno').disabled).toBe(true)
  })
})

describe('parche bajo demanda', () => {
  it('se pide solo al abrir el archivo y se pinta con DiffView', async () => {
    const loadDiff = vi.fn(async (f: string) => okDiff(f))
    await mount({ loadDiff })
    await click(header())
    expect(loadDiff).not.toHaveBeenCalled()
    await click(host.querySelector('ul > li button')!)
    expect(loadDiff).toHaveBeenCalledWith('src/a.ts')
    expect(host.querySelector('ul > li [id]')?.textContent).toContain('+b')
    // Cerrar y volver a abrir no lo pide otra vez.
    await click(host.querySelector('ul > li button')!)
    await click(host.querySelector('ul > li button')!)
    expect(loadDiff).toHaveBeenCalledTimes(1)
  })
  it('error y caducado se dicen con un aviso; se puede reintentar', async () => {
    const loadDiff = vi
      .fn<(f: string) => Promise<TurnDiffResult>>()
      .mockResolvedValueOnce({ ok: false, kind: 'conflict', motivo: 'caducado', message: '' })
      .mockResolvedValueOnce({ ok: false, kind: 'error', error: 'x' })
    await mount({ loadDiff })
    await click(header())
    await click(host.querySelector('ul > li button')!)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('ya caducó')
    await click(host.querySelector('ul > li button')!) // cerrar
    await click(host.querySelector('ul > li button')!) // reintentar
    expect(loadDiff).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar el parche')
  })
  it('un archivo binario no intenta pintar un diff', async () => {
    const loadDiff = vi.fn(async (f: string): Promise<TurnDiffResult> => ({
      ok: true,
      diff: { file: f, status: 'modified', additions: 0, deletions: 0, patch: '', binary: true, truncated: false }
    }))
    await mount({ loadDiff })
    await click(header())
    await click(host.querySelector('ul > li button')!)
    expect(host.textContent).toContain('Archivo binario')
  })
})

describe('texto plano', () => {
  it('nombres con HTML, Markdown o enlaces se ven tal cual, sin elementos nuevos', async () => {
    const evil = '[x](https://evil.example)<img src=x onerror=alert(1)><a href="https://evil.example">y</a>.md'
    await mount({ summary: summary({ files: [{ file: evil, status: 'added', additions: 1, deletions: 0, origen: 'otro' }] }) })
    await click(header())
    expect(host.querySelector('a')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain(evil)
  })
})

describe('aviso tras volver atrás', () => {
  const notice = (over: Partial<RewindNotice> = {}): RewindNotice => ({
    kind: 'done',
    modo: 'todo',
    restaurados: 2,
    borrados: 1,
    mensajesOcultos: 4,
    omitidos: [],
    puedeDeshacer: true,
    ...over
  })
  const mountNotice = async (n: RewindNotice, extra: Partial<Parameters<typeof RewindResultNotice>[0]> = {}): Promise<void> => {
    await act(async () => root.render(createElement(RewindResultNotice, { notice: n, onUndo: vi.fn(), onDismiss: vi.fn(), ...extra })))
  }

  it('es una región `status` con las cifras y el botón «Deshacer»', async () => {
    const onUndo = vi.fn()
    await mountNotice(notice(), { onUndo })
    const st = host.querySelector('[role="status"]')!
    expect(st.textContent).toContain('Archivos restaurados: 2')
    expect(st.textContent).toContain('Archivos borrados: 1')
    expect(st.textContent).toContain('Mensajes ocultos: 4')
    await click(byText('Deshacer'))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
  it('solo conversación: dice que ningún archivo cambió', async () => {
    await mountNotice(notice({ modo: 'conversacion', restaurados: 0, borrados: 0 }))
    expect(host.textContent).toContain('Ningún archivo cambió')
  })
  it('sin `puedeDeshacer` o tras deshacer no ofrece «Deshacer»', async () => {
    await mountNotice(notice({ puedeDeshacer: false }))
    expect(host.textContent).not.toContain('Deshacer')
    await mountNotice(notice({ kind: 'undone', puedeDeshacer: false }))
    expect(host.textContent).toContain('Se deshizo el rebobinado')
  })
  it('lista los omitidos con su motivo en llano y en texto plano', async () => {
    await mountNotice(
      notice({
        omitidos: [
          { file: 'src/x.ts', motivo: 'conflicto' },
          { file: '.mcp.json', motivo: 'protegido' },
          { file: '<b>raro</b>', motivo: '__proto__' }
        ]
      })
    )
    expect(host.textContent).toContain('No se tocaron 3 archivos')
    expect(host.textContent).toContain('src/x.ts (cambió después de este turno)')
    expect(host.textContent).toContain('.mcp.json (ruta protegida)')
    // Un motivo desconocido (incluso uno malicioso) cae en «otro motivo» y el nombre no genera elementos.
    expect(host.textContent).toContain('<b>raro</b> (otro motivo)')
    expect(host.querySelector('b')).toBeNull()
  })
  it('«Cerrar aviso» lo descarta', async () => {
    const onDismiss = vi.fn()
    await mountNotice(notice(), { onDismiss })
    await click(host.querySelector('button[aria-label="Cerrar aviso"]')!)
    expect(onDismiss).toHaveBeenCalled()
  })
})
