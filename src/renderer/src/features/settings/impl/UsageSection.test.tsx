// @vitest-environment jsdom
/** Ajustes › Uso (F8-B189): frase de estado, períodos, tablas con barras, tope de lectura y estados cargando / vacío / error. */
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../../test/dom-render'

import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSessions } from '../../../stores/sessions'
import { UsageSection } from './UsageSection'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const tokens = (input: number, output: number, cache = 0): unknown => ({ input, output, reasoning: 0, cache: { read: cache, write: 0 } })
function gs(id: string, over: Record<string, unknown>): Record<string, unknown> {
  return { id, directory: '/code/app', time: { created: 1, updated: Date.now() - HOUR }, ...over }
}

let m: Mounted | null = null
let list: ReturnType<typeof vi.fn>
const fetchSpy = vi.fn()

function setClient(impl: () => Promise<unknown>): void {
  list = vi.fn(impl)
  useServer.setState({
    client: { experimental: { session: { list } } } as never,
    connection: { chatDirectory: '/chat' } as never
  })
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mountSection = async (): Promise<Mounted> => {
  m = mount(createElement(UsageSection))
  await flush()
  return m
}
const text = (): string => m!.host.textContent ?? ''
const tid = (id: string): HTMLElement | null => m!.q(`[data-testid="${id}"]`)
const rows = (id: string): string[][] =>
  [...(tid(id)?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.children].map((c) => c.textContent ?? ''))

beforeEach(() => {
  vi.unstubAllGlobals() // jsdom real en vez del window de setup.ts
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockReset()
  useProviders.setState({
    providers: [
      {
        id: 'opencode',
        name: 'OpenCode',
        models: { 'deepseek-v4.1-flash-free': { name: 'DeepSeek V4.1 Flash', cost: { input: 0, output: 0 } } }
      },
      { id: 'acme', name: 'Acme', models: { grande: { name: 'Grande', cost: { input: 3, output: 15 } } } }
    ] as never
  })
  useSessions.setState({ sessions: {}, sessionSource: {} })
})
afterEach(() => {
  m?.unmount()
  m = null
  useServer.setState({ client: null, connection: null })
})

const FREE = { id: 'deepseek-v4.1-flash-free', providerID: 'opencode' }
const PAID = { id: 'grande', providerID: 'acme' }

describe('UsageSection', () => {
  it('mientras no hay motor dice que espera y no pide nada', async () => {
    useServer.setState({ client: null, connection: null })
    await mountSection()
    expect(text()).toContain('Esperando a que la IA termine de iniciar')
    expect(tid('usage-report')).toBeNull()
  })

  it('cargando: muestra un aviso con rol de estado hasta que llega la lectura', async () => {
    let done!: (v: unknown) => void
    setClient(() => new Promise((r) => (done = r)))
    await mountSection()
    expect(tid('usage-loading')?.getAttribute('role')).toBe('status')
    expect(text()).toContain('Leyendo tus conversaciones')
    expect(tid('usage-refresh')?.hasAttribute('disabled')).toBe(true)
    await act(async () => done({ data: [gs('a', { agent: 'build', tokens: tokens(1000, 500) })] }))
    expect(tid('usage-loading')).toBeNull()
    expect(tid('usage-report')).not.toBeNull()
  })

  it('lee UNA vez al abrir, con tope de 300, y todo es local (ninguna llamada de red propia)', async () => {
    setClient(async () => ({ data: [] }))
    await mountSection()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ limit: 300 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('con datos: frase llana, tokens nuevos, conversaciones y modelo gratuito dicho como gratuito', async () => {
    setClient(async () => ({
      data: [
        gs('a', { agent: 'chat', directory: '/chat', model: FREE, cost: 0, tokens: tokens(1000, 500, 8000) }),
        gs('b', { agent: 'build', model: FREE, cost: 0, tokens: tokens(2000, 1500) })
      ]
    }))
    await mountSection()
    const status = tid('usage-status')!.textContent!
    expect(status).toContain('Todo en orden. En los últimos 7 días usaste 5 k tokens en 2 conversaciones.')
    expect(status).toContain('Todo con modelos gratuitos: no se cobra nada.')
    expect(tid('usage-report')!.textContent).toContain('Tokens de caché: 8 k')
    expect(rows('usage-by-model')).toEqual([['DeepSeek V4.1 Flash', '2', '5 k', 'Gratuito']])
    expect(rows('usage-by-mode').map((r) => [r[0], r[1], r[3]])).toEqual([
      ['Chat', '1', 'Gratuito'],
      ['Code', '1', 'Gratuito'],
      ['Overdrive', '0', '—']
    ])
  })

  it('costo informado y «sin dato» conviven sin inventar números', async () => {
    setClient(async () => ({
      data: [
        gs('a', { agent: 'chat', directory: '/chat', model: PAID, cost: 0.5, tokens: tokens(1000, 0) }),
        gs('b', { agent: 'build', model: { id: 'rara', providerID: 'otro' }, tokens: tokens(400, 100) }),
        gs('c', { agent: 'build', tokens: tokens(50, 50) })
      ]
    }))
    await mountSection()
    const status = tid('usage-status')!.textContent!
    expect(status).toContain('Costo informado por tu servicio de IA: US$')
    expect(status).toContain('no informó costo')
    const model = rows('usage-by-model')
    expect(model.find((r) => r[0] === 'Grande')![3]).toMatch(/US\$\s?0,5/)
    expect(model.find((r) => r[0] === 'rara')![3]).toBe('Sin dato')
    expect(model.find((r) => r[0] === 'Modelo desconocido')![3]).toBe('Sin dato')
  })

  it('sin uso: lo dice con una frase, no con ceros', async () => {
    setClient(async () => ({ data: [] }))
    await mountSection()
    expect(tid('usage-status')!.textContent).toContain('Aún no hay uso en este período')
    expect(rows('usage-by-model')).toEqual([['Sin datos.']])
  })

  it('cambiar de período recalcula sin volver a leer; hoy no muestra serie y 30 días la muestra por semana', async () => {
    setClient(async () => ({
      data: [
        gs('a', { agent: 'build', model: FREE, cost: 0, tokens: tokens(100, 0), time: { created: 1, updated: Date.now() - 10 * DAY } })
      ]
    }))
    await mountSection()
    expect(tid('usage-status')!.textContent).toContain('Aún no hay uso')
    expect(rows('usage-by-bucket')).toHaveLength(7)
    click(tid('usage-period-today'))
    expect(tid('usage-by-bucket')).toBeNull()
    click(tid('usage-period-30d'))
    expect(tid('usage-status')!.textContent).toContain('En los últimos 30 días usaste 100 tokens en 1 conversación.')
    expect(tid('usage-by-bucket')!.textContent).toContain('Semana del')
    expect(tid('usage-period-30d')!.getAttribute('aria-pressed')).toBe('true')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('«Actualizar» vuelve a leer y muestra la hora', async () => {
    setClient(async () => ({ data: [gs('a', { agent: 'build', tokens: tokens(10, 0) })] }))
    await mountSection()
    expect(tid('usage-updated')).not.toBeNull()
    click(tid('usage-refresh'))
    await flush()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('al llegar al tope de 300 lo avisa y marca el período como incompleto', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      gs(`s${i}`, { agent: 'build', tokens: tokens(10, 0), time: { created: 1, updated: Date.now() - (i + 1) * 60_000 * 20 } })
    )
    setClient(async () => ({ data: many }))
    await mountSection()
    click(tid('usage-period-30d'))
    expect(tid('usage-notes')!.textContent).toContain('solo se leen las 300 conversaciones más recientes')
    expect(tid('usage-notes')!.textContent).toContain('hay conversaciones más antiguas que no se cuentan')
    expect(tid('usage-status')!.textContent).toContain('puede estar incompleto')
  })

  it('error del motor: mensaje claro y «Reintentar» que vuelve a leer', async () => {
    let fail = true
    setClient(async () => (fail ? { error: new Error('motor caído') } : { data: [] }))
    await mountSection()
    expect(tid('usage-error')!.textContent).toContain('No se pudo leer el uso')
    fail = false
    const retry = m!.qa<HTMLButtonElement>('button').find((b) => b.textContent === 'Reintentar')!
    click(retry)
    await flush()
    expect(tid('usage-error')).toBeNull()
    expect(tid('usage-report')).not.toBeNull()
  })

  it('suma las tareas de Overdrive que la app tiene cargadas y lo aclara', async () => {
    useSessions.setState({
      sessions: {
        t1: gs('t1', { agent: 'tasks', directory: '/home/x/Informes', model: FREE, cost: 0, tokens: tokens(700, 300) }) as never
      },
      sessionSource: { t1: 'http://127.0.0.1:5555' }
    })
    setClient(async () => ({ data: [] }))
    await mountSection()
    expect(rows('usage-by-mode').find((r) => r[0] === 'Overdrive')![1]).toBe('1')
    expect(tid('usage-notes')!.textContent).toContain('Overdrive solo cuenta las tareas de las carpetas que has abierto')
  })

  it('es accesible: tablas con título y encabezados, estado anunciado, barras ocultas al lector y explicación de «token»', async () => {
    setClient(async () => ({ data: [gs('a', { agent: 'build', model: PAID, cost: 1, tokens: tokens(100, 100) })] }))
    await mountSection()
    for (const id of ['usage-by-bucket', 'usage-by-model', 'usage-by-mode']) {
      const t = tid(id)!
      expect(t.querySelector('caption')?.textContent, id).toBeTruthy()
      expect(t.querySelectorAll('thead th[scope="col"]').length, id).toBeGreaterThanOrEqual(3)
      expect(t.querySelectorAll('tbody th[scope="row"]').length, id).toBeGreaterThan(0)
      for (const bar of t.querySelectorAll('[style*="width"]')) expect(bar.parentElement?.getAttribute('aria-hidden'), id).toBe('true')
    }
    expect(m!.q('[role="status"][aria-live="polite"]')).not.toBeNull()
    expect(tid('usage-period-7d')!.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Período')
    const help = tid('usage-tokens-help')!
    expect(help.querySelector('summary')?.textContent).toBe('¿Qué es un token?')
    expect(help.textContent).toContain('trocito de texto')
    expect(text()).toContain('no tiene cuentas ni límites de uso propios')
    expect(text()).toContain('No se envía nada fuera')
  })
})
