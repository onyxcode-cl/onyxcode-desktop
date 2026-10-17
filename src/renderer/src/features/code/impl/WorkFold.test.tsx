// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { setLang } from '@shared/i18n'
import { useLang } from '../../../lib/i18n'
import type { ReadingMode } from '../../../lib/reading-mode'
import { ToolRow } from './ToolCard'
import { WorkFold } from './WorkFold'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  setLang('es')
  useLang.setState({ lang: 'es' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const T0 = 1_760_000_000_000
function tool(id: string, name: string, input: Record<string, unknown>, status = 'completed', at = 0, secs = 2): ToolPart {
  const time = { start: T0 + at * 1000, end: T0 + (at + secs) * 1000 }
  const state =
    status === 'completed'
      ? { status, input, output: 'salida', title: name, metadata: {}, time }
      : status === 'error'
        ? { status, input, error: 'No se pudo', time }
        : status === 'pending'
          ? { status, input, raw: '' }
          : { status, input, time: { start: time.start } }
  return { id, sessionID: 's', messageID: 'm', type: 'tool', callID: `c_${id}`, tool: name, state } as unknown as ToolPart
}

const read1 = tool('a', 'read', { filePath: '/p/uno.ts' }, 'completed', 0)
const read2 = tool('b', 'read', { filePath: '/p/dos.ts' }, 'completed', 2)
const edit1 = tool('c', 'edit', { filePath: '/p/uno.ts', oldString: 'a', newString: 'b' }, 'completed', 4)

function mount(opts: { live?: boolean; view?: ReadingMode; tools?: ToolPart[]; attention?: ToolPart[] } = {}): void {
  const tools = opts.tools ?? [read1, read2, edit1]
  const row = (p: ToolPart): React.JSX.Element => <ToolRow key={p.id} part={p} root="/p" />
  act(() =>
    root.render(
      createElement(WorkFold, {
        parts: tools,
        tools,
        live: opts.live ?? false,
        view: opts.view ?? 'summary',
        root: '/p',
        attention: opts.attention ?? [],
        renderStep: row,
        renderList: () => tools.map(row)
      })
    )
  )
}
const header = (): HTMLButtonElement => host.querySelector('button[aria-expanded]') as HTMLButtonElement
const status = (): string => host.querySelector('[role="status"]')?.textContent ?? ''

describe('WorkFold', () => {
  it('terminado y Resumida: una sola línea con el tiempo real y los pasos, plegada', () => {
    mount()
    expect(header().textContent).toContain('Trabajó durante 6 s · 3 pasos')
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).not.toContain('uno.ts')
    expect(host.querySelector('.animate-spin')).toBeNull()
  })

  it('al abrirla sale una línea por paso, cada una abre su detalle', () => {
    mount()
    act(() => header().click())
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(header().getAttribute('aria-controls')).toBeTruthy()
    const text = host.textContent ?? ''
    expect(text).toContain('Leyó')
    expect(text).toContain('uno.ts')
    expect(text).toContain('dos.ts')
    expect(text).toContain('Editó')
    expect(host.textContent).not.toContain('salida')
    const row = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('dos.ts'))
    act(() => row?.click())
    expect(host.textContent).toContain('salida')
  })

  it('en vivo está abierta y animada con el giro que no se apaga con movimiento reducido', () => {
    mount({ live: true, tools: [read1, tool('r', 'bash', { command: 'ls' }, 'running', 4)] })
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(header().textContent).toContain('Trabajando…')
    expect(header().querySelector('.animate-spin')).not.toBeNull()
    expect(host.textContent).toContain('uno.ts')
  })

  it('al terminar se pliega sola y avisa una vez: «Terminó, N pasos»', () => {
    mount({ live: true })
    expect(status()).toBe('')
    mount({ live: false })
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(status()).toBe('Terminó, 3 pasos')
  })

  it('si la persona la abrió, no se pliega al terminar', () => {
    mount({ live: true })
    act(() => header().click()) // la cierra
    act(() => header().click()) // la abre de nuevo: elección explícita
    mount({ live: false })
    expect(header().getAttribute('aria-expanded')).toBe('true')
  })

  it('Con pasos, plegada: dice qué hizo y deja a la vista el archivo editado', () => {
    mount({ view: 'normal' })
    expect(header().getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toContain('Leyó 2 archivos')
    expect(host.textContent).toContain('uno.ts')
    expect(host.querySelector('[data-work-attention]')).toBeNull()
  })

  it('Detallada: abierta de entrada', () => {
    mount({ view: 'detailed' })
    expect(header().getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('dos.ts')
  })

  it('un error o un permiso pendiente NUNCA queda oculto con el trabajo plegado', () => {
    const bad = tool('e', 'bash', { command: 'rm nada' }, 'error', 6)
    const waiting = tool('w', 'write', { filePath: '/p/nuevo.ts', content: 'x' }, 'pending')
    mount({ tools: [read1, bad, waiting], attention: [bad, waiting] })
    expect(header().getAttribute('aria-expanded')).toBe('false')
    const group = host.querySelector('[data-work-attention]')
    expect(group).not.toBeNull()
    expect(group?.getAttribute('aria-label')).toBe('Requiere tu atención')
    expect(group?.textContent).toContain('rm nada')
    expect(group?.textContent).toContain('nuevo.ts')
    // lo que no necesita atención sigue dentro del plegado
    expect(host.textContent).not.toContain('uno.ts')
  })

  it('abierta no se repiten los pasos con atención (salen en su sitio de la lista)', () => {
    const bad = tool('e', 'bash', { command: 'rm nada' }, 'error', 6)
    mount({ tools: [read1, bad], attention: [bad] })
    act(() => header().click())
    expect(host.querySelector('[data-work-attention]')).toBeNull()
    expect((host.textContent ?? '').match(/rm nada/g)).toHaveLength(1)
  })

  it('sin datos de tiempo fiables solo dice cuántos pasos', () => {
    const noTime = [tool('p1', 'read', { filePath: '/p/a.ts' }, 'pending'), tool('p2', 'read', { filePath: '/p/b.ts' }, 'pending')]
    mount({ tools: noTime })
    expect(header().textContent).toContain('Trabajó en 2 pasos')
    expect(header().textContent).not.toContain('durante')
  })
})
